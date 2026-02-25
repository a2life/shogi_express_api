import { Router, Request, Response } from 'express';
import { engine } from '../engine/engineProcess';

const router = Router();

/**
 * GET /api/setoption/:name/:value
 *
 * Sends: setoption name <name> value <value>
 * This is a void command — the engine produces no output for setoption.
 */
router.get('/:name/:value', async (req: Request, res: Response) => {
  const { name, value } = req.params;

  if (!engine.isReady) {
    res.status(503).json({ error: 'Engine is not ready.' });
    return;
  }

  try {
    await engine.sendVoid(`setoption name ${name} value ${value}`);
    res.json({ command: `setoption name ${name} value ${value}`, result: 'sent' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
