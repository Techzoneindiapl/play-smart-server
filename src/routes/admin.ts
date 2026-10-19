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

router.put('/users/:id', (req: Request, res: Response) => {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const updates = req.body;
  const user = db.getUserById(userId) || db.getUserByUsername(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const updated = db.updateUser(user.id, updates);
  return res.json(updated);
});

router.delete('/users/:id', (req: Request, res: Response) => {
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = db.deleteUser(userId);
  if (!ok) return res.status(404).json({ error: 'User not found' });
  return res.json({ success: true, id: userId });
});

router.post('/users/:id/status', (req: Request, res: Response) => {
  const { status } = req.body;
  const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = db.getUserById(userId) || db.getUserByUsername(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const newStatus = status || (user.status === 'active' ? 'blocked' : 'active');
  const updated = db.updateUser(user.id, { status: newStatus });
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
  const { name, username, code, commission, balance, status } = req.body;
  const sdName = (name || username || 'Super Distributer').trim();
  const sd = db.addSuperDistributer({
    id: 'SD-' + Math.floor(100 + Math.random() * 900),
    name: sdName,
    code: code || ('SD' + Math.floor(10 + Math.random() * 90)),
    commission: Number(commission) || 2.5,
    balance: Number(balance) || 50000,
    status: (status === 'deactive' || status === 'blocked') ? 'blocked' : 'active',
    usersCount: 0,
    createdAt: new Date().toISOString().slice(0, 10),
  });
  return res.json(sd);
});

router.put('/superdistributers/:id', (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sd = db.getSuperDistributers().find(s => s.id === id || s.code === id || s.name === id);
  if (!sd) return res.status(404).json({ error: 'Super Distributor not found' });
  const updated = db.updateSuperDistributer(sd.id, req.body);
  return res.json(updated);
});

router.delete('/superdistributers/:id', (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = db.deleteSuperDistributer(id);
  if (!ok) return res.status(404).json({ error: 'Super Distributor not found' });
  return res.json({ success: true, id });
});

router.post('/superdistributers/:id/status', (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sd = db.getSuperDistributers().find(s => s.id === id || s.code === id || s.name === id);
  if (!sd) return res.status(404).json({ error: 'Super Distributor not found' });
  const newStatus = req.body.status || (sd.status === 'active' ? 'blocked' : 'active');
  const updated = db.updateSuperDistributer(sd.id, { status: newStatus });
  return res.json(updated);
});

router.get('/distributers', (_req: Request, res: Response) => {
  return res.json(db.getDistributers());
});

router.post('/distributers', (req: Request, res: Response) => {
  const { name, username, code, commission, balance, superId, status } = req.body;
  const distName = (name || username || 'Distributer').trim();
  const dist = db.addDistributer({
    id: 'D-' + Math.floor(200 + Math.random() * 800),
    superId: superId || 'SD-101',
    name: distName,
    code: code || ('D' + Math.floor(10 + Math.random() * 90)),
    commission: Number(commission) || 1.5,
    balance: Number(balance) || 25000,
    status: (status === 'deactive' || status === 'blocked') ? 'blocked' : 'active',
    usersCount: 0,
    createdAt: new Date().toISOString().slice(0, 10),
  });
  db.addUser({
    id: dist.id,
    username: dist.name,
    name: dist.name,
    password: req.body.password || '123',
    role: 'distributer',
    balance: dist.balance,
    status: dist.status,
    createdAt: dist.createdAt,
  });
  return res.json(dist);
});

router.put('/distributers/:id', (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const dist = db.getDistributers().find(d => d.id === id || d.code === id || d.name === id);
  if (!dist) return res.status(404).json({ error: 'Distributor not found' });
  const updated = db.updateDistributer(dist.id, req.body);
  return res.json(updated);
});

router.delete('/distributers/:id', (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const ok = db.deleteDistributer(id);
  if (!ok) return res.status(404).json({ error: 'Distributor not found' });
  return res.json({ success: true, id });
});

router.post('/distributers/:id/status', (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const dist = db.getDistributers().find(d => d.id === id || d.code === id || d.name === id);
  if (!dist) return res.status(404).json({ error: 'Distributor not found' });
  const newStatus = req.body.status || (dist.status === 'active' ? 'blocked' : 'active');
  const updated = db.updateDistributer(dist.id, { status: newStatus });
  return res.json(updated);
});

// Unified Credit Adjust & Transfer
router.post('/credit/adjust', (req: Request, res: Response) => {
  const { entityType, id, delta, description, type } = req.body;
  const amount = Number(delta);
  if (!entityType || !id || isNaN(amount)) {
    return res.status(400).json({ error: 'entityType, id, and numeric delta are required' });
  }

  if (entityType === 'user') {
    const user = db.getUserById(id) || db.getUserByUsername(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const result = db.adjustUserBalance(
      user.username,
      amount,
      description || (amount >= 0 ? 'Credit Transfer' : 'Credit Adjustment'),
      type || (amount >= 0 ? 'credit' : 'withdrawal')
    );
    if (!result) return res.status(404).json({ error: 'User not found' });
    wsServer.sendToUser(user.username, 'balance_updated', {
      username: user.username,
      balance: result.user.balance,
    });
    return res.json({ success: true, entity: result.user, newBalance: result.user.balance, tx: result.tx });
  } else if (entityType === 'distributer') {
    const updated = db.adjustDistributerBalance(id, amount);
    if (!updated) return res.status(404).json({ error: 'Distributor not found' });
    return res.json({ success: true, entity: updated, newBalance: updated.balance });
  } else if (entityType === 'superdistributer') {
    const updated = db.adjustSuperDistributerBalance(id, amount);
    if (!updated) return res.status(404).json({ error: 'Super Distributor not found' });
    return res.json({ success: true, entity: updated, newBalance: updated.balance });
  }

  return res.status(400).json({ error: 'Invalid entityType' });
});

// ---- Reports ----
// ---- Reports ----
router.get('/reports/turnover', (req: Request, res: Response) => {
  const { from, to, type } = req.query;
  const history = db.getRoundHistory(undefined, 2000);
  const users = db.getUsers().filter(u => u.role !== 'admin');
  const dists = db.getDistributers();
  const txs = db.getTransactions(5000);

  // Time filtering
  let fromMs = 0;
  let toMs = Date.now();
  if (from) fromMs = new Date(from as string).setHours(0, 0, 0, 0);
  if (to) toMs = new Date(to as string).setHours(23, 59, 59, 999);

  const filteredHistory = history.filter(h => {
    const t = new Date(h.time).getTime();
    return t >= fromMs && t <= toMs;
  });

  const filteredTxs = txs.filter(t => {
    const timeMs = new Date(t.time).getTime();
    return timeMs >= fromMs && timeMs <= toMs;
  });

  let totalPlay = 0;
  let totalWin = 0;
  let totalComm = 0;

  const userStats = users.map((u, idx) => {
    // Calculate play amount and win amount from user's bets & payouts
    const uTxs = filteredTxs.filter(t => t.username === u.username);
    let play = uTxs.filter(t => t.type === 'bet').reduce((s, t) => s + (t.amount || 0), 0);
    let win = uTxs.filter(t => t.type === 'payout' || t.type === 'win').reduce((s, t) => s + (t.amount || 0), 0);

    // Fallback: check round allocations if txs not yet generated
    if (play === 0 && win === 0) {
      filteredHistory.forEach(r => {
        (r.allocations || []).filter(a => a.username === u.username).forEach(a => {
          play += a.points || 0;
        });
        (r.winners || []).filter(w => w.username === u.username).forEach(w => {
          win += w.winAmount || 0;
        });
      });
    }

    const end = play - win;
    const dist = dists.find(d => d.id === u.distributerId || d.name === u.distributerId);
    const commRate = dist ? (dist.commission || 1.5) : 1.5;
    const comm = Math.round((play * (commRate / 100)) * 100) / 100;
    const net = Math.round((end - comm) * 100) / 100;

    totalPlay += play;
    totalWin += win;
    totalComm += comm;

    return {
      DT_RowIndex: idx + 1,
      user_name: u.username,
      play_amount: play.toFixed(2),
      win_amount: win.toFixed(2),
      claim_amount: win.toFixed(2),
      end_amount: end.toFixed(2),
      commission_amount: comm.toFixed(2),
      ntp_amount: net.toFixed(2),
    };
  });

  const totalEnd = Math.round((totalPlay - totalWin) * 100) / 100;
  const totalNet = Math.round((totalEnd - totalComm) * 100) / 100;

  const top = {
    DT_RowIndex: 1,
    play_amount: totalPlay.toFixed(2),
    win_amount: totalWin.toFixed(2),
    claim_amount: totalWin.toFixed(2),
    end_amount: totalEnd.toFixed(2),
    commission_amount: totalComm.toFixed(2),
    ntp_amount: totalNet.toFixed(2),
  };

  return res.json({
    summary: top,
    top,
    users: userStats,
    data: userStats,
  });
});

router.get('/reports/turnover/top', (req: Request, res: Response) => {
  const { from, to } = req.query;
  const history = db.getRoundHistory(undefined, 2000);
  const txs = db.getTransactions(5000);

  let fromMs = 0;
  let toMs = Date.now();
  if (from) fromMs = new Date(from as string).setHours(0, 0, 0, 0);
  if (to) toMs = new Date(to as string).setHours(23, 59, 59, 999);

  const filteredTxs = txs.filter(t => {
    const timeMs = new Date(t.time).getTime();
    return timeMs >= fromMs && timeMs <= toMs;
  });

  let play = filteredTxs.filter(t => t.type === 'bet').reduce((s, t) => s + (t.amount || 0), 0);
  let win = filteredTxs.filter(t => t.type === 'payout' || t.type === 'win').reduce((s, t) => s + (t.amount || 0), 0);

  if (play === 0 && win === 0) {
    history.forEach(r => {
      play += r.totalBets || 0;
      play += 0;
      win += r.totalPayouts || 0;
    });
  }

  const end = play - win;
  const comm = Math.round((play * 0.015) * 100) / 100;
  const net = Math.round((end - comm) * 100) / 100;

  return res.json({
    data: [{
      DT_RowIndex: 1,
      play_amount: play.toFixed(2),
      win_amount: win.toFixed(2),
      claim_amount: win.toFixed(2),
      end_amount: end.toFixed(2),
      commission_amount: comm.toFixed(2),
      ntp_amount: net.toFixed(2),
    }]
  });
});

router.get('/reports/admin-commission', (req: Request, res: Response) => {
  const { from, to } = req.query;
  const history = db.getRoundHistory(undefined, 2000);

  let fromMs = 0;
  let toMs = Date.now();
  if (from) fromMs = new Date(from as string).setHours(0, 0, 0, 0);
  if (to) toMs = new Date(to as string).setHours(23, 59, 59, 999);

  const filteredHistory = history.filter(h => {
    const t = new Date(h.time).getTime();
    return t >= fromMs && t <= toMs;
  });

  const games = [
    { id: 'lucky12', name: 'lucky_cards_12' },
    { id: 'lucky16', name: 'lucky_cards_16' },
    { id: 'luckyTimer', name: 'lucky_timer' },
  ];

  let grandComm = 0;
  let grandBet = 0;
  let grandWon = 0;

  const gameRows = games.map((g, idx) => {
    const rounds = filteredHistory.filter(h => h.gameId === g.id);
    const bet = rounds.reduce((s, r) => s + (r.totalBets || 0), 0);
    const won = rounds.reduce((s, r) => s + (r.totalPayouts || 0), 0);
    const pct = db.getAdminPercentage(g.id);
    const comm = Math.round((bet * (pct / 100)) * 100) / 100;

    grandComm += comm;
    grandBet += bet;
    grandWon += won;

    return {
      DT_RowIndex: idx + 1,
      game_type: g.name,
      commission_amount: comm.toFixed(2),
      total_bet_amount: bet.toFixed(2),
      total_win_amount: won.toFixed(2),
    };
  });

  const top = {
    DT_RowIndex: 1,
    play_amount: grandComm.toFixed(2), // Total Commission Point
    win_amount: grandBet.toFixed(2),   // Total Bet Point
    claim_amount: grandWon.toFixed(2), // Total Won Point
  };

  return res.json({
    summary: top,
    top,
    data: gameRows,
  });
});

router.get('/reports/transactions', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 500;
  const username = req.query.username as string;
  const txs = db.getTransactions(limit, username);
  return res.json(txs);
});

// Pending Commission Report
router.get('/reports/commission', (req: Request, res: Response) => {
  const sds = db.getSuperDistributers();
  const dists = db.getDistributers();
  const users = db.getUsers().filter(u => u.role !== 'admin');
  const history = db.getRoundHistory(undefined, 2000);
  const totalBets = history.reduce((s, h) => s + (h.totalBets || 0), 0);

  let index = 1;
  const list: any[] = [];

  // Super Distributors
  sds.forEach(sd => {
    const commAmt = Math.round((totalBets * ((sd.commission || 2.5) / 100)) * 100) / 100;
    list.push({
      DT_RowIndex: index++,
      UserName: sd.name || sd.code,
      Role: 'Super Distributer',
      commission_percentage: sd.commission || 2.5,
      Commission: commAmt.toFixed(2),
      CreateDate: sd.createdAt ? new Date(sd.createdAt).toLocaleString() : new Date().toLocaleString(),
      action: sd.id,
    });
  });

  // Distributors
  dists.forEach(d => {
    const commAmt = Math.round((totalBets * ((d.commission || 1.5) / 100)) * 100) / 100;
    list.push({
      DT_RowIndex: index++,
      UserName: d.name || d.code,
      Role: 'Distributer',
      commission_percentage: d.commission || 1.5,
      Commission: commAmt.toFixed(2),
      CreateDate: d.createdAt ? new Date(d.createdAt).toLocaleString() : new Date().toLocaleString(),
      action: d.id,
    });
  });

  // Retailers
  users.slice(0, 10).forEach(u => {
    list.push({
      DT_RowIndex: index++,
      UserName: u.username,
      Role: 'Retailer',
      commission_percentage: 1.0,
      Commission: '0.00',
      CreateDate: u.createdAt ? new Date(u.createdAt).toLocaleString() : new Date().toLocaleString(),
      action: u.id,
    });
  });

  return res.json({
    data: list,
  });
});

// Commission Payout History
router.get('/reports/commission-payouts', (_req: Request, res: Response) => {
  const records = db.getCommissionPayoutRecords();
  return res.json({ data: records });
});

router.post('/reports/commission/pay', (req: Request, res: Response) => {
  const { username, role, amount, oldCommission } = req.body;
  const amt = Number(amount) || 0;
  const oldComm = Number(oldCommission) || 0;
  const newComm = Math.max(0, oldComm - amt);

  const rec = db.addCommissionPayoutRecord({
    username: username || 'Distributer',
    role: role || 'Distributer',
    oldCommission: oldComm,
    amount: amt,
    newCommission: newComm,
  });

  db.addActivityLog({
    username: 'admin',
    subject: `Paid Commission ₹${amt} to ${username} (${role})`,
    url: '/commission',
    method: 'POST',
  });

  return res.json({ success: true, payout: rec });
});

// Activity Logs
router.get('/reports/logs', (req: Request, res: Response) => {
  const date = req.query.date as string;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  const logs = db.getActivityLogs(limit, date);
  return res.json({ data: logs });
});

router.post('/reports/logs', (req: Request, res: Response) => {
  const { username, subject, url, method, ip } = req.body;
  const log = db.addActivityLog({
    username: username || 'admin',
    subject: subject || 'Admin Action',
    url: url || '/dashboard',
    method: method || 'POST',
    ip: ip || req.ip || '127.0.0.1',
  });
  return res.json({ success: true, log });
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

router.get('/config/game-percentage', (_req: Request, res: Response) => {
  return res.json(db.getAllAdminPercentages());
});

router.post('/config/game-percentage', (req: Request, res: Response) => {
  const { lucky_cards_12, lucky_cards_16, lucky12, lucky16, luckyTimer } = req.body;
  const p12 = Number(lucky_cards_12 !== undefined ? lucky_cards_12 : (lucky12 !== undefined ? lucky12 : 20));
  const p16 = Number(lucky_cards_16 !== undefined ? lucky_cards_16 : (lucky16 !== undefined ? lucky16 : 20));
  const pTimer = Number(luckyTimer !== undefined ? luckyTimer : p12);

  db.setAdminPercentage('lucky12', p12);
  db.setAdminPercentage('lucky16', p16);
  db.setAdminPercentage('luckyTimer', pTimer);

  const all = db.getAllAdminPercentages();
  wsServer.broadcastToAdmins('game_percentages_updated', all);
  return res.json({ success: true, percentages: all });
});

// ---- Live Game Control ----
router.post('/game/force', (req: Request, res: Response) => {
  const { gameId, index, mode, multiplier, cardLabel } = req.body;
  gameEngine.setForcedWinner(gameId as GameId, index !== undefined ? Number(index) : null, mode, multiplier, cardLabel);
  return res.json({ success: true, gameId, index, mode, multiplier, cardLabel });
});

router.post('/game/force-lock', (req: Request, res: Response) => {
  const { gameId } = req.body;
  gameEngine.forceLockAndReveal(gameId as GameId);
  return res.json({ success: true, gameId });
});

router.get('/online', (_req: Request, res: Response) => {
  return res.json(wsServer.getOnlinePlayersList());
});

// ---- Live Game Balance ----
router.get('/live-balance', (_req: Request, res: Response) => {
  return res.json(db.getAllLiveGameBalances());
});

router.post('/live-balance/reset', (req: Request, res: Response) => {
  const { gameId } = req.body;
  if (!gameId) {
    return res.status(400).json({ error: 'gameId is required' });
  }
  const updatedBal = db.resetGameBalance(gameId as string);
  wsServer.broadcastToAdmins('live_balance_updated', {
    gameId,
    liveBalance: updatedBal,
    allBalances: db.getAllLiveGameBalances(),
  });
  return res.json({ success: true, gameId, liveBalance: updatedBal });
});

router.post('/clear-data', async (_req: Request, res: Response) => {
  await db.clearAllData();
  wsServer.broadcastToAdmins('data_cleared', {});
  return res.json({ success: true, message: 'All current data has been cleared.' });
});

export default router;

