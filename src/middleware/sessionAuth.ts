import { Request, Response, NextFunction } from 'express';
import { db } from '../store/db';
import { ActiveSession } from '../types';

export interface AuthenticatedRequest extends Request {
  session?: ActiveSession;
}

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

/**
 * Rejects requests carrying an invalid, logged-out, or expired Bearer token.
 * Requests without a Bearer token are allowed through unless requireAuthSession is used.
 */
export function validateBearerIfPresent(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) {
    return next();
  }

  const session = db.getSessionByToken(token);
  if (!session) {
    return res.status(401).json({
      error: 'Your session has expired or been logged out. Please login again.',
      code: 'SESSION_EXPIRED',
    });
  }

  const user = db.getUserByUsername(session.username);
  if (!user || user.status === 'blocked') {
    db.clearSessionByToken(token);
    return res.status(403).json({
      error: 'Account is blocked or unavailable.',
      code: 'ACCOUNT_BLOCKED',
    });
  }

  req.session = session;
  return next();
}

/**
 * Requires an active, non-expired Bearer session token.
 */
export function requireAuthSession(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) {
    return res.status(401).json({
      error: 'Authentication required. Please login again.',
      code: 'AUTH_REQUIRED',
    });
  }

  return validateBearerIfPresent(req, res, next);
}

/**
 * Requires a valid active session belonging to an admin/manager role.
 */
export function requireAdminSession(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  return requireAuthSession(req, res, () => {
    const role = req.session?.role;
    if (role !== 'admin' && role !== 'distributer' && role !== 'superdistributer') {
      return res.status(403).json({
        error: 'Administrator privileges required.',
        code: 'FORBIDDEN',
      });
    }
    return next();
  });
}

export function resolveAuthenticatedUsername(req: Request): string {
  const authReq = req as AuthenticatedRequest;
  if (authReq.session) {
    const queryUsername = typeof req.query.username === 'string' ? req.query.username.trim() : '';
    if (queryUsername && authReq.session.role === 'admin') {
      return queryUsername;
    }
    return authReq.session.username;
  }
  const q = req.query.username as string;
  if (q && q.trim()) return q.trim();
  return 'demo';
}
