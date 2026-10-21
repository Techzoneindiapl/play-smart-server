import { EventEmitter } from 'events';
import { Card, GameId, Round, Allocation, RoundHistoryEntry } from '../types';
import { DECK_12, DECK_16, getDeck, getDefaultMultiplier } from './deck';
import { randomHex, sha256Hex, computeResultIndex } from './provablyFair';
import { db } from '../store/db';

export interface GameConfigData {
  id: GameId;
  title: string;
  deck: Card[];
  bettingSeconds: number;
  defaultMultiplier: number;
}

const GAME_CONFIGS: Record<GameId, GameConfigData> = {
  lucky12: {
    id: 'lucky12',
    title: 'LUCKY CARD 12',
    deck: DECK_12,
    bettingSeconds: 90,
    defaultMultiplier: 10,
  },
  lucky16: {
    id: 'lucky16',
    title: 'LUCKY 16 CARDS',
    deck: DECK_16,
    bettingSeconds: 90,
    defaultMultiplier: 12,
  },
  luckyTimer: {
    id: 'luckyTimer',
    title: 'LUCKY CARD TIMER',
    deck: DECK_12,
    bettingSeconds: 90,
    defaultMultiplier: 10,
  },
};

export class GameEngine extends EventEmitter {
  private activeRounds: Map<GameId, Round> = new Map();
  private timers: Map<GameId, NodeJS.Timeout> = new Map();
  private forcedWinnerOverrides: Map<GameId, {
    index: number | null;
    mode: 'fair' | 'player_win' | 'manual';
    multiplier?: number;
    cardLabel?: string;
  }> = new Map();

  constructor() {
    super();
  }

  public init(): void {
    const games: GameId[] = ['lucky12', 'lucky16', 'luckyTimer'];
    games.forEach(g => {
      this.startNewRound(g);
    });
  }

  public getRound(gameId: GameId): Round | undefined {
    return this.activeRounds.get(gameId);
  }

  public getAllActiveRounds(): Record<string, Round> {
    const res: Record<string, Round> = {};
    this.activeRounds.forEach((round, id) => {
      res[id] = round;
    });
    return res;
  }

  public startNewRound(gameId: GameId): Round {
    // Clear existing timers for this game
    const existingTimer = this.timers.get(gameId);
    if (existingTimer) clearTimeout(existingTimer);

    const config = GAME_CONFIGS[gameId];
    const serverSeed = randomHex(24);
    const serverSeedHash = sha256Hex(serverSeed);
    const clientSeed = randomHex(8);
    const id = 'RND-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    const override = this.forcedWinnerOverrides.get(gameId);
    let initialForcedIndex: number | null = null;
    let initialForcedMode: 'fair' | 'player_win' | 'manual' = 'fair';
    const initialCustomMultipliers: Record<number, number> = {};

    if (override && override.index !== null && override.mode !== 'fair') {
      initialForcedIndex = override.index;
      initialForcedMode = override.mode;
      if (override.multiplier) {
        initialCustomMultipliers[override.index] = override.multiplier;
      }
    }

    const round: Round = {
      id,
      gameId,
      serverSeed,
      serverSeedHash,
      clientSeed,
      status: 'betting',
      secondsLeft: config.bettingSeconds,
      totalSeconds: config.bettingSeconds,
      allocations: [],
      resultIndex: null,
      winningCard: null,
      forcedWinnerIndex: initialForcedIndex,
      forcedMode: initialForcedMode,
      customMultipliers: initialCustomMultipliers,
      createdAt: Date.now(),
    };

    this.activeRounds.set(gameId, round);

    this.emit('round_started', {
      gameId,
      round: this.sanitizeRound(round),
    });

    this.scheduleTick(gameId);
    return round;
  }

  private scheduleTick(gameId: GameId): void {
    const timer = setTimeout(() => this.tick(gameId), 1000);
    this.timers.set(gameId, timer);
  }

  private tick(gameId: GameId): void {
    const round = this.activeRounds.get(gameId);
    if (!round) return;

    if (round.secondsLeft <= 0) {
      this.lockRound(gameId);
      return;
    }

    round.secondsLeft -= 1;
    this.emit('game_timer', {
      gameId,
      roundId: round.id,
      secondsLeft: round.secondsLeft,
      totalSeconds: round.totalSeconds,
    });

    this.scheduleTick(gameId);
  }

