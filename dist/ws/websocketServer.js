"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsServer = exports.WsServer = void 0;
const ws_1 = __importStar(require("ws"));
const gameEngine_1 = require("../game/gameEngine");
const db_1 = require("../store/db");
class WsServer {
    wss = null;
    clients = new Map();
    init(httpServer) {
        this.wss = new ws_1.WebSocketServer({ server: httpServer });
        this.wss.on('connection', (ws) => {
            const clientId = 'CLI-' + Math.random().toString(36).substring(2, 9);
            const client = {
                id: clientId,
                ws,
                isAdmin: false,
                connectedAt: Date.now(),
            };
            this.clients.set(clientId, client);
            ws.on('message', (messageRaw) => {
                try {
                    const str = messageRaw.toString();
                    const parsed = JSON.parse(str);
                    this.handleClientMessage(client, parsed);
                }
                catch (err) {
                    console.error('Error parsing client message:', err);
                }
            });
            ws.on('close', () => {
                this.clients.delete(clientId);
                this.broadcastOnlinePlayers();
            });
            ws.on('error', (err) => {
                console.error('WS client error:', err);
                this.clients.delete(clientId);
                this.broadcastOnlinePlayers();
            });
            // Send initial welcome
            this.send(ws, 'connected', { clientId, serverTime: Date.now() });
            this.broadcastOnlinePlayers();
        });
        this.bindGameEngineEvents();
    }
    handleClientMessage(client, payload) {
        // Both { event: 'name', data: {...} } and { type: 'name', ... } envelopes are supported
        const event = payload.event || payload.type;
        const data = payload.data !== undefined ? payload.data : payload;
        switch (event) {
            case 'ping':
                this.send(client.ws, 'pong', { time: Date.now() });
                break;
            case 'join_game': {
                const gameId = data.gameId || 'lucky12';
                const username = data.username || 'demo';
                client.gameId = gameId;
                client.username = username;
                const round = gameEngine_1.gameEngine.getRound(gameId);
                const history = db_1.db.getRoundHistory(gameId, 15);
                const user = db_1.db.getUserByUsername(username);
                this.send(client.ws, 'game_state', {
                    gameId,
                    round: round ? gameEngine_1.gameEngine.sanitizeRound(round) : null,
                    history,
                    user: user ? { username: user.username, balance: user.balance } : null,
                });
                this.broadcastOnlinePlayers();
                break;
            }
            case 'admin_subscribe': {
                client.isAdmin = true;
                const activeRounds = gameEngine_1.gameEngine.getAllActiveRounds();
                const history = db_1.db.getRoundHistory(undefined, 20);
                const online = this.getOnlinePlayersList();
                this.send(client.ws, 'admin_state', {
                    activeRounds,
                    history,
                    online,
                    users: db_1.db.getUsers(),
                    rtpConfig: db_1.db.getRtpConfig(),
                });
                break;
            }
            case 'place_bet': {
                const gameId = data.gameId || client.gameId || 'lucky12';
                const username = data.username || client.username || 'demo';
                const bets = Array.isArray(data.bets) ? data.bets : [{ targetIndex: data.targetIndex, points: data.points }];
                for (const b of bets) {
                    const res = gameEngine_1.gameEngine.placeAllocation(gameId, username, b.targetIndex, b.points, false);
                    if (!res.success) {
                        this.send(client.ws, 'bet_error', { error: res.error, targetIndex: b.targetIndex });
                    }
                    else {
                        this.send(client.ws, 'bet_success', {
                            allocation: res.allocation,
                            newBalance: res.newBalance,
                        });
                    }
                }
                break;
            }
            case 'admin_set_forced_winner': {
                const { gameId, index, mode, multiplier } = data;
                gameEngine_1.gameEngine.setForcedWinner(gameId, index, mode, multiplier);
                break;
            }
            case 'admin_force_lock': {
                const { gameId } = data;
                gameEngine_1.gameEngine.forceLockAndReveal(gameId);
                break;
            }
            case 'admin_update_rtp': {
                const { rtpConfig } = data;
                if (rtpConfig) {
                    const updated = db_1.db.updateRtpConfig(rtpConfig);
                    this.broadcastToAdmins('rtp_updated', { rtpConfig: updated });
                }
                break;
            }
            default:
                break;
        }
    }
    bindGameEngineEvents() {
        gameEngine_1.gameEngine.on('round_started', ({ gameId, round }) => {
            this.broadcastToGame(gameId, 'round_start', { gameId, round });
            this.broadcastToAdmins('round_start', { gameId, round });
        });
        gameEngine_1.gameEngine.on('game_timer', (timerData) => {
            this.broadcastToGame(timerData.gameId, 'game_timer', timerData);
            this.broadcastToAdmins('game_timer', timerData);
        });
        gameEngine_1.gameEngine.on('betting_closed', (closedData) => {
            this.broadcastToGame(closedData.gameId, 'betting_closed', closedData);
            this.broadcastToAdmins('betting_closed', closedData);
        });
        gameEngine_1.gameEngine.on('new_allocation', (allocData) => {
            this.broadcastToGame(allocData.gameId, 'new_allocation', allocData);
            this.broadcastToAdmins('new_allocation', allocData);
        });
        gameEngine_1.gameEngine.on('game_result', (resultData) => {
            this.broadcastToGame(resultData.gameId, 'game_result', resultData);
            this.broadcastToAdmins('game_result', resultData);
        });
        gameEngine_1.gameEngine.on('user_balance_updated', ({ username, balance }) => {
            this.sendToUser(username, 'balance_updated', { username, balance });
            this.broadcastToAdmins('user_balance_updated', { username, balance });
        });
        gameEngine_1.gameEngine.on('admin_forced_updated', (forcedData) => {
            this.broadcastToAdmins('admin_forced_updated', forcedData);
        });
    }
    send(ws, event, data) {
        if (ws.readyState === ws_1.default.OPEN) {
            ws.send(JSON.stringify({ event, data, timestamp: Date.now() }));
        }
    }
    broadcastToGame(gameId, event, data) {
        const payload = JSON.stringify({ event, data, timestamp: Date.now() });
        this.clients.forEach((c) => {
            if (c.gameId === gameId && c.ws.readyState === ws_1.default.OPEN) {
                c.ws.send(payload);
            }
        });
    }
    broadcastToAdmins(event, data) {
        const payload = JSON.stringify({ event, data, timestamp: Date.now() });
        this.clients.forEach((c) => {
            if (c.isAdmin && c.ws.readyState === ws_1.default.OPEN) {
                c.ws.send(payload);
            }
        });
    }
    sendToUser(username, event, data) {
        const payload = JSON.stringify({ event, data, timestamp: Date.now() });
        this.clients.forEach((c) => {
            if (c.username && c.username.toLowerCase() === username.toLowerCase() && c.ws.readyState === ws_1.default.OPEN) {
                c.ws.send(payload);
            }
        });
    }
    getOnlinePlayersList() {
        const active = new Map();
        this.clients.forEach((c) => {
            if (c.username) {
                const u = db_1.db.getUserByUsername(c.username);
                active.set(c.username, {
                    username: c.username,
                    name: u?.name || c.username,
                    balance: u?.balance ?? 0,
                    gameId: c.gameId || 'lobby',
                    connectedAt: c.connectedAt,
                });
            }
        });
        return Array.from(active.values());
    }
    broadcastOnlinePlayers() {
        const list = this.getOnlinePlayersList();
        this.broadcastToAdmins('online_players', { count: list.length, players: list });
    }
}
exports.WsServer = WsServer;
exports.wsServer = new WsServer();
