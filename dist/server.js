"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const auth_1 = __importDefault(require("./routes/auth"));
const wallet_1 = __importDefault(require("./routes/wallet"));
const game_1 = __importDefault(require("./routes/game"));
const admin_1 = __importDefault(require("./routes/admin"));
const gameEngine_1 = require("./game/gameEngine");
const websocketServer_1 = require("./ws/websocketServer");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
// Middleware
app.use((0, cors_1.default)({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express_1.default.json());
// Request logging in development
app.use((req, _res, next) => {
    if (req.path !== '/health') {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    }
    next();
});
// Routes
app.use('/api/auth', auth_1.default);
app.use('/api/wallet', wallet_1.default);
app.use('/api/game', game_1.default);
app.use('/api/admin', admin_1.default);
// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', serverTime: new Date().toISOString() });
});
// Create HTTP and WebSocket server
const server = http_1.default.createServer(app);
websocketServer_1.wsServer.init(server);
// Start Game Engine
gameEngine_1.gameEngine.init();
server.listen(PORT, '0.0.0.0', () => {
    console.log(`===============================================`);
    console.log(`  Play Smart & FairDeal Backend Server Running `);
    console.log(`  HTTP API:    http://localhost:${PORT}`);
    console.log(`  WebSocket:   ws://localhost:${PORT}`);
    console.log(`===============================================`);
});
