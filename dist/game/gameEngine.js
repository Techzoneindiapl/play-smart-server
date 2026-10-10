"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gameEngine = exports.GameEngine = void 0;
const events_1 = require("events");
const deck_1 = require("./deck");
const provablyFair_1 = require("./provablyFair");
const db_1 = require("../store/db");
const GAME_CONFIGS = {
    lucky12: {
        id: 'lucky12',
        title: 'LUCKY CARD 12',
        deck: deck_1.DECK_12,
        bettingSeconds: 25,
        defaultMultiplier: 10,
    },
    lucky16: {
        id: 'lucky16',
        title: 'LUCKY 16 CARDS',
        deck: deck_1.DECK_16,
        bettingSeconds: 35,
        defaultMultiplier: 12,
    },
    luckyTimer: {
        id: 'luckyTimer',
        title: 'LUCKY CARD TIMER',
        deck: deck_1.DECK_12,
        bettingSeconds: 20,
        defaultMultiplier: 10,
    },
};
const BOT_NAMES = ['Kevin', 'RJ', 'Kesri', 'Meera', 'Tobi', 'Ana', 'Sam', 'Priya'];
const CHIP_VALUES = [10, 20, 50, 100, 500];
class GameEngine extends events_1.EventEmitter {
    activeRounds = new Map();
    timers = new Map();
    botTimers = new Map();
    constructor() {
        super();
    }
    init() {
        const games = ['lucky12', 'lucky16', 'luckyTimer'];
        games.forEach(g => {
            this.botTimers.set(g, []);
            this.startNewRound(g);
        });
    }
    getRound(gameId) {
        return this.activeRounds.get(gameId);
    }
    getAllActiveRounds() {
        const res = {};
        this.activeRounds.forEach((round, id) => {
            res[id] = round;
        });
        return res;
    }
    startNewRound(gameId) {
        // Clear existing timers for this game
        const existingTimer = this.timers.get(gameId);
        if (existingTimer)
            clearTimeout(existingTimer);
        const bots = this.botTimers.get(gameId) || [];
        bots.forEach(t => clearTimeout(t));
        this.botTimers.set(gameId, []);
        const config = GAME_CONFIGS[gameId];
        const serverSeed = (0, provablyFair_1.randomHex)(24);
        const serverSeedHash = (0, provablyFair_1.sha256Hex)(serverSeed);
        const clientSeed = (0, provablyFair_1.randomHex)(8);
        const id = 'RND-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        const round = {
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
    scheduleBots(gameId) {
        const round = this.activeRounds.get(gameId);
        if (!round)
            return;
        const deck = GAME_CONFIGS[gameId].deck;
        const botCount = 2 + Math.floor(Math.random() * 3);
        const shuffled = [...BOT_NAMES].sort(() => Math.random() - 0.5);
        const botTimerList = [];
        for (let i = 0; i < botCount; i++) {
            const delay = 1000 + Math.random() * (round.totalSeconds - 6) * 1000;
            const t = setTimeout(() => {
                if (round.status !== 'betting')
                    return;
                const targetIndex = Math.floor(Math.random() * deck.length);
                const points = CHIP_VALUES[Math.floor(Math.random() * CHIP_VALUES.length)];
                this.placeAllocation(gameId, shuffled[i], targetIndex, points, true);
            }, delay);
            botTimerList.push(t);
        }
        this.botTimers.set(gameId, botTimerList);
    }
    scheduleTick(gameId) {
        const timer = setTimeout(() => this.tick(gameId), 1000);
        this.timers.set(gameId, timer);
    }
    tick(gameId) {
        const round = this.activeRounds.get(gameId);
        if (!round)
            return;
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
    lockRound(gameId) {
        const round = this.activeRounds.get(gameId);
        if (!round || round.status !== 'betting')
            return;
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
    async revealRound(gameId) {
        const round = this.activeRounds.get(gameId);
        if (!round)
            return;
        const deck = GAME_CONFIGS[gameId].deck;
        const isOverridden = round.forcedWinnerIndex !== null;
        let resultIndex;
        if (isOverridden) {
            resultIndex = round.forcedWinnerIndex;
        }
        else if (round.forcedMode === 'player_win') {
            // Find card with allocations or highest allocations
            const cardBets = {};
            round.allocations.forEach(a => {
                cardBets[a.targetIndex] = (cardBets[a.targetIndex] || 0) + a.points;
            });
            const indicesWithBets = Object.keys(cardBets).map(Number);
            if (indicesWithBets.length > 0) {
                // Choose card with highest bet
                indicesWithBets.sort((a, b) => cardBets[b] - cardBets[a]);
                resultIndex = indicesWithBets[0];
            }
            else {
                resultIndex = (0, provablyFair_1.computeResultIndex)(round.serverSeed, round.clientSeed, round.id, deck.length);
            }
        }
        else {
            resultIndex = (0, provablyFair_1.computeResultIndex)(round.serverSeed, round.clientSeed, round.id, deck.length);
        }
        round.status = 'revealed';
        round.resultIndex = resultIndex;
        round.winningCard = deck[resultIndex];
        round.revealedAt = Date.now();
        // Settle payouts
        const winners = [];
        let totalPayout = 0;
        const rtpConfig = db_1.db.getRtpConfig();
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
                db_1.db.adjustUserBalance(alloc.username, winAmount, `Win payout for ${gameId} round ${round.id} (${round.winningCard.label}${round.winningCard.suit})`, 'payout', round.id, gameId);
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
        const historyEntry = {
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
        db_1.db.addRoundHistory(historyEntry);
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
            const u = db_1.db.getUserByUsername(w.username);
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
    placeAllocation(gameId, username, targetIndex, points, isBot = false) {
        const round = this.activeRounds.get(gameId);
        if (!round)
            return { success: false, error: 'Game not found' };
        if (round.status !== 'betting')
            return { success: false, error: 'Betting is closed for this round' };
        const deck = GAME_CONFIGS[gameId].deck;
        if (targetIndex < 0 || targetIndex >= deck.length) {
            return { success: false, error: 'Invalid card index' };
        }
        if (!isBot) {
            const user = db_1.db.getUserByUsername(username);
            if (!user)
                return { success: false, error: 'User not found' };
            if (user.status !== 'active')
                return { success: false, error: 'User is blocked' };
            if (user.balance < points)
                return { success: false, error: 'Insufficient credits' };
            // Deduct balance
            const res = db_1.db.adjustUserBalance(username, -points, `Bet placed on ${deck[targetIndex].label}${deck[targetIndex].suit} in ${gameId} round ${round.id}`, 'bet', round.id, gameId);
            if (!res)
                return { success: false, error: 'Failed to debit balance' };
        }
        const card = deck[targetIndex];
        const alloc = {
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
            const updatedUser = db_1.db.getUserByUsername(username);
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
    setForcedWinner(gameId, index, mode = 'manual', multiplier) {
        const round = this.activeRounds.get(gameId);
        if (!round)
            return;
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
    forceLockAndReveal(gameId) {
        const round = this.activeRounds.get(gameId);
        if (!round || round.status !== 'betting')
            return;
        const t = this.timers.get(gameId);
        if (t)
            clearTimeout(t);
        this.lockRound(gameId);
    }
    sanitizeRound(round) {
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
exports.GameEngine = GameEngine;
exports.gameEngine = new GameEngine();
