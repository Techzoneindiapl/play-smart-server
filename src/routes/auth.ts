import { Router, Request, Response } from 'express';
import { db } from '../store/db';

const router = Router();

router.post('/login', (req: Request, res: Response) => {
  const name = req.body.name || req.body.username;
  const password = req.body.password;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Username is required' });
  }

  let user = db.getUserByUsername(name.trim());
  if (!user) {
    // If not found, create as new player with initial balance for smooth demo onboarding
    user = db.addUser({
      id: 'usr-' + Math.random().toString(36).substring(2, 9),
      username: name.trim(),
      name: name.trim(),
      password: password || '123',
      role: 'user',
      balance: 10000,
      status: 'active',
      createdAt: new Date().toISOString(),
    });
  }

  if (user.status === 'blocked') {
    return res.status(403).json({ error: 'Account is blocked by administrator' });
  }

  return res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    balance: user.balance,
    token: 'jwt_' + Buffer.from(user.username).toString('base64'),
  });
});

router.get('/me', (req: Request, res: Response) => {
  const username = (req.query.username as string) || 'demo';
  const user = db.getUserByUsername(username);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    balance: user.balance,
  });
});

export default router;
