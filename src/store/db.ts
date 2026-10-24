import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { User, SuperDistributer, Distributer, WalletTransaction, RoundHistoryEntry, RtpConfig, ActivityLog, CommissionPayoutRecord, UnclaimedTicket } from '../types';
import {
  UserModel,
  SuperDistributerModel,
  DistributerModel,
  RoundHistoryModel,
  TransactionModel,
  RtpConfigModel,
} from '../models';

export interface DatabaseSchema {
  users: User[];
  superdistributers: SuperDistributer[];
  distributers: Distributer[];
  transactions: WalletTransaction[];
  roundHistory: RoundHistoryEntry[];
  rtpConfig: RtpConfig;
  unclaimedTickets?: UnclaimedTicket[];
  adminPercentages?: Record<string, number>;
  liveGameBalances?: Record<string, LiveGameBalance>;
  activityLogs?: ActivityLog[];
  commissionPayoutRecords?: CommissionPayoutRecord[];
}

export interface LiveGameBalance {
  gameBalance: number;
  totalCollection: number;
  totalPayment: number;
}

const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const INITIAL_DB: DatabaseSchema = {
  users: [
    { id: 'admin-001', username: 'admin', name: 'Administrator', password: 'admin', role: 'admin', balance: 1000000, status: 'active', createdAt: '2026-01-01T00:00:00.000Z' },
  ],
  superdistributers: [],
  distributers: [],
  transactions: [],
  roundHistory: [],
  unclaimedTickets: [],
  adminPercentages: { lucky12: 20, lucky16: 20, luckyTimer: 20 },
  liveGameBalances: {
    lucky12: { gameBalance: 0, totalCollection: 0, totalPayment: 0 },
    lucky16: { gameBalance: 0, totalCollection: 0, totalPayment: 0 },
    luckyTimer: { gameBalance: 0, totalCollection: 0, totalPayment: 0 },
  },
  rtpConfig: {
    houseMargin: 13.6,
    playerRtp: 86.4,
    algoStatus: 'Adaptive Dynamic Balancing',
    riskThreshold: 'Medium (Standard)',
    rankMultipliers: { J: 10, Q: 10, K: 10, A: 12 },
    rankWeights: { J: 33.3, Q: 33.3, K: 33.3 },
    rankStatus: { J: 'Auto-Tuned', Q: 'Auto-Tuned', K: 'Auto-Tuned' },
  },
};

class Database {
  private data: DatabaseSchema;
  private saveTimeout: NodeJS.Timeout | null = null;
  public isMongoConnected = false;