  public lockRound(gameId: GameId): void {
    const round = this.activeRounds.get(gameId);
    if (!round || round.status !== 'betting') return;

    round.status = 'locked';
    this.emit('betting_closed', {
      gameId,
      roundId: round.id,
    });

    // Wait 2.5s for draw animation, then reveal
    const drawTimer = setTimeout(() => {
      this.revealRound(gameId);
    }, 2500);
    this.timers.set(gameId, drawTimer);
  }

  public async revealRound(gameId: GameId): Promise<void> {
    const round = this.activeRounds.get(gameId);
    if (!round) return;

    const deck = GAME_CONFIGS[gameId].deck;
    const isOverridden = round.forcedWinnerIndex !== null;
    let resultIndex: number;
    const rtpConfig = db.getRtpConfig();
    const totalBets = round.allocations.reduce((s, a) => s + a.points, 0);
    const adminPct = db.getAdminPercentage(gameId); // e.g. 20%
    const adminHoldAmount = (totalBets * adminPct) / 100;
    const maxPlayerPayoutPool = Math.max(0, totalBets - adminHoldAmount);

    if (isOverridden) {
      resultIndex = round.forcedWinnerIndex!;
    } else {
      // Calculate payout for each card index to strictly enforce admin win percentage
      const defaultMult = GAME_CONFIGS[gameId].defaultMultiplier;
      const cardPayouts: { index: number; payout: number }[] = deck.map((c, idx) => {
        const rankMult = (rtpConfig?.rankMultipliers && rtpConfig.rankMultipliers[c.rank]) || defaultMult;
        const mult = round.customMultipliers[idx] || rankMult;
        const cardBetTotal = round.allocations
          .filter(a => a.targetIndex === idx || a.cardLabel === `${c.label}${c.suit}`)
          .reduce((sum, a) => sum + a.points, 0);
        return { index: idx, payout: cardBetTotal * mult };
      });

      // Filter cards where payout <= maxPlayerPayoutPool
      const allowedCards = cardPayouts.filter(cp => cp.payout <= maxPlayerPayoutPool);
      if (allowedCards.length > 0) {
        // Pick among the allowed cards using provably fair hash
        const pfIndex = computeResultIndex(round.serverSeed, round.clientSeed, round.id, allowedCards.length);
        resultIndex = allowedCards[pfIndex].index;
      } else {
        // Pick card with minimum payout to protect admin margin as closely as possible
        cardPayouts.sort((a, b) => a.payout - b.payout);
        resultIndex = cardPayouts[0].index;
      }
    }

    const winningCard = deck[resultIndex];
    round.status = 'revealed';
    round.resultIndex = resultIndex;
    round.winningCard = winningCard;
    round.revealedAt = Date.now();

    // Settle payouts with admin multiplier and win percentage cut
    const winners: {
      username: string;
      points: number;
      winAmount: number;
      grossWin?: number;
      adminCut?: number;
      multiplier: number;
      multiplierFactor?: number;
    }[] = [];
    let totalPayout = 0;

    const winningAllocs = round.allocations.filter(a =>
      a.targetIndex === resultIndex || a.cardLabel === `${winningCard.label}${winningCard.suit}`
    );

    // Multiplier calculation:
    // Base multiplier (e.g. 10 for Lucky 12, 12 for Lucky 16, or rank-specific)
    const baseMult = (rtpConfig?.rankMultipliers && rtpConfig.rankMultipliers[winningCard.rank]) || GAME_CONFIGS[gameId].defaultMultiplier;
    // Admin selected winning X from live results dropdown (1 to 21, default 1)
    const multFactor = round.customMultipliers[resultIndex] || 1;
    // Total gross multiplier = baseMult * multFactor (e.g., 1x => 10, 2x => 20, 21x => 210)
    const grossMultiplier = baseMult * multFactor;

    for (const alloc of winningAllocs) {
      if (alloc.id.endsWith('-twin')) continue;

      const winAmount = alloc.points * grossMultiplier;
      totalPayout += winAmount;

      // Record unclaimed winnings ticket: player must claim via "All Claim" button or Unclaim Ticket dialog
      db.addUnclaimedTicket({
        id: 'TKT-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
        ticketId: 'TCK-' + Math.floor(1000 + Math.random() * 9000),
        roundId: round.id,
        gameId,
        username: alloc.username,
        betAmount: alloc.points,
        winAmount,
        multiplier: multFactor,
        cardLabel: `${round.winningCard.label}${round.winningCard.suit}`,
        createdAt: new Date().toISOString(),
        claimed: false,
      });

      winners.push({
        username: alloc.username,
        points: alloc.points,
        winAmount,
        grossWin: winAmount,
        multiplier: multFactor,
        multiplierFactor: multFactor,
      });
    }

    const uniquePlayers = new Set(round.allocations.map(a => a.username)).size;

    // Save round to history
    const historyEntry: RoundHistoryEntry = {
      id: 'HIST-' + round.id,
      roundId: round.id,
      gameId,
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      resultIndex,
      winningCard: round.winningCard,
      totalBets,
      totalPayouts: totalPayout,
      playerCount: uniquePlayers,
      allocations: [...round.allocations],
      winners,
      multiplier: multFactor,
      multiplierFactor: multFactor,
      isOverridden,
      time: new Date().toISOString(),
    };
    db.addRoundHistory(historyEntry);

    // Deduct winner payouts from TOTAL Game Balance and add to TOTAL PAYMENT
    const targetBalanceId = gameId === 'luckyTimer' ? 'lucky12' : gameId;
    if (totalPayout > 0) {
      const updatedBal = db.addPayoutToGameBalance(targetBalanceId, totalPayout);
      this.emit('live_balance_updated', {
        gameId: targetBalanceId,
        liveBalance: updatedBal,
        allBalances: db.getAllLiveGameBalances(),
      });
    }

    // Broadcast result
    this.emit('game_result', {
      gameId,
      roundId: round.id,
      resultIndex,
      winningCard: round.winningCard,
      multiplier: multFactor,
      grossMultiplier,
      multiplierFactor: multFactor,
      adminPercentage: adminPct,
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      isOverridden,
      totalBets,
      totalPayout,
      winners,
      historyEntry,
    });

    // Clear one-time manual override so subsequent rounds revert to fair unless set again
    this.forcedWinnerOverrides.delete(gameId);

    // Notify winners and admin of updated balances
    winners.forEach(w => {
      const u = db.getUserByUsername(w.username);
      if (u) {
        this.emit('user_balance_updated', {
          username: w.username,
          balance: u.balance,
        });
      }
    });

    const adminUser = db.getUserByUsername('admin');
    if (adminUser) {
      this.emit('user_balance_updated', {
        username: 'admin',
        balance: adminUser.balance,
      });
    }

    // Wait for the wheel to completely stop (10s animation + 1s settle time),
    // then start next round so timer starts only after wheel has completely stopped.
    const nextRoundTimer = setTimeout(() => {
      this.startNewRound(gameId);
    }, 11000);
    this.timers.set(gameId, nextRoundTimer);
  }

