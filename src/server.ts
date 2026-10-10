import http from 'http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import walletRoutes from './routes/wallet';
import gameRoutes from './routes/game';
import adminRoutes from './routes/admin';
import { gameEngine } from './game/gameEngine';
import { wsServer } from './ws/websocketServer';
import { db } from './store/db';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Request logging in development
app.use((req, _res, next) => {
  if (req.path !== '/health') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', serverTime: new Date().toISOString() });
});

// Create HTTP and WebSocket server
const server = http.createServer(app);
wsServer.init(server);

// Start DB and Game Engine
db.connectMongo().then(() => {
  gameEngine.init();
}).catch(() => {
  gameEngine.init();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`  Play Smart & FairDeal Backend Server Running `);
  console.log(`  HTTP API:    http://localhost:${PORT}`);
  console.log(`  WebSocket:   ws://localhost:${PORT}`);
  console.log(`===============================================`);
});
