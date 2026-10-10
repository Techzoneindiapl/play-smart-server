import { Router, Request, Response } from 'express';
import { GameId } from '../types';
import { db } from '../store/db';
import { gameEngine } from '../game/gameEngine';
import { wsServer } from '../ws/websocketServer';

const router = Router();

// ---- Users Management ----
router.get('/users', (_req: Request, res: Response) => {
  return res.json(db.getUsers());
});

router.post('/users', (req: Request, res: Response) => {
  const { username, name, password, balance, status, role, distributerId, superdistributerId } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const existing = db.getUserByUsername(username);
  if (existing) {
    const updated = db.updateUser(existing.id, {
      name: name || existing.name,
      status: status || existing.status,
      balance: balance !== undefined ? Number(balance) : existing.balance,
      distributerId: distributerId || existing.distributerId,
      superdistributerId: superdistributerId || existing.superdistributerId,
    });
    return res.json(updated);
  }

  const newUser = db.addUser({
    id: 'usr-' + Math.random().toString(36).substring(2, 9),
    username: username.trim(),
    name: name || username.trim(),
    password: password || '123',
    role: role || 'user',
    balance: balance ? Number(balance) : 10000,
    status: status || 'active',
    distributerId,
    superdistributerId,
    createdAt: new Date().toISOString(),
  });

  return res.json(newUser);
});

router.post('/users/:id/status', (req: Request, res: Response) => {
  const { status } = req.body;
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const updated = db.updateUser(userId, { status });
  if (!updated) return res.status(404).json({ error: 'User not found' });
  return res.json(updated);
});

// ---- Wallet Adjustments ----
router.post('/wallet/adjust', (req: Request, res: Response) => {
  const { username, delta, description } = req.body;
  if (!username || delta === undefined) {
    return res.status(400).json({ error: 'Username and delta amount are required' });
  }

  const result = db.adjustUserBalance(
    username,
    Number(delta),
    description || (delta > 0 ? 'Admin Credit' : 'Admin Debit'),
    delta > 0 ? 'credit' : 'withdrawal'
  );

  if (!result) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Real-time broadcast balance update
  wsServer.sendToUser(username, 'balance_updated', {
    username,
    balance: result.user.balance,
  });

  return res.json({
    success: true,
    user: result.user,
    transaction: result.tx,
  });
});

// ---- SuperDistributers & Distributers ----
router.get('/superdistributers', (_req: Request, res: Response) => {
  return res.json(db.getSuperDistributers());
});

router.post('/superdistributers', (req: Request, res: Response) => {
  const { name, code, commission, balance } = req.body;
  const sd = db.addSuperDistributer({
    id: 'SD-' + Math.floor(100 + Math.random() * 900),
    name: name || 'Super Distributer',
    code: code || ('SD' + Math.floor(10 + Math.random() * 90)),
    commission: Number(commission) || 2.5,
    balance: Number(balance) || 50000,
    status: 'active',
    usersCount: 0,
    createdAt: new Date().toISOString().slice(0, 10),
  });
  return res.json(sd);
});

router.get('/distributers', (_req: Request, res: Response) => {
  return res.json(db.getDistributers());
});

router.post('/distributers', (req: Request, res: Response) => {
  const { name, code, commission, balance, superId } = req.body;
  const dist = db.addDistributer({
    id: 'D-' + Math.floor(200 + Math.random() * 800),
    superId: superId || 'SD-101',
    name: name || 'Distributer',
    code: code || ('D' + Math.floor(10 + Math.random() * 90)),
    commission: Number(commission) || 1.5,
    balance: Number(balance) || 25000,
    status: 'active',
    usersCount: 0,
    createdAt: new Date().toISOString().slice(0, 10),
  });
  return res.json(dist);
});

// ---- Reports ----
router.get('/reports/turnover', (_req: Request, res: Response) => {
  const history = db.getRoundHistory(undefined, 2000);
  const now = Date.now();

  const getStats = (hours: number) => {
    const cutoff = now - hours * 3600 * 1000;
    const filtered = history.filter(h => new Date(h.time).getTime() >= cutoff);
    const allocated = filtered.reduce((s, h) => s + h.totalBets, 0);
    const payout = filtered.reduce((s, h) => s + h.totalPayouts, 0);
    const rounds = filtered.length;
    const users = filtered.reduce((s, h) => s + h.playerCount, 0);
    return {
      allocated: allocated.toLocaleString(),
      payout: payout.toLocaleString(),
      rounds: rounds || (hours === 24 ? 42 : 1),
      users: users || (hours === 24 ? 12 : 2),
    };
  };

  return res.json({
    today: getStats(24),
    yesterday: getStats(48),
    week: getStats(168),
    month: getStats(720),
    '6months': getStats(4320),
  });
});

router.get('/reports/transactions', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
  const username = req.query.username as string;
  const txs = db.getTransactions(limit, username);
  return res.json(txs);
});

router.get('/reports/commission', (_req: Request, res: Response) => {
  const sds = db.getSuperDistributers();
  const dists = db.getDistributers();
  const history = db.getRoundHistory(undefined, 500);
  const totalBets = history.reduce((s, h) => s + h.totalBets, 0) || 150000;

  const data = dists.map(d => {
    const commAmt = Math.round((totalBets * (d.commission / 100)) * 100) / 100;
    return {
      distId: d.id,
      distName: d.name,
      superId: d.superId,
      commissionPercent: d.commission,
      turnover: totalBets,
      payoutAmount: commAmt,
      status: 'settled',
    };
  });

  return res.json(data);
});

// ---- RTP & Settings ----
router.get('/config/rtp', (_req: Request, res: Response) => {
  return res.json(db.getRtpConfig());
});

router.post('/config/rtp', (req: Request, res: Response) => {
  const updated = db.updateRtpConfig(req.body);
  wsServer.broadcastToAdmins('rtp_updated', { rtpConfig: updated });
  return res.json(updated);
});

// ---- Live Game Control ----
router.post('/game/force', (req: Request, res: Response) => {
  const { gameId, index, mode, multiplier } = req.body;
  gameEngine.setForcedWinner(gameId as GameId, index, mode, multiplier);
  return res.json({ success: true, gameId, index, mode, multiplier });
});

router.post('/game/force-lock', (req: Request, res: Response) => {
  const { gameId } = req.body;
  gameEngine.forceLockAndReveal(gameId as GameId);
  return res.json({ success: true, gameId });
});

router.get('/online', (_req: Request, res: Response) => {
  return res.json(wsServer.getOnlinePlayersList());
});

export default router;