  public placeAllocation(
    gameId: GameId,
    username: string,
    targetIndex: number,
    points: number,
    isBot = false
  ): { success: boolean; error?: string; allocation?: Allocation; newBalance?: number } {
    const round = this.activeRounds.get(gameId);
    if (!round) return { success: false, error: 'Game not found' };
    if (round.status !== 'betting') return { success: false, error: 'Betting is closed for this round' };

    const deck = GAME_CONFIGS[gameId].deck;
    if (targetIndex < 0 || targetIndex >= deck.length) {
      return { success: false, error: 'Invalid card index' };
    }

    if (!isBot) {
      const user = db.getUserByUsername(username);
      if (!user) return { success: false, error: 'User not found' };
      if (user.status !== 'active') return { success: false, error: 'User is blocked' };
      if (user.balance < points) return { success: false, error: 'Insufficient credits' };

      // Deduct balance
      const res = db.adjustUserBalance(
        username,
        -points,
        `Bet placed on ${deck[targetIndex].label}${deck[targetIndex].suit} in ${gameId} round ${round.id}`,
        'bet',
        round.id,
        gameId
      );
      if (!res) return { success: false, error: 'Failed to debit balance' };
    }

    const card = deck[targetIndex];
    const alloc: Allocation = {
      id: 'ALLOC-' + Math.random().toString(36).substring(2, 9),
      username,
      targetIndex,
      points,
      placedAt: Date.now(),
      cardLabel: `${card.label}${card.suit}`,
    };

    round.allocations.push(alloc);

    // Mirror to twin 12-card game (lucky12 <-> luckyTimer) if active
    const twinId: GameId | null = gameId === 'lucky12' ? 'luckyTimer' : (gameId === 'luckyTimer' ? 'lucky12' : null);
    if (twinId) {
      const twinRound = this.activeRounds.get(twinId);
      if (twinRound && twinRound.status === 'betting') {
        twinRound.allocations.push({ ...alloc, id: alloc.id + '-twin' });
        this.emit('new_allocation', {
          gameId: twinId,
          roundId: twinRound.id,
          allocation: alloc,
          totalRoundPoints: twinRound.allocations.reduce((s, a) => s + a.points, 0),
        });
      }
    }

    // Emit live allocation event
    this.emit('new_allocation', {
      gameId,
      roundId: round.id,
      allocation: alloc,
      totalRoundPoints: round.allocations.reduce((s, a) => s + a.points, 0),
    });

    // Update live game balance: total betted points minus admin win percentage
    const targetBalanceId = gameId === 'luckyTimer' ? 'lucky12' : gameId;
    const adminPct = db.getAdminPercentage(targetBalanceId);
    const updatedBal = db.addBetToGameBalance(targetBalanceId, points, adminPct);
    this.emit('live_balance_updated', {
      gameId: targetBalanceId,
      liveBalance: updatedBal,
      allBalances: db.getAllLiveGameBalances(),
    });

    if (!isBot) {
      const updatedUser = db.getUserByUsername(username);
      if (updatedUser) {
        this.emit('user_balance_updated', {
          username,
          balance: updatedUser.balance,
        });
        return { success: true, allocation: alloc, newBalance: updatedUser.balance };
      }
    }

    return { success: true, allocation: alloc };
  }

