import express, { Application } from 'express';
import healthRouter from './routes/health';
import usiCommandRouter from './routes/usiCommand';
import setOptionRouter from './routes/setOption';
import analyzeRouter from './routes/analyze';

export function createApp(): Application {
  const app = express();

  app.use(express.json());

  // ── Health check ──────────────────────────────────────────────────────────
  app.use('/', healthRouter);

  // ── Engine API routes ─────────────────────────────────────────────────────
  app.use('/api/usi_command', usiCommandRouter);
  app.use('/api/setoption', setOptionRouter);
  app.use('/api/analyze', analyzeRouter);

  return app;
}
