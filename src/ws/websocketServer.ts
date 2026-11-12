import { Server as HttpServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { GameId } from '../types';
import { gameEngine } from '../game/gameEngine';
import { db } from '../store/db';

interface ConnectedClient {
  id: string;
  ws: WebSocket;
  username?: string;
  sessionToken?: string;
  gameId?: GameId;
  isAdmin: boolean;
  connectedAt: number;
}

export class WsServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private sessionCheckTimer: NodeJS.Timeout | null = null;

  public init(httpServer: HttpServer): void {
    this.wss = new WebSocketServer({ server: httpServer });

    this.wss.on('connection', (ws: WebSocket) => {
      const clientId = 'CLI-' + Math.random().toString(36).substring(2, 9);
      const client: ConnectedClient = {
        id: clientId,
        ws,
        isAdmin: false,
        connectedAt: Date.now(),
      };
      this.clients.set(clientId, client);

      ws.on('message', (messageRaw: WebSocket.RawData) => {
        try {
          const str = messageRaw.toString();
          const parsed = JSON.parse(str);
          this.handleClientMessage(client, parsed);
        } catch (err) {
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

    if (this.sessionCheckTimer) clearInterval(this.sessionCheckTimer);
    this.sessionCheckTimer = setInterval(() => {
      const expired = db.pruneExpiredSessions();
      for (const session of expired) {
        this.notifySessionEnded(session.username, 'expired', session.token);
      }
    }, 15000);
  }

  private ensureActiveUserWs(
    client: ConnectedClient,
    incomingToken?: string
  ): { username: string; session: NonNullable<ReturnType<typeof db.getSessionByToken>> } | null {
    const token = (typeof incomingToken === 'string' && incomingToken.trim()) || client.sessionToken;
    if (!token) {
      this.send(client.ws, 'session_expired', {
        reason: 'auth_required',
        message: 'Authentication required. Please login again.',
      });
      client.username = undefined;
      client.sessionToken = undefined;
      client.isAdmin = false;
      return null;
    }

    const session = db.getSessionByToken(token);
    if (!session) {
      this.send(client.ws, 'session_expired', {
        reason: 'expired',
        message: 'Your session has expired or been logged out. Please login again.',
      });
      client.username = undefined;
      client.sessionToken = undefined;
      client.isAdmin = false;
      this.broadcastOnlinePlayers();
      return null;
    }

    const user = db.getUserByUsername(session.username);
    if (!user || user.status === 'blocked') {
      db.clearSessionByToken(token);
      this.send(client.ws, 'session_expired', {
        reason: 'blocked',
        message: 'Your account is blocked or unavailable.',
      });
      client.username = undefined;
      client.sessionToken = undefined;
      client.isAdmin = false;
      this.broadcastOnlinePlayers();
      return null;
    }

    client.sessionToken = session.token;
    client.username = session.username;
    return { username: session.username, session };
  }

  private ensureActiveAdminWs(client: ConnectedClient, incomingToken?: string): boolean {
    const checked = this.ensureActiveUserWs(client, incomingToken);
    if (!checked) return false;
    const role = checked.session.role;
    if (role !== 'admin' && role !== 'distributer' && role !== 'superdistributer') {
      this.send(client.ws, 'session_expired', {
        reason: 'forbidden',
        message: 'Administrator privileges required.',
      });
      client.isAdmin = false;
      return false;
    }
    client.isAdmin = true;
    return true;
  }

  public notifySessionEnded(
    username: string,
    reason: 'expired' | 'logged_out' | 'force_logged_out' | 'blocked',
    token?: string
  ): void {
    const unameLower = username.trim().toLowerCase();
    const message =
      reason === 'expired'
        ? 'Your 12-hour session has expired. Please login again.'
        : reason === 'force_logged_out'
          ? 'Your session was ended by an administrator. Please login again.'
          : reason === 'blocked'
            ? 'Your account has been blocked by administrator.'
            : 'You have been logged out. Please login again.';

    this.clients.forEach((c) => {
      const matchesUser = c.username && c.username.toLowerCase() === unameLower;
      const matchesToken = token && c.sessionToken && c.sessionToken === token;
      if (matchesUser || matchesToken) {
        this.send(c.ws, 'session_expired', {
          reason,
          username,
          message,
        });
        c.username = undefined;
        c.sessionToken = undefined;
        c.isAdmin = false;
      }
    });
    this.broadcastOnlinePlayers();
    this.broadcastToAdmins('user_session_updated', {
      username,
      hasActiveSession: false,
      reason,
    });
  }

  private handleClientMessage(client: ConnectedClient, payload: any): void {
    // Both { event: 'name', data: {...} } and { type: 'name', ... } envelopes are supported
    const event = payload.event || payload.type;
    const data = payload.data !== undefined ? payload.data : payload;

    switch (event) {
      case 'ping':
        this.send(client.ws, 'pong', { time: Date.now() });
        break;

      case 'join_game': {
        const checked = this.ensureActiveUserWs(client, data.token);
        if (!checked) break;
        const gameId: GameId = data.gameId || 'lucky12';
        const username: string = checked.username;
        client.gameId = gameId;

        const user = db.getUserByUsername(username);
        const round = gameEngine.getRound(gameId);
        const history = db.getRoundHistory(gameId, 15);

        const unclaimed = user ? db.getUserUnclaimedAmount(user.username) : 0;
        this.send(client.ws, 'game_state', {
          gameId,
          round: round ? gameEngine.sanitizeRound(round) : null,
          history,
          user: user ? { username: user.username, balance: user.balance } : null,
          unclaimed,
        });

        this.broadcastOnlinePlayers();
        break;
      }

      case 'admin_subscribe': {
        if (!this.ensureActiveAdminWs(client, data.token)) break;
        const activeRounds = gameEngine.getAllActiveRounds();
        const history = db.getRoundHistory(undefined, 20);
        const online = this.getOnlinePlayersList();

        this.send(client.ws, 'admin_state', {
          activeRounds,
          history,
          online,
          users: db.getUsers(),
          rtpConfig: db.getRtpConfig(),
          liveGameBalances: db.getAllLiveGameBalances(),
        });
        break;
      }

      case 'place_bet': {
        const checked = this.ensureActiveUserWs(client, data.token);
        if (!checked) break;
        const gameId: GameId = data.gameId || client.gameId || 'lucky12';
        const username: string = checked.username;
        const bets = Array.isArray(data.bets) ? data.bets : [{ targetIndex: data.targetIndex, points: data.points }];

        const user = db.getUserByUsername(username);
        const totalBatchPoints = bets.reduce((sum: number, b: any) => sum + (Number(b.points) || 0), 0);
        if (user && user.balance < totalBatchPoints) {
          this.send(client.ws, 'bet_error', {
            error: 'Insufficient credits for bet',
            totalNeeded: totalBatchPoints,
            currentBalance: user.balance,
          });
          break;
        }

        const batchTicketId = gameEngine.generateTicketId();
        for (const b of bets) {
          const res = gameEngine.placeAllocation(gameId, username, b.targetIndex, b.points, false, batchTicketId);
          if (!res.success) {
            this.send(client.ws, 'bet_error', { error: res.error, targetIndex: b.targetIndex });
          } else {
            this.send(client.ws, 'bet_success', {
              allocation: res.allocation,
              ticketId: res.ticketId || batchTicketId,
              newBalance: res.newBalance,
            });
            this.broadcastOnlinePlayers();
          }
        }
        break;
      }

      case 'claim_all': {
        const checked = this.ensureActiveUserWs(client, data.token);
        if (!checked) break;
        const username: string = checked.username;
        const res = db.claimTickets(username);
        if (!res.success) {
          this.send(client.ws, 'claim_error', { error: res.error });
        } else {
          this.send(client.ws, 'claim_success', {
            claimedAmount: res.claimedAmount,
            newBalance: res.newBalance,
            unclaimed: 0,
          });
          this.sendToUser(username, 'balance_updated', {
            username,
            balance: res.newBalance,
          });
          this.broadcastToAdmins('user_balance_updated', {
            username,
            balance: res.newBalance,
          });
          this.broadcastToAdmins('ticket_claimed', {
            username,
            claimedAmount: res.claimedAmount,
            newBalance: res.newBalance,
          });
          this.broadcastOnlinePlayers();
        }
        break;
      }

      case 'claim_ticket': {
        const checked = this.ensureActiveUserWs(client, data.token);
        if (!checked) break;
        const username: string = checked.username;
        const ticketId: string = data.ticketId;
        const res = db.claimTickets(username, ticketId);
        if (!res.success) {
          this.send(client.ws, 'claim_error', { error: res.error });
        } else {
          const remainingUnclaimed = db.getUserUnclaimedAmount(username);
          this.send(client.ws, 'claim_success', {
            claimedAmount: res.claimedAmount,
            newBalance: res.newBalance,
            unclaimed: remainingUnclaimed,
            ticketId,
          });
          this.sendToUser(username, 'balance_updated', {
            username,
            balance: res.newBalance,
          });
          this.broadcastToAdmins('user_balance_updated', {
            username,
            balance: res.newBalance,
          });
          this.broadcastToAdmins('ticket_claimed', {
            username,
            ticketId,
            claimedAmount: res.claimedAmount,
            newBalance: res.newBalance,
          });
          this.broadcastOnlinePlayers();
        }
        break;
      }

      case 'get_unclaimed_tickets': {
        const checked = this.ensureActiveUserWs(client, data.token);
        if (!checked) break;
        const username: string = checked.username;
        const tickets = db.getUnclaimedTickets(username);
        this.send(client.ws, 'unclaimed_tickets', { tickets });
        break;
      }

      case 'admin_set_forced_winner': {
        if (!this.ensureActiveAdminWs(client, data.token)) break;
        const { gameId, index, mode, multiplier, cardLabel } = data;
        gameEngine.setForcedWinner(gameId, index !== undefined ? Number(index) : null, mode, multiplier, cardLabel);
        break;
      }

      case 'admin_force_lock': {
        if (!this.ensureActiveAdminWs(client, data.token)) break;
        const { gameId } = data;
        gameEngine.forceLockAndReveal(gameId);
        break;
      }

      case 'admin_set_percentages': {
        if (!this.ensureActiveAdminWs(client, data.token)) break;
        const { lucky_cards_12, lucky_cards_16, lucky12, lucky16, luckyTimer } = data;
        if (lucky_cards_12 !== undefined || lucky12 !== undefined) {
          db.setAdminPercentage('lucky12', Number(lucky_cards_12 ?? lucky12));
        }
        if (lucky_cards_16 !== undefined || lucky16 !== undefined) {
          db.setAdminPercentage('lucky16', Number(lucky_cards_16 ?? lucky16));
        }
        if (luckyTimer !== undefined) {
          db.setAdminPercentage('luckyTimer', Number(luckyTimer));
        }
        this.broadcastToAdmins('game_percentages_updated', db.getAllAdminPercentages());
        break;
      }

      case 'admin_update_rtp': {
        if (!this.ensureActiveAdminWs(client, data.token)) break;
        const { rtpConfig } = data;
        if (rtpConfig) {
          const updated = db.updateRtpConfig(rtpConfig);
          this.broadcastToAdmins('rtp_updated', { rtpConfig: updated });
        }
        break;
      }

      case 'admin_reset_game_balance': {
        if (!this.ensureActiveAdminWs(client, data.token)) break;
        const gameId: string = data.gameId || 'lucky12';
        const updatedBal = db.resetGameBalance(gameId);
        this.broadcastToAdmins('live_balance_updated', {
          gameId,
          liveBalance: updatedBal,
          allBalances: db.getAllLiveGameBalances(),
        });
        break;
      }

      default:
        break;
    }
  }

  private bindGameEngineEvents(): void {
    gameEngine.on('round_started', ({ gameId, round }) => {
      this.broadcastToGame(gameId, 'round_start', { gameId, round });
      this.broadcastToAdmins('round_start', { gameId, round });
    });

    gameEngine.on('game_timer', (timerData) => {
      this.broadcastToGame(timerData.gameId, 'game_timer', timerData);
      this.broadcastToAdmins('game_timer', timerData);
    });

    gameEngine.on('betting_closed', (closedData) => {
      this.broadcastToGame(closedData.gameId, 'betting_closed', closedData);
      this.broadcastToAdmins('betting_closed', closedData);
    });

    gameEngine.on('new_allocation', (allocData) => {
      this.broadcastToGame(allocData.gameId, 'new_allocation', allocData);
      this.broadcastToAdmins('new_allocation', allocData);
    });

    gameEngine.on('game_result', (resultData) => {
      this.broadcastToGame(resultData.gameId, 'game_result', resultData);
      this.broadcastToAdmins('game_result', resultData);
    });

    gameEngine.on('user_balance_updated', ({ username, balance }) => {
      this.sendToUser(username, 'balance_updated', { username, balance });
      this.broadcastToAdmins('user_balance_updated', { username, balance });
    });

    gameEngine.on('admin_forced_updated', (forcedData) => {
      this.broadcastToAdmins('admin_forced_updated', forcedData);
    });

    gameEngine.on('live_balance_updated', (balanceData) => {
      this.broadcastToAdmins('live_balance_updated', balanceData);
    });
  }

  public send(ws: WebSocket, event: string, data: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, data, timestamp: Date.now() }));
    }
  }

  public broadcastToGame(gameId: GameId, event: string, data: any): void {
    const payload = JSON.stringify({ event, data, timestamp: Date.now() });
    this.clients.forEach((c) => {
      if (c.gameId === gameId && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(payload);
      }
    });
  }

  public broadcastToAdmins(event: string, data: any): void {
    const payload = JSON.stringify({ event, data, timestamp: Date.now() });
    this.clients.forEach((c) => {
      if (c.isAdmin && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(payload);
      }
    });
  }

  public sendToUser(username: string, event: string, data: any): void {
    const payload = JSON.stringify({ event, data, timestamp: Date.now() });
    this.clients.forEach((c) => {
      if (c.username && c.username.toLowerCase() === username.toLowerCase() && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(payload);
      }
    });
  }

  public getOnlinePlayersList(): any[] {
    const active = new Map<string, any>();
    const dead: string[] = [];
    this.clients.forEach((c, id) => {
      if (!c.ws || c.ws.readyState !== WebSocket.OPEN) {
        dead.push(id);
        return;
      }
      const uname = (c.username || '').trim();
      if (uname && !c.isAdmin && uname.toLowerCase() !== 'admin' && uname.toLowerCase() !== 'player') {
        const u = db.getUserByUsername(uname);
        active.set(uname.toLowerCase(), {
          username: uname,
          name: u?.name || uname,
          balance: u?.balance ?? 10000,
          gameId: c.gameId || 'lucky12',
          connectedAt: c.connectedAt,
        });
      }
    });
    dead.forEach((id) => this.clients.delete(id));
    return Array.from(active.values());
  }

  public broadcastOnlinePlayers(): void {
    const list = this.getOnlinePlayersList();
    this.broadcastToAdmins('online_players', { count: list.length, players: list });
  }
}

export const wsServer = new WsServer();
