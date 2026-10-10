import { Router, Request, Response } from 'express';
import { db } from '../store/db';

const router = Router();

function getUsernameFromReq(req: Request): string {
  const q = req.query.username as string;
  if (q) return q;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer jwt_')) {
    try {
      return Buffer.from(auth.replace('Bearer jwt_', ''), 'base64').toString('utf-8');
    } catch (_) {}
  }
  return 'demo';
}

router.get('/balance', (req: Request, res: Response) => {
  const username = getUsernameFromReq(req);
  const user = db.getUserByUsername(username);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const txs = db.getTransactions(500, username);
  const totalBets = txs
    .filter(t => t.type === 'bet')
    .reduce((sum, t) => sum + t.amount, 0);
  const totalWinnings = txs
    .filter(t => t.type === 'payout' || t.type === 'win')
    .reduce((sum, t) => sum + t.amount, 0);

  return res.json({
    balance: user.balance,
    totalBets,
    totalWinnings,
  });
});

router.get('/transactions', (req: Request, res: Response) => {
  const username = getUsernameFromReq(req);
  const txs = db.getTransactions(100, username);

  return res.json(
    txs.map(t => ({
      id: t.id,
      type: t.type === 'payout' ? 'win' : t.type,
      amount: t.amount,
      description: t.description,
      time: t.time,
      balanceAfter: t.balanceAfter,
    }))
  );
});

router.post('/transactions', (req: Request, res: Response) => {
  const username = getUsernameFromReq(req);
  const { type, amount, description } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be greater than 0' });
  }

  const delta = (type === 'bet' || type === 'withdrawal') ? -amount : amount;
  const adjusted = db.adjustUserBalance(username, delta, description || `Transaction: ${type}`, type);

  if (!adjusted) {
    return res.status(400).json({ error: 'User balance adjustment failed' });
  }

  const txs = db.getTransactions(500, username);
  const totalBets = txs.filter(t => t.type === 'bet').reduce((s, t) => s + t.amount, 0);
  const totalWinnings = txs.filter(t => t.type === 'payout' || t.type === 'win').reduce((s, t) => s + t.amount, 0);

  return res.json({
    balance: adjusted.user.balance,
    totalBets,
    totalWinnings,
  });
});

export default router;
