import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { User, SuperDistributer, Distributer, WalletTransaction, RoundHistoryEntry, RtpConfig } from '../types';
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
        this.data = { ...INITIAL_DB, ...parsed };
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
      list = list.filter(r => r.gameId === gameId);
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

  // ---- RTP Config ----
  public getRtpConfig(): RtpConfig {
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
}

export const db = new Database();
