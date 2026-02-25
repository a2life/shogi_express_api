import { Router, Request, Response } from 'express';
import { engine } from '../engine/engineProcess';

const router = Router();

/** Static description of every exposed API endpoint. */
const API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/',
    description: 'Health check — engine status, engine info, and this endpoint list.',
  },
  {
    method: 'GET',
    path: '/api/usi_command/:command',
    description:
        'Send a raw USI command to the engine and return its output lines. ' +
        'Blocked: go, go mate, position, setoption, quit.',
  },
  {
    method: 'GET',
    path: '/api/setoption/:name/:value',
    description: 'Send "setoption name <name> value <value>" to the engine.',
  },
  {
    method: 'POST',
    path: '/api/analyze/:waittime?',
    description:
        'Analyse a position. Body: { sfen?, moves?, depth?, nodes? }. ' +
        'waittime (ms): omit = go, 0 = go infinite, N = go movetime N.',
  },
  {
    method: 'GET',
    path: '/api/analyze/:waittime?',
    description:
        'Analyse a position. Query params: sfen, moves, depth, nodes. ' +
        'waittime (ms): omit = go, 0 = go infinite, N = go movetime N.',
  },
];

router.get('/', (_req: Request, res: Response) => {
  const info = engine.engineInfo;

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    engine: {
      ready: engine.isReady,
      name: info.name,
      author: info.author,
    },
    api: API_ENDPOINTS,
  });
});

export default router;