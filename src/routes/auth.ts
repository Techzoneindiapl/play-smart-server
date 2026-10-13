import { Router, Request, Response } from 'express';
import { db } from '../store/db';

const router = Router();

router.post('/login', (req: Request, res: Response) => {
  const rawName = (req.body.name || req.body.username || '').toString().trim();
  const password = req.body.password;

  if (!rawName) {
    return res.status(400).json({ error: 'Username or email is required' });
  }

  const lookupName = rawName.toLowerCase() === 'admin@gmail.com' ? 'admin' : rawName;
  let user = db.getUserByUsername(lookupName);
  if (!user) {
    if (lookupName === 'admin') {
      user = db.addUser({
        id: 'admin-001',
        username: 'admin',
        name: 'Administrator',
        password: 'admin',
        role: 'admin',
        balance: 1000000,
        status: 'active',
        createdAt: new Date().toISOString(),
      });
    } else if (lookupName.toLowerCase() === 'distributor' || lookupName.toLowerCase() === 'distributer') {
      user = db.addUser({
        id: 'dist-001',
        username: lookupName,
        name: 'Distributor Demo',
        password: password || 'distributor',
        role: 'distributer',
        balance: 50000,
        status: 'active',
        createdAt: new Date().toISOString(),
      });
    } else {
      const dist = db.getDistributers().find(d => 
        (d.name && d.name.toLowerCase() === lookupName.toLowerCase()) || 
        (d.code && d.code.toLowerCase() === lookupName.toLowerCase()) || 
        d.id.toLowerCase() === lookupName.toLowerCase()
      );
      if (dist) {
        user = db.addUser({
          id: dist.id,
          username: dist.name || lookupName,
          name: dist.name,
          password: password || '123',
          role: 'distributer',
          balance: dist.balance,
          status: dist.status,
          createdAt: dist.createdAt,
        });
      } else {
        // If not found, create as new player with initial balance for smooth demo onboarding
        user = db.addUser({
          id: 'usr-' + Math.random().toString(36).substring(2, 9),
          username: lookupName,
          name: lookupName,
          password: password || '123',
          role: 'user',
          balance: 10000,
          status: 'active',
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  if (user.status === 'blocked') {
    return res.status(403).json({ error: 'Account is blocked by administrator' });
  }

  if (user.password && password && user.password !== password) {
    return res.status(401).json({ error: 'Invalid password' });
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
  const username = ((req.query.username as string) || 'demo').trim();
  const lookupName = username.toLowerCase() === 'admin@gmail.com' ? 'admin' : username;
  const user = db.getUserByUsername(lookupName);
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

router.post('/change-password', (req: Request, res: Response) => {
  const { username, currentPassword, newPassword } = req.body;
  if (!username || !newPassword) {
    return res.status(400).json({ error: 'Username and new password are required' });
  }

  const lookupName = (username.trim().toLowerCase() === 'admin@gmail.com') ? 'admin' : username.trim();
  const user = db.getUserByUsername(lookupName);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (user.password && currentPassword && user.password !== currentPassword) {
    return res.status(400).json({ error: 'Current password does not match' });
  }

  db.updateUser(user.id, { password: newPassword });
  return res.json({ success: true, message: 'Password updated successfully' });
});

export default router;
