import express, { Application } from 'express';
import healthRouter from './routes/health';
import usiCommandRouter from './routes/usiCommand';
import setOptionRouter from './routes/setOption';
import analyzeRouter from './routes/analyze';
import { adminAuth } from './middleware/adminAuth';

export function createApp(): Application {
  const app = express();

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(express.json());

  // ── Health check ──────────────────────────────────────────────────────────
  app.use('/', healthRouter);

  // ── Engine API routes ─────────────────────────────────────────────────────
  app.use('/api/usi_command', usiCommandRouter);
  app.use('/api/setoption', adminAuth, setOptionRouter);
  app.use('/api/analyze', analyzeRouter);

  return app;
}
