import { Router, Request, Response } from 'express';
import { engine } from '../engine/engineProcess';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    engineReady: engine.isReady,
    timestamp: new Date().toISOString(),
  });
});

export default router;
