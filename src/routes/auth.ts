import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { db, SESSION_TTL_MS } from '../store/db';
import { wsServer } from '../ws/websocketServer';
import {
  AuthenticatedRequest,
  extractBearerToken,
  requireAuthSession,
} from '../middleware/sessionAuth';

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

  const pwd = password !== undefined && password !== null ? String(password) : '';
  if (user.password && user.password !== pwd) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const existingSession = db.getActiveSession(user.username);
  if (existingSession) {
    return res.status(409).json({
      error: 'User is already logged in on another session. Please logout from the existing session first.',
      code: 'ALREADY_LOGGED_IN',
      expiresAt: existingSession.expiresAt,
    });
  }

  const token = 'sess_' + crypto.randomBytes(24).toString('hex');
  const session = db.createSession(user, token, SESSION_TTL_MS);

  wsServer.broadcastToAdmins('user_session_updated', {
    username: user.username,
    hasActiveSession: true,
    expiresAt: session.expiresAt,
  });

  return res.json({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    balance: user.balance,
    token: session.token,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    sessionDurationMs: SESSION_TTL_MS,
    serverTime: Date.now(),
  });
});

router.get('/session', (req: Request, res: Response) => {
  const token = extractBearerToken(req) || (typeof req.query.token === 'string' ? req.query.token.trim() : '');
  if (!token) {
    return res.status(401).json({
      valid: false,
      error: 'Session token is required',
      code: 'AUTH_REQUIRED',
    });
  }

  const session = db.getSessionByToken(token);
  if (!session) {
    return res.status(401).json({
      valid: false,
      error: 'Session has expired or been logged out. Please login again.',
      code: 'SESSION_EXPIRED',
    });
  }

  const user = db.getUserByUsername(session.username);
  if (!user || user.status === 'blocked') {
    db.clearSessionByToken(token);
    return res.status(403).json({
      valid: false,
      error: 'Account is blocked or unavailable.',
      code: 'ACCOUNT_BLOCKED',
    });
  }

  return res.json({
    valid: true,
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    balance: user.balance,
    token: session.token,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    remainingMs: Math.max(0, session.expiresAt - Date.now()),
    serverTime: Date.now(),
  });
});

router.post('/logout', (req: Request, res: Response) => {
  const token =
    extractBearerToken(req) ||
    (typeof req.body?.token === 'string' ? req.body.token.trim() : '');

  if (!token) {
    return res.json({ success: true, loggedOut: false });
  }

  const cleared = db.clearSessionByToken(token);
  if (cleared) {
    wsServer.notifySessionEnded(cleared.username, 'logged_out', cleared.token);
  }

  return res.json({
    success: true,
    loggedOut: Boolean(cleared),
    username: cleared?.username,
  });
});

router.get('/me', requireAuthSession, (req: AuthenticatedRequest, res: Response) => {
  const requested = typeof req.query.username === 'string' ? req.query.username.trim() : '';
  const username = req.session!.role === 'admin' && requested ? requested : req.session!.username;
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
    expiresAt: req.session?.expiresAt,
  });
});

router.post('/change-password', requireAuthSession, (req: AuthenticatedRequest, res: Response) => {
  const { username, currentPassword, newPassword } = req.body;
  const targetName = (username || req.session!.username || '').toString().trim();
  if (!targetName || !newPassword) {
    return res.status(400).json({ error: 'Username and new password are required' });
  }

  const lookupName = targetName.toLowerCase() === 'admin@gmail.com' ? 'admin' : targetName;
  if (
    req.session!.role !== 'admin' &&
    req.session!.username.toLowerCase() !== lookupName.toLowerCase()
  ) {
    return res.status(403).json({ error: 'Cannot change another user password' });
  }

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