  constructor() {
    this.data = JSON.parse(JSON.stringify(INITIAL_DB));

    if (!fs.existsSync(DATA_DIR)) {
      try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) {}
    }

    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = {
          ...INITIAL_DB,
          ...parsed,
          unclaimedTickets: parsed.unclaimedTickets || [],
          rtpConfig: {
            ...INITIAL_DB.rtpConfig,
            ...(parsed.rtpConfig || {}),
            rankMultipliers: {
              ...INITIAL_DB.rtpConfig.rankMultipliers,
              ...((parsed.rtpConfig && parsed.rtpConfig.rankMultipliers) || {}),
            },
          },
        };
      } catch (err) {
        console.error('Failed reading DB file, using initial data');
      }
    }
  }

  public async connectMongo(uri?: string): Promise<void> {
    const mongoUri = uri || process.env.MONGODB_URI;
    if (!mongoUri) {
      console.log('[DB] No MONGODB_URI provided. Using persistent file/memory store.');
      return;
    }

    try {
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 8000,
      });
      this.isMongoConnected = true;
      console.log('[DB] Connected to MongoDB successfully!');
      await this.syncWithMongo();
    } catch (err) {
      console.error('[DB] Failed connecting to MongoDB:', err);
      console.log('[DB] Continuing with fallback store.');
    }
  }

  private async syncWithMongo(): Promise<void> {
    try {
      // 1. Users
      const mongoUsers = await UserModel.find().lean();
      if (mongoUsers.length === 0) {
        // Seed MongoDB from INITIAL_DB
        console.log('[DB] Seeding MongoDB with initial users...');
        await UserModel.insertMany(this.data.users);
      } else {
        this.data.users = mongoUsers.map((u: any) => ({
          id: u.id,
          username: u.username,
          name: u.name,
          password: u.password,
          role: u.role,
          balance: u.balance,
          status: u.status,
          distributerId: u.distributerId,
          superdistributerId: u.superdistributerId,
          createdAt: u.createdAt,
          lastLogin: u.lastLogin,
        }));
      }

      // 2. SuperDistributers
      const mongoSds = await SuperDistributerModel.find().lean();
      if (mongoSds.length === 0) {
        await SuperDistributerModel.insertMany(this.data.superdistributers);
      } else {
        this.data.superdistributers = mongoSds.map((s: any) => ({
          id: s.id,
          name: s.name,
          code: s.code,
          commission: s.commission,
          balance: s.balance,
          status: s.status,
          usersCount: s.usersCount,
          createdAt: s.createdAt,
        }));
      }

      // 3. Distributers
      const mongoDists = await DistributerModel.find().lean();
      if (mongoDists.length === 0) {
        await DistributerModel.insertMany(this.data.distributers);
      } else {
        this.data.distributers = mongoDists.map((d: any) => ({
          id: d.id,
          superId: d.superId,
          name: d.name,
          code: d.code,
          commission: d.commission,
          balance: d.balance,
          status: d.status,
          usersCount: d.usersCount,
          createdAt: d.createdAt,
        }));
      }

      // 4. Transactions
      const mongoTxs = await TransactionModel.find().sort({ time: -1 }).limit(1000).lean();
      if (mongoTxs.length > 0) {
        this.data.transactions = mongoTxs.map((t: any) => ({
          id: t.id,
          userId: t.userId,
          username: t.username,
          type: t.type,
          amount: t.amount,
          description: t.description,
          time: t.time,
          balanceAfter: t.balanceAfter,
          roundId: t.roundId,
          gameId: t.gameId,
        }));
      }

      // 5. Round History
      const mongoRounds = await RoundHistoryModel.find().sort({ time: -1 }).limit(500).lean();
      if (mongoRounds.length > 0) {
        this.data.roundHistory = mongoRounds.map((r: any) => ({
          id: r.id,
          roundId: r.roundId,
          gameId: r.gameId,
          serverSeed: r.serverSeed,
          serverSeedHash: r.serverSeedHash,
          clientSeed: r.clientSeed,
          resultIndex: r.resultIndex,
          winningCard: r.winningCard,
          totalBets: r.totalBets,
          totalPayouts: r.totalPayouts,
          playerCount: r.playerCount,
          isOverridden: r.isOverridden,
          time: r.time,
        }));
      }

      // 6. RTP Config
      const mongoRtp = await RtpConfigModel.findOne({ key: 'global' }).lean();
      if (mongoRtp && mongoRtp.config) {
        this.data.rtpConfig = mongoRtp.config as RtpConfig;
      } else {
        await RtpConfigModel.updateOne(
          { key: 'global' },
          { key: 'global', config: this.data.rtpConfig },
          { upsert: true }
        );
      }

      console.log(`[DB] Loaded ${this.data.users.length} users, ${this.data.roundHistory.length} rounds from MongoDB.`);
    } catch (e) {
      console.error('[DB] Error syncing with MongoDB:', e);
    }
  }

  public save(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveSync();
    }, 200);
  }

  public saveSync(): void {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (_) {}
  }

  // ---- Users ----
  public getUsers(): User[] {
    return this.data.users;
  }

  public getUserById(id: string): User | undefined {
    return this.data.users.find(u => u.id === id);
  }

  public getUserByUsername(username: string): User | undefined {
    return this.data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  }

  public addUser(user: User): User {
    this.data.users.push(user);
    this.save();
    if (this.isMongoConnected) {
      UserModel.create(user).catch(err => console.error('Mongo addUser error:', err));
    }
    return user;
  }

  public updateUser(id: string, updates: Partial<User>): User | undefined {
    const user = this.getUserById(id);
    if (!user) return undefined;
    Object.assign(user, updates);
    this.save();
    if (this.isMongoConnected) {
      UserModel.updateOne({ id }, { $set: updates }).catch(err => console.error('Mongo updateUser error:', err));
    }
    return user;
  }

  public adjustUserBalance(
    username: string,
    delta: number,
    description: string,
    type: WalletTransaction['type'] = 'credit',
    roundId?: string,
    gameId?: string
  ): { user: User; tx: WalletTransaction } | undefined {
    const user = this.getUserByUsername(username);
    if (!user) return undefined;

    user.balance = Math.max(0, Math.round((user.balance + delta) * 100) / 100);
    const tx: WalletTransaction = {
      id: 'TX-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
      userId: user.id,
      username: user.username,
      type,
      amount: Math.abs(delta),
      description,
      time: new Date().toISOString(),
      balanceAfter: user.balance,
      roundId,
      gameId,
    };
    this.data.transactions.unshift(tx);
    if (this.data.transactions.length > 5000) {
      this.data.transactions = this.data.transactions.slice(0, 5000);
    }
    this.save();

    if (this.isMongoConnected) {
      UserModel.updateOne({ id: user.id }, { $set: { balance: user.balance } }).catch(err => console.error('Mongo update balance error:', err));
      TransactionModel.create(tx).catch(err => console.error('Mongo create tx error:', err));
    }

    return { user, tx };
  }

  // ---- Unclaimed Tickets & Winnings ----
  public getUnclaimedTickets(username?: string): UnclaimedTicket[] {
    const list = this.data.unclaimedTickets || [];
    if (!username) return list.filter(t => !t.claimed);
    return list.filter(t => t.username.toLowerCase() === username.toLowerCase() && !t.claimed);
  }

  public getAllTickets(username?: string): UnclaimedTicket[] {
    const list = this.data.unclaimedTickets || [];
    if (!username) return list;
    return list.filter(t => t.username.toLowerCase() === username.toLowerCase());
  }

  public getUserUnclaimedAmount(username: string): number {
    return this.getUnclaimedTickets(username).reduce((sum, t) => sum + t.winAmount, 0);
  }

  public addUnclaimedTicket(ticket: UnclaimedTicket): UnclaimedTicket {
    if (!this.data.unclaimedTickets) this.data.unclaimedTickets = [];
    this.data.unclaimedTickets.unshift(ticket);
    if (this.data.unclaimedTickets.length > 5000) {
      this.data.unclaimedTickets = this.data.unclaimedTickets.slice(0, 5000);
    }
    this.save();
    return ticket;
  }

  public claimTickets(
    username: string,
    ticketId?: string
  ): { success: boolean; claimedAmount: number; newBalance: number; error?: string } {
    const user = this.getUserByUsername(username);
    if (!user) return { success: false, claimedAmount: 0, newBalance: 0, error: 'User not found' };

    const tickets = this.getUnclaimedTickets(username);
    const toClaim = ticketId
      ? tickets.filter(t => t.id === ticketId || t.ticketId === ticketId)
      : tickets;

    if (toClaim.length === 0) {
      return { success: false, claimedAmount: 0, newBalance: user.balance, error: 'No unclaimed tickets' };
    }

    const totalWin = toClaim.reduce((sum, t) => sum + t.winAmount, 0);
    const now = new Date().toISOString();
    for (const t of toClaim) {
      t.claimed = true;
      t.claimedAt = now;
    }

    this.adjustUserBalance(
      user.username,
      totalWin,
      `Claimed payout for ${toClaim.length} ticket(s)`,
      'payout'
    );

    this.save();
    return { success: true, claimedAmount: totalWin, newBalance: user.balance };
  }

  // ---- Superdistributers & Distributers ----
  public getSuperDistributers(): SuperDistributer[] {
    return this.data.superdistributers;
  }

  public addSuperDistributer(sd: SuperDistributer): SuperDistributer {
    this.data.superdistributers.push(sd);
    this.save();
    if (this.isMongoConnected) {
      SuperDistributerModel.create(sd).catch(err => console.error('Mongo add SD error:', err));
    }
    return sd;
  }

  public updateSuperDistributer(id: string, updates: Partial<SuperDistributer>): SuperDistributer | undefined {
    const sd = this.data.superdistributers.find(s => s.id === id);
    if (!sd) return undefined;
    Object.assign(sd, updates);
    this.save();
    if (this.isMongoConnected) {
      SuperDistributerModel.updateOne({ id }, { $set: updates }).catch(err => console.error('Mongo update SD error:', err));
    }
    return sd;
  }

  public getDistributers(): Distributer[] {
    return this.data.distributers;
  }

  public addDistributer(dist: Distributer): Distributer {
    this.data.distributers.push(dist);
    this.save();
    if (this.isMongoConnected) {
      DistributerModel.create(dist).catch(err => console.error('Mongo add Dist error:', err));
    }
    return dist;
  }

  public updateDistributer(id: string, updates: Partial<Distributer>): Distributer | undefined {
    const dist = this.data.distributers.find(d => d.id === id);
    if (!dist) return undefined;
    Object.assign(dist, updates);
    this.save();
    if (this.isMongoConnected) {
      DistributerModel.updateOne({ id }, { $set: updates }).catch(err => console.error('Mongo update Dist error:', err));
    }
    return dist;
  }

  public deleteUser(idOrUsername: string): boolean {
    const idx = this.data.users.findIndex(u => u.id === idOrUsername || u.username === idOrUsername);
    if (idx === -1) return false;
    const [removed] = this.data.users.splice(idx, 1);
    this.save();
    if (this.isMongoConnected) {
      UserModel.deleteOne({ id: removed.id }).catch(err => console.error('Mongo deleteUser error:', err));
    }
    return true;
  }

  public deleteDistributer(idOrCodeOrName: string): boolean {
    const idx = this.data.distributers.findIndex(d => d.id === idOrCodeOrName || d.code === idOrCodeOrName || d.name === idOrCodeOrName);
    if (idx === -1) return false;
    const [removed] = this.data.distributers.splice(idx, 1);
    this.save();
    if (this.isMongoConnected) {
      DistributerModel.deleteOne({ id: removed.id }).catch(err => console.error('Mongo deleteDist error:', err));
    }
    return true;
  }

  public deleteSuperDistributer(idOrCodeOrName: string): boolean {
    const idx = this.data.superdistributers.findIndex(s => s.id === idOrCodeOrName || s.code === idOrCodeOrName || s.name === idOrCodeOrName);
    if (idx === -1) return false;
    const [removed] = this.data.superdistributers.splice(idx, 1);
    this.save();
    if (this.isMongoConnected) {
      SuperDistributerModel.deleteOne({ id: removed.id }).catch(err => console.error('Mongo deleteSD error:', err));
    }
    return true;
  }

  public adjustDistributerBalance(idOrCodeOrName: string, delta: number): Distributer | undefined {
    const dist = this.data.distributers.find(d => d.id === idOrCodeOrName || d.code === idOrCodeOrName || d.name === idOrCodeOrName);
    if (!dist) return undefined;
    dist.balance = Math.max(0, Math.round(((dist.balance || 0) + delta) * 100) / 100);
    this.save();
    if (this.isMongoConnected) {
      DistributerModel.updateOne({ id: dist.id }, { $set: { balance: dist.balance } }).catch(err => console.error('Mongo update Dist balance:', err));
    }
    return dist;
  }

  public adjustSuperDistributerBalance(idOrCodeOrName: string, delta: number): SuperDistributer | undefined {
    const sd = this.data.superdistributers.find(s => s.id === idOrCodeOrName || s.code === idOrCodeOrName || s.name === idOrCodeOrName);
    if (!sd) return undefined;
    sd.balance = Math.max(0, Math.round(((sd.balance || 0) + delta) * 100) / 100);
    this.save();
    if (this.isMongoConnected) {
      SuperDistributerModel.updateOne({ id: sd.id }, { $set: { balance: sd.balance } }).catch(err => console.error('Mongo update SD balance:', err));
    }
    return sd;
  }

  // ---- Transactions ----
  public getTransactions(limit = 100, filterUsername?: string): WalletTransaction[] {
    let list = this.data.transactions;
    if (filterUsername) {
      list = list.filter(t => t.username.toLowerCase() === filterUsername.toLowerCase());
    }
    return list.slice(0, limit);
  }

  // ---- Round History ----
  public getRoundHistory(gameId?: string, limit = 50): RoundHistoryEntry[] {
    let list = this.data.roundHistory;
    if (gameId) {
      if (gameId === 'lucky12' || gameId === 'luckyTimer') {
        list = list.filter(r => r.gameId === 'lucky12' || r.gameId === 'luckyTimer');
      } else {
        list = list.filter(r => r.gameId === gameId);
      }
    }
    return list.slice(0, limit);
  }

  public addRoundHistory(entry: RoundHistoryEntry): void {
    this.data.roundHistory.unshift(entry);
    if (this.data.roundHistory.length > 2000) {
      this.data.roundHistory = this.data.roundHistory.slice(0, 2000);
    }
    this.save();
    if (this.isMongoConnected) {
      RoundHistoryModel.create(entry).catch(err => console.error('Mongo add round history error:', err));
    }
  }

  public deletePlayerHistory(fromStr?: string, toStr?: string): number {
    const fromMs = fromStr ? new Date(fromStr).setHours(0, 0, 0, 0) : 0;
    const toMs = toStr ? new Date(toStr).setHours(23, 59, 59, 999) : Date.now();

    const prevLen = this.data.roundHistory.length;
    this.data.roundHistory = this.data.roundHistory.filter(r => {
      const rTime = new Date(r.time).getTime();
      return !(rTime >= fromMs && rTime <= toMs);
    });
    const deletedCount = prevLen - this.data.roundHistory.length;
    this.save();
    if (this.isMongoConnected && fromStr && toStr) {
      RoundHistoryModel.deleteMany({
        time: { $gte: new Date(fromMs).toISOString(), $lte: new Date(toMs).toISOString() }
      }).catch(err => console.error('Mongo delete round history error:', err));
    }
    return deletedCount;
  }

  // ---- RTP Config ----
  public getRtpConfig(): RtpConfig {
    if (!this.data.rtpConfig) {
      this.data.rtpConfig = { ...INITIAL_DB.rtpConfig };
    }
    if (!this.data.rtpConfig.rankMultipliers) {
      this.data.rtpConfig.rankMultipliers = { J: 10, Q: 10, K: 10, A: 12 };
    }
    return this.data.rtpConfig;
  }

  public updateRtpConfig(updates: Partial<RtpConfig>): RtpConfig {
    Object.assign(this.data.rtpConfig, updates);
    this.save();
    if (this.isMongoConnected) {
      RtpConfigModel.updateOne({ key: 'global' }, { $set: { config: this.data.rtpConfig } }, { upsert: true }).catch(err => console.error('Mongo update RTP error:', err));
    }
    return this.data.rtpConfig;
  }

  // ---- Game Admin Percentage ----
  public getAdminPercentage(gameId: string): number {
    if (!this.data.adminPercentages) {
      this.data.adminPercentages = { lucky12: 20, lucky16: 20, luckyTimer: 20 };
    }
    const val = this.data.adminPercentages[gameId];
    return typeof val === 'number' ? val : 20;
  }

  public setAdminPercentage(gameId: string, percentage: number): void {
    if (!this.data.adminPercentages) {
      this.data.adminPercentages = { lucky12: 20, lucky16: 20, luckyTimer: 20 };
    }
    const clamped = Math.max(0, Math.min(100, Number(percentage) || 20));
    this.data.adminPercentages[gameId] = clamped;
    // Keep lucky12 and luckyTimer in sync
    if (gameId === 'lucky12') this.data.adminPercentages.luckyTimer = clamped;
    if (gameId === 'luckyTimer') this.data.adminPercentages.lucky12 = clamped;
    this.save();
    if (this.isMongoConnected) {
      RtpConfigModel.updateOne({ key: 'percentages' }, { $set: { config: this.data.adminPercentages as any } }, { upsert: true }).catch(err => console.error('Mongo update percentages error:', err));
    }
  }

  public getAllAdminPercentages(): Record<string, number> {
    if (!this.data.adminPercentages) {
      this.data.adminPercentages = { lucky12: 20, lucky16: 20, luckyTimer: 20 };
    }
    return { ...this.data.adminPercentages };
  }

  // ---- Live Game Balance ----
  public getLiveGameBalance(gameId: string): LiveGameBalance {
    const targetId = gameId === 'luckyTimer' ? 'lucky12' : gameId;
    if (!this.data.liveGameBalances) {
      this.data.liveGameBalances = {
        lucky12: { gameBalance: 0, totalCollection: 0, totalPayment: 0 },
        lucky16: { gameBalance: 0, totalCollection: 0, totalPayment: 0 },
      };
    }
    if (!this.data.liveGameBalances[targetId]) {
      this.data.liveGameBalances[targetId] = { gameBalance: 0, totalCollection: 0, totalPayment: 0 };
    }
    return { ...this.data.liveGameBalances[targetId] };
  }

  public getAllLiveGameBalances(): Record<string, LiveGameBalance> {
    if (!this.data.liveGameBalances) {
      this.data.liveGameBalances = {
        lucky12: { gameBalance: 0, totalCollection: 0, totalPayment: 0 },
        lucky16: { gameBalance: 0, totalCollection: 0, totalPayment: 0 },
      };
    }
    const b12 = this.getLiveGameBalance('lucky12');
    const b16 = this.getLiveGameBalance('lucky16');
    return {
      lucky12: { ...b12 },
      lucky16: { ...b16 },
      luckyTimer: { ...b12 },
    };
  }

  public addBetToGameBalance(gameId: string, betPoints: number, adminPct: number): LiveGameBalance {
    const targetId = gameId === 'luckyTimer' ? 'lucky12' : gameId;
    const cur = this.getLiveGameBalance(targetId);
    // Deduct win percentage cut from bet points
    // Example: 2 players bet 10 points each (total 20 points). With 10% win percentage:
    // 2 points are deducted, 18 added to gameBalance
    const deduction = (betPoints * adminPct) / 100;
    const netPoints = betPoints - deduction;
    cur.gameBalance = Math.round((cur.gameBalance + netPoints) * 100) / 100;

    this.data.liveGameBalances![targetId] = cur;
    this.save();
    return cur;
  }

  public addPayoutToGameBalance(gameId: string, payoutPoints: number): LiveGameBalance {
    const targetId = gameId === 'luckyTimer' ? 'lucky12' : gameId;
    const cur = this.getLiveGameBalance(targetId);
    // Winners points are deducted from TOTAL Game Balance, and added to TOTAL PAYMENT
    cur.gameBalance = Math.round((cur.gameBalance - payoutPoints) * 100) / 100;
    cur.totalPayment = Math.round((cur.totalPayment + payoutPoints) * 100) / 100;

    this.data.liveGameBalances![targetId] = cur;
    this.save();
    return cur;
  }

  public resetGameBalance(gameId: string): LiveGameBalance {
    const targetId = gameId === 'luckyTimer' ? 'lucky12' : gameId;
    const cur = this.getLiveGameBalance(targetId);
    // TOTAL COLLECTION is updated when Reset button triggered: TOTAL Game Balance is added into TOTAL COLLECTION
    cur.totalCollection = Math.round((cur.totalCollection + cur.gameBalance) * 100) / 100;
    cur.gameBalance = 0;

    this.data.liveGameBalances![targetId] = cur;
    this.save();
    return cur;
  }

  // ---- User Round History for Player App Reports ----
  public getUserRoundHistory(username: string, limit: number = 50): any[] {
    const all = [...this.data.roundHistory].reverse();
    const userRounds = all.filter(r => (r.allocations || []).some(a => a.username.toLowerCase() === username.toLowerCase()));
    return userRounds.slice(0, limit).map(r => {
      const userAllocs = (r.allocations || []).filter(a => a.username.toLowerCase() === username.toLowerCase());
      const userBet = userAllocs.reduce((s, a) => s + (a.points || 0), 0);
      const userWins = (r.winners || []).filter(w => w.username.toLowerCase() === username.toLowerCase());
      const userWon = userWins.reduce((s, w) => s + (w.winAmount || 0), 0);
      const userTickets = (this.data.unclaimedTickets || []).filter(
        t => (t.roundId === r.roundId || t.roundId === r.id) && t.username.toLowerCase() === username.toLowerCase()
      );
      const isClaimed = userTickets.length > 0 ? userTickets.every(t => t.claimed) : userWon > 0;
      return {
        id: r.id,
        roundId: r.roundId,
        gameId: r.gameId,
        time: r.time,
        winningCard: r.winningCard,
        bet: userBet,
        win: userWon,
        net: userWon - userBet,
        claimed: isClaimed,
      };
    });
  }

  // ---- Activity Logs ----
  public addActivityLog(entry: { username: string; subject: string; url: string; method: string; ip?: string; userId?: string }): ActivityLog {
    if (!this.data.activityLogs) this.data.activityLogs = [];
    const log: ActivityLog = {
      id: 'LOG-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
      createdAt: new Date().toISOString(),
      ip: entry.ip || '127.0.0.1',
      ...entry,
    };
    this.data.activityLogs.unshift(log);
    if (this.data.activityLogs.length > 500) {
      this.data.activityLogs.pop();
    }
    this.save();
    return log;
  }

  public getActivityLogs(limit = 100, dateFilter?: string): ActivityLog[] {
    if (!this.data.activityLogs) {
      this.data.activityLogs = [
        { id: 'LOG-1', username: 'admin', subject: 'Admin Logged in successfully', url: '/login', method: 'POST', ip: '127.0.0.1', createdAt: new Date().toISOString() },
        { id: 'LOG-2', username: 'admin', subject: 'Viewed Turnover Report', url: '/TurnOver_Report', method: 'GET', ip: '127.0.0.1', createdAt: new Date(Date.now() - 3600000).toISOString() },
        { id: 'LOG-3', username: 'admin', subject: 'Viewed Transaction Report', url: '/transaction', method: 'GET', ip: '127.0.0.1', createdAt: new Date(Date.now() - 7200000).toISOString() },
      ];
      this.save();
    }
    let list = this.data.activityLogs;
    if (dateFilter) {
      list = list.filter(l => l.createdAt.startsWith(dateFilter));
    }
    return list.slice(0, limit);
  }

  // ---- Commission Payout Records ----
  public addCommissionPayoutRecord(rec: { username: string; role: string; oldCommission: number; amount: number; newCommission: number }): CommissionPayoutRecord {
    if (!this.data.commissionPayoutRecords) this.data.commissionPayoutRecords = [];
    const payout: CommissionPayoutRecord = {
      id: 'PAY-' + Math.random().toString(36).substring(2, 9).toUpperCase(),
      createdAt: new Date().toISOString(),
      ...rec,
    };
    this.data.commissionPayoutRecords.unshift(payout);
    this.save();
    return payout;
  }

  public getCommissionPayoutRecords(): CommissionPayoutRecord[] {
    if (!this.data.commissionPayoutRecords) this.data.commissionPayoutRecords = [];
    return [...this.data.commissionPayoutRecords];
  }

  public async clearAllData(): Promise<void> {
    this.data = {
      users: [
        { id: 'admin-001', username: 'admin', name: 'Administrator', password: 'admin', role: 'admin', balance: 1000000, status: 'active', createdAt: new Date().toISOString() },
      ],
      superdistributers: [],
      distributers: [],
      transactions: [],
      roundHistory: [],
      adminPercentages: { lucky12: 20, lucky16: 20, luckyTimer: 20 },
      liveGameBalances: {
        lucky12: { gameBalance: 0, totalCollection: 0, totalPayment: 0 },
        lucky16: { gameBalance: 0, totalCollection: 0, totalPayment: 0 },
        luckyTimer: { gameBalance: 0, totalCollection: 0, totalPayment: 0 },
      },
      rtpConfig: {
        houseMargin: 13.6,
        playerRtp: 86.4,
        algoStatus: 'Adaptive Dynamic Balancing',
        riskThreshold: 'Medium (Standard)',
        rankMultipliers: { J: 10, Q: 10, K: 10, A: 12 },
        rankWeights: { J: 33.3, Q: 33.3, K: 33.3 },
        rankStatus: { J: 'Auto-Tuned', Q: 'Auto-Tuned', K: 'Auto-Tuned' },
      },
      activityLogs: [],
      commissionPayoutRecords: [],
    };
    this.saveSync();

    if (this.isMongoConnected) {
      try {
        await Promise.allSettled([
          UserModel.deleteMany({ role: { $ne: 'admin' } }),
          SuperDistributerModel.deleteMany({}),
          DistributerModel.deleteMany({}),
          TransactionModel.deleteMany({}),
          RoundHistoryModel.deleteMany({}),
        ]);
      } catch (err) {
        console.error('[DB] Error clearing MongoDB collections:', err);
      }
    }
  }
}

export const db = new Database();

