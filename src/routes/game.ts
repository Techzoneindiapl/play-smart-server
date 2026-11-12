import { Router, Request, Response } from 'express';
import { GameId } from '../types';
import { gameEngine } from '../game/gameEngine';
import { db } from '../store/db';
import {
  AuthenticatedRequest,
  requireAuthSession,
  resolveAuthenticatedUsername,
  validateBearerIfPresent,
} from '../middleware/sessionAuth';

const router = Router();
router.use(validateBearerIfPresent);

router.get('/current/:gameId', (req: Request, res: Response) => {
  const gameId = req.params.gameId as GameId;
  const round = gameEngine.getRound(gameId);
  if (!round) {
    return res.status(404).json({ error: 'Game not found' });
  }
  return res.json(gameEngine.sanitizeRound(round));
});

router.get('/history', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
  const history = db.getRoundHistory(undefined, limit);
  return res.json(history);
});

router.get('/history/:gameId', (req: Request, res: Response) => {
  const gameId = req.params.gameId as GameId;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const history = db.getRoundHistory(gameId, limit);
  return res.json(history);
});

router.get('/user-history/:username', requireAuthSession, (req: AuthenticatedRequest, res: Response) => {
  const requested = String(req.params.username);
  const username =
    req.session!.role === 'admin' ? requested : req.session!.username;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const history = db.getUserRoundHistory(username, limit);
  return res.json(history);
});

router.post('/bet', requireAuthSession, (req: AuthenticatedRequest, res: Response) => {
  const { gameId, targetIndex, points } = req.body;
  const username = resolveAuthenticatedUsername(req);
  if (!gameId || targetIndex === undefined || !points || points <= 0) {
    return res.status(400).json({ error: 'Missing required bet parameters' });
  }

  const result = gameEngine.placeAllocation(gameId as GameId, username, targetIndex, points, false);
  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  return res.json({
    success: true,
    allocation: result.allocation,
    balance: result.newBalance,
  });
});

export default router;