  // Admin controls
  public setForcedWinner(gameId: GameId, index: number | null, mode: 'fair' | 'player_win' | 'manual' = 'manual', multiplier?: number, cardLabel?: string): void {
    const targetGameIds: GameId[] = (gameId === 'lucky12' || gameId === 'luckyTimer')
      ? ['lucky12', 'luckyTimer']
      : [gameId];

    for (const gid of targetGameIds) {
      const deck = GAME_CONFIGS[gid].deck;
      let finalIndex = index;
      if (cardLabel) {
        const clean = cardLabel.replace(/\s+/g, '').toLowerCase();
        const found = deck.find(c =>
          `${c.label}${c.suit}`.toLowerCase() === clean ||
          `${c.rank}${c.suit}`.toLowerCase() === clean ||
          `${c.label}_${c.suitName}`.toLowerCase() === clean ||
          `${c.label}_${c.suit}`.toLowerCase() === clean
        );
        if (found) finalIndex = found.index;
      }

      if (finalIndex !== null && mode !== 'fair') {
        this.forcedWinnerOverrides.set(gid, {
          index: finalIndex,
          mode,
          multiplier,
          cardLabel,
        });
      } else {
        this.forcedWinnerOverrides.delete(gid);
      }

      const round = this.activeRounds.get(gid);
      if (!round) continue;

      round.forcedWinnerIndex = finalIndex;
      round.forcedMode = mode;
      if (finalIndex !== null && multiplier) {
        round.customMultipliers[finalIndex] = multiplier;
      }

      this.emit('admin_forced_updated', {
        gameId: gid,
        roundId: round.id,
        forcedWinnerIndex: round.forcedWinnerIndex,
        forcedMode: round.forcedMode,
        customMultipliers: round.customMultipliers,
      });
    }
  }

  public forceLockAndReveal(gameId: GameId): void {
    const round = this.activeRounds.get(gameId);
    if (!round || round.status !== 'betting') return;
    const t = this.timers.get(gameId);
    if (t) clearTimeout(t);
    this.lockRound(gameId);
  }

  public sanitizeRound(round: Round): any {
    return {
      id: round.id,
      gameId: round.gameId,
      status: round.status,
      secondsLeft: round.secondsLeft,
      totalSeconds: round.totalSeconds,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      allocations: round.allocations,
      resultIndex: round.resultIndex,
      winningCard: round.winningCard,
      forcedWinnerIndex: round.forcedWinnerIndex,
      forcedMode: round.forcedMode,
      customMultipliers: round.customMultipliers,
    };
  }
}

export const gameEngine = new GameEngine();
