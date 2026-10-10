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

router.get('/history/:gameId', (req: Request, res: Response) => {
  const gameId = req.params.gameId as GameId;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
  const history = db.getRoundHistory(gameId, limit);
  return res.json(history);
});

router.post('/bet', (req: Request, res: Response) => {
  const { gameId, username, targetIndex, points } = req.body;
  if (!gameId || targetIndex === undefined || !points || points <= 0) {
    return res.status(400).json({ error: 'Missing required bet parameters' });
  }

  const result = gameEngine.placeAllocation(gameId as GameId, username || 'demo', targetIndex, points, false);
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
