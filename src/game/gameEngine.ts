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
    bettingSeconds: 25,
    defaultMultiplier: 10,
  },
  lucky16: {
    id: 'lucky16',
    title: 'LUCKY 16 CARDS',
    deck: DECK_16,
    bettingSeconds: 35,
    defaultMultiplier: 12,
  },
  luckyTimer: {
    id: 'luckyTimer',
    title: 'LUCKY CARD TIMER',
    deck: DECK_12,
    bettingSeconds: 20,
    defaultMultiplier: 10,
  },
};

const BOT_NAMES = ['Kevin', 'RJ', 'Kesri', 'Meera', 'Tobi', 'Ana', 'Sam', 'Priya'];
const CHIP_VALUES = [10, 20, 50, 100, 500];

export class GameEngine extends EventEmitter {
  private activeRounds: Map<GameId, Round> = new Map();
  private timers: Map<GameId, NodeJS.Timeout> = new Map();
  private botTimers: Map<GameId, NodeJS.Timeout[]> = new Map();

  constructor() {
    super();
  }

  public init(): void {
    const games: GameId[] = ['lucky12', 'lucky16', 'luckyTimer'];
    games.forEach(g => {
      this.botTimers.set(g, []);
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

    const bots = this.botTimers.get(gameId) || [];
    bots.forEach(t => clearTimeout(t));
    this.botTimers.set(gameId, []);

    const config = GAME_CONFIGS[gameId];
    const serverSeed = randomHex(24);
    const serverSeedHash = sha256Hex(serverSeed);
    const clientSeed = randomHex(8);
    const id = 'RND-' + Math.random().toString(36).substring(2, 8).toUpperCase();

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
      forcedWinnerIndex: null,
      forcedMode: 'fair',
      customMultipliers: {},
      createdAt: Date.now(),
    };

    this.activeRounds.set(gameId, round);

    this.emit('round_started', {
      gameId,
      round: this.sanitizeRound(round),
    });

    this.scheduleBots(gameId);
    this.scheduleTick(gameId);
    return round;
  }

  private scheduleBots(gameId: GameId): void {
    const round = this.activeRounds.get(gameId);
    if (!round) return;

    const deck = GAME_CONFIGS[gameId].deck;
    const botCount = 2 + Math.floor(Math.random() * 3);
    const shuffled = [...BOT_NAMES].sort(() => Math.random() - 0.5);

    const botTimerList: NodeJS.Timeout[] = [];
    for (let i = 0; i < botCount; i++) {
      const delay = 1000 + Math.random() * (round.totalSeconds - 6) * 1000;
      const t = setTimeout(() => {
        if (round.status !== 'betting') return;
        const targetIndex = Math.floor(Math.random() * deck.length);
        const points = CHIP_VALUES[Math.floor(Math.random() * CHIP_VALUES.length)];
        this.placeAllocation(gameId, shuffled[i], targetIndex, points, true);
      }, delay);
      botTimerList.push(t);
    }
    this.botTimers.set(gameId, botTimerList);
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

    if (isOverridden) {
      resultIndex = round.forcedWinnerIndex!;
    } else if (round.forcedMode === 'player_win') {
      // Find card with allocations or highest allocations
      const cardBets: Record<number, number> = {};
      round.allocations.forEach(a => {
        cardBets[a.targetIndex] = (cardBets[a.targetIndex] || 0) + a.points;
      });
      const indicesWithBets = Object.keys(cardBets).map(Number);
      if (indicesWithBets.length > 0) {
        // Choose card with highest bet
        indicesWithBets.sort((a, b) => cardBets[b] - cardBets[a]);
        resultIndex = indicesWithBets[0];
      } else {
        resultIndex = computeResultIndex(round.serverSeed, round.clientSeed, round.id, deck.length);
      }
    } else {
      resultIndex = computeResultIndex(round.serverSeed, round.clientSeed, round.id, deck.length);
    }

    round.status = 'revealed';
    round.resultIndex = resultIndex;
    round.winningCard = deck[resultIndex];
    round.revealedAt = Date.now();

    // Settle payouts
    const winners: { username: string; points: number; winAmount: number; multiplier: number }[] = [];
    let totalPayout = 0;
    const rtpConfig = db.getRtpConfig();

    for (const alloc of round.allocations) {
      if (alloc.targetIndex === resultIndex) {
        let mult = round.customMultipliers[resultIndex];
        if (!mult) {
          const rank = round.winningCard.rank;
          mult = rtpConfig.rankMultipliers[rank] || GAME_CONFIGS[gameId].defaultMultiplier;
        }
        const winAmount = alloc.points * mult;
        totalPayout += winAmount;

        // Credit real user
        db.adjustUserBalance(alloc.username, winAmount, `Win payout for ${gameId} round ${round.id} (${round.winningCard.label}${round.winningCard.suit})`, 'payout', round.id, gameId);

        winners.push({
          username: alloc.username,
          points: alloc.points,
          winAmount,
          multiplier: mult,
        });
      }
    }

    const totalBets = round.allocations.reduce((s, a) => s + a.points, 0);
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
      isOverridden,
      time: new Date().toISOString(),
    };
    db.addRoundHistory(historyEntry);

    // Broadcast result
    this.emit('game_result', {
      gameId,
      roundId: round.id,
      resultIndex,
      winningCard: round.winningCard,
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      isOverridden,
      totalBets,
      totalPayout,
      winners,
      historyEntry,
    });

    // Notify winners of their updated balances
    winners.forEach(w => {
      const u = db.getUserByUsername(w.username);
      if (u) {
        this.emit('user_balance_updated', {
          username: w.username,
          balance: u.balance,
        });
      }
    });

    // Wait 5 seconds after reveal, then start next round
    const nextRoundTimer = setTimeout(() => {
      this.startNewRound(gameId);
    }, 5500);
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

    // Emit live allocation event
    this.emit('new_allocation', {
      gameId,
      roundId: round.id,
      allocation: alloc,
      totalRoundPoints: round.allocations.reduce((s, a) => s + a.points, 0),
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
  public setForcedWinner(gameId: GameId, index: number | null, mode: 'fair' | 'player_win' | 'manual' = 'manual', multiplier?: number): void {
    const round = this.activeRounds.get(gameId);
    if (!round) return;

    round.forcedWinnerIndex = index;
    round.forcedMode = mode;
    if (index !== null && multiplier) {
      round.customMultipliers[index] = multiplier;
    }

    this.emit('admin_forced_updated', {
      gameId,
      roundId: round.id,
      forcedWinnerIndex: round.forcedWinnerIndex,
      forcedMode: round.forcedMode,
      customMultipliers: round.customMultipliers,
    });
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
