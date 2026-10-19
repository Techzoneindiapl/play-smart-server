import { Router, Request, Response } from 'express';
import { GameId } from '../types';
import { gameEngine } from '../game/gameEngine';
import { db } from '../store/db';

const router = Router();

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

router.get('/user-history/:username', (req: Request, res: Response) => {
  const username = String(req.params.username);
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const history = db.getUserRoundHistory(username, limit);
  return res.json(history);
});

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

router.post('/bet', (req: Request, res: Response) => {
  const { gameId, targetIndex, points } = req.body;
  const username = req.body.username || getUsernameFromReq(req);
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
