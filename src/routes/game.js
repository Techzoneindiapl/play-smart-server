"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const gameEngine_1 = require("../game/gameEngine");
const db_1 = require("../store/db");
const router = (0, express_1.Router)();
router.get('/current/:gameId', (req, res) => {
    const gameId = req.params.gameId;
    const round = gameEngine_1.gameEngine.getRound(gameId);
    if (!round) {
        return res.status(404).json({ error: 'Game not found' });
    }
    return res.json(gameEngine_1.gameEngine.sanitizeRound(round));
});
router.get('/history/:gameId', (req, res) => {
    const gameId = req.params.gameId;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
    const history = db_1.db.getRoundHistory(gameId, limit);
    return res.json(history);
});
router.post('/bet', (req, res) => {
    const { gameId, username, targetIndex, points } = req.body;
    if (!gameId || targetIndex === undefined || !points || points <= 0) {
        return res.status(400).json({ error: 'Missing required bet parameters' });
    }
    const result = gameEngine_1.gameEngine.placeAllocation(gameId, username || 'demo', targetIndex, points, false);
    if (!result.success) {
        return res.status(400).json({ error: result.error });
    }
    return res.json({
        success: true,
        allocation: result.allocation,
        balance: result.newBalance,
    });
});
exports.default = router;
