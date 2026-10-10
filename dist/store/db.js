"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_DIR = path_1.default.resolve(__dirname, '../../data');
const DB_FILE = path_1.default.join(DATA_DIR, 'db.json');
const INITIAL_DB = {
    users: [
        { id: 'demo-001', username: 'demo', name: 'Demo id', password: '123', role: 'user', balance: 50000, status: 'active', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'user-002', username: 'Kevin', name: 'Kevin', password: '123', role: 'user', balance: 12400, status: 'active', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 'user-003', username: 'RJ', name: 'RJ', password: '123', role: 'user', balance: 18500, status: 'active', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 'user-004', username: 'Kesri', name: 'Kesri', password: '123', role: 'user', balance: 9400, status: 'active', createdAt: '2026-01-02T00:00:00.000Z' },
        { id: 'user-005', username: 'Meera', name: 'Meera', password: '123', role: 'user', balance: 22000, status: 'active', createdAt: '2026-01-03T00:00:00.000Z' },
        { id: 'user-006', username: 'Tobi', name: 'Tobi', password: '123', role: 'user', balance: 7500, status: 'active', createdAt: '2026-01-03T00:00:00.000Z' },
        { id: 'user-007', username: 'Ana', name: 'Ana', password: '123', role: 'user', balance: 14000, status: 'active', createdAt: '2026-01-04T00:00:00.000Z' },
        { id: 'user-008', username: 'Sam', name: 'Sam', password: '123', role: 'user', balance: 31000, status: 'active', createdAt: '2026-01-04T00:00:00.000Z' },
        { id: 'user-009', username: 'Priya', name: 'Priya', password: '123', role: 'user', balance: 16800, status: 'active', createdAt: '2026-01-05T00:00:00.000Z' },
        { id: 'admin-001', username: 'admin', name: 'Administrator', password: 'admin', role: 'admin', balance: 1000000, status: 'active', createdAt: '2026-01-01T00:00:00.000Z' },
    ],
    superdistributers: [
        { id: 'SD-101', name: 'Apex Gaming Hub', code: 'APEX', commission: 2.5, balance: 125000, status: 'active', usersCount: 142, createdAt: '2026-01-01' },
        { id: 'SD-102', name: 'Royal Club Dist', code: 'ROYAL', commission: 2.0, balance: 84000, status: 'active', usersCount: 98, createdAt: '2026-01-05' },
        { id: 'SD-103', name: 'Premier Gaming', code: 'PREM', commission: 2.8, balance: 210000, status: 'active', usersCount: 220, createdAt: '2026-01-10' },
    ],
    distributers: [
        { id: 'D-201', superId: 'SD-101', name: 'Gold Star Network', code: 'GOLD', commission: 1.5, balance: 42000, status: 'active', usersCount: 45, createdAt: '2026-01-02' },
        { id: 'D-202', superId: 'SD-101', name: 'Silver Play Network', code: 'SILVER', commission: 1.2, balance: 28500, status: 'active', usersCount: 32, createdAt: '2026-01-04' },
        { id: 'D-203', superId: 'SD-102', name: 'Vegas Star Club', code: 'VEGAS', commission: 1.4, balance: 36000, status: 'active', usersCount: 51, createdAt: '2026-01-06' },
    ],
    transactions: [
        { id: 'TX-1001', userId: 'demo-001', username: 'demo', type: 'deposit', amount: 50000, description: 'Initial balance', time: new Date().toISOString(), balanceAfter: 50000 },
    ],
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
    data;
    saveTimeout = null;
    constructor() {
        if (!fs_1.default.existsSync(DATA_DIR)) {
            fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs_1.default.existsSync(DB_FILE)) {
            try {
                const raw = fs_1.default.readFileSync(DB_FILE, 'utf-8');
                this.data = JSON.parse(raw);
                // Ensure defaults if keys missing
                this.data = { ...INITIAL_DB, ...this.data };
            }
            catch (err) {
                console.error('Failed reading DB file, using initial data:', err);
                this.data = JSON.parse(JSON.stringify(INITIAL_DB));
                this.saveSync();
            }
        }
        else {
            this.data = JSON.parse(JSON.stringify(INITIAL_DB));
            this.saveSync();
        }
    }
    save() {
        if (this.saveTimeout)
            clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => {
            this.saveSync();
        }, 200);
    }
    saveSync() {
        try {
            fs_1.default.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
        }
        catch (e) {
            console.error('Error writing DB file:', e);
        }
    }
    // ---- Users ----
    getUsers() {
        return this.data.users;
    }
    getUserById(id) {
        return this.data.users.find(u => u.id === id);
    }
    getUserByUsername(username) {
        return this.data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    }
    addUser(user) {
        this.data.users.push(user);
        this.save();
        return user;
    }
    updateUser(id, updates) {
        const user = this.getUserById(id);
        if (!user)
            return undefined;
        Object.assign(user, updates);
        this.save();
        return user;
    }
    adjustUserBalance(username, delta, description, type = 'credit', roundId, gameId) {
        const user = this.getUserByUsername(username);
        if (!user)
            return undefined;
        user.balance = Math.max(0, Math.round((user.balance + delta) * 100) / 100);
        const tx = {
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
        // Keep max 5000 transactions
        if (this.data.transactions.length > 5000) {
            this.data.transactions = this.data.transactions.slice(0, 5000);
        }
        this.save();
        return { user, tx };
    }
    // ---- Superdistributers & Distributers ----
    getSuperDistributers() {
        return this.data.superdistributers;
    }
    addSuperDistributer(sd) {
        this.data.superdistributers.push(sd);
        this.save();
        return sd;
    }
    updateSuperDistributer(id, updates) {
        const sd = this.data.superdistributers.find(s => s.id === id);
        if (!sd)
            return undefined;
        Object.assign(sd, updates);
        this.save();
        return sd;
    }
    getDistributers() {
        return this.data.distributers;
    }
    addDistributer(dist) {
        this.data.distributers.push(dist);
        this.save();
        return dist;
    }
    updateDistributer(id, updates) {
        const dist = this.data.distributers.find(d => d.id === id);
        if (!dist)
            return undefined;
        Object.assign(dist, updates);
        this.save();
        return dist;
    }
    // ---- Transactions ----
    getTransactions(limit = 100, filterUsername) {
        let list = this.data.transactions;
        if (filterUsername) {
            list = list.filter(t => t.username.toLowerCase() === filterUsername.toLowerCase());
        }
        return list.slice(0, limit);
    }
    // ---- Round History ----
    getRoundHistory(gameId, limit = 50) {
        let list = this.data.roundHistory;
        if (gameId) {
            list = list.filter(r => r.gameId === gameId);
        }
        return list.slice(0, limit);
    }
    addRoundHistory(entry) {
        this.data.roundHistory.unshift(entry);
        if (this.data.roundHistory.length > 2000) {
            this.data.roundHistory = this.data.roundHistory.slice(0, 2000);
        }
        this.save();
    }
    // ---- RTP Config ----
    getRtpConfig() {
        return this.data.rtpConfig;
    }
    updateRtpConfig(updates) {
        Object.assign(this.data.rtpConfig, updates);
        this.save();
        return this.data.rtpConfig;
    }
}
exports.db = new Database();
