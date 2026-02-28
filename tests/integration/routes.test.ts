/**
 * Integration tests for all HTTP routes.
 *
 * The route files import the engine singleton directly:
 *   import { engine } from '../engine/engineProcess';
 *
 * So we use jest.mock() to replace the singleton with a controllable object,
 * then cast it so TypeScript is happy in tests.
 */

import request from 'supertest';
import { createApp } from '../../src/app';

// ── mock the engine singleton before any imports resolve ─────────────────────
jest.mock('../../src/engine/engineProcess', () => ({
  engine: {
    isReady: false,
    engineInfo: { name: 'MockEngine', author: 'Jest' },
    sendVoid: jest.fn(),
    sendAndCollect: jest.fn(),
    analyze: jest.fn(),
    stopSearch: jest.fn(),
  },
}));

// ── import the mock so tests can mutate it ───────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { engine } = require('../../src/engine/engineProcess') as {
  engine: {
    isReady: boolean;
    engineInfo: { name: string; author: string };
    sendVoid: jest.Mock;
    sendAndCollect: jest.Mock;
    analyze: jest.Mock;
    stopSearch: jest.Mock;
  };
};

// ── app instance (routes are wired once) ─────────────────────────────────────
const app = createApp();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function setReady(v: boolean) {
  engine.isReady = v;
}

beforeEach(() => {
  jest.clearAllMocks();
  setReady(true);
  engine.engineInfo.name = 'MockEngine';
  engine.engineInfo.author = 'Jest';
});

// =============================================================================
// GET /
// =============================================================================

describe('GET /', () => {
  test('200 with full shape when engine is ready', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      timestamp: expect.any(String),
      engine: { ready: true, name: 'MockEngine', author: 'Jest' },
      api: expect.any(Array),
    });
  });

  test('timestamp is a valid ISO string', async () => {
    const res = await request(app).get('/');
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
  });

  test('api array contains entries with method, path, description', async () => {
    const res = await request(app).get('/');
    expect(res.body.api.length).toBeGreaterThan(0);
    res.body.api.forEach((entry: unknown) => {
      expect(entry).toMatchObject({
        method: expect.any(String),
        path: expect.any(String),
        description: expect.any(String),
      });
    });
  });

  test('api list includes POST /api/analyze', async () => {
    const res = await request(app).get('/');
    const paths: string[] = res.body.api.map((e: { path: string }) => e.path);
    expect(paths.some((p) => p.includes('/api/analyze'))).toBe(true);
  });

  test('engine.ready is false when engine is not ready', async () => {
    setReady(false);
    const res = await request(app).get('/');
    // Health route always returns 200 — it shows ready=false in the body
    expect(res.status).toBe(200);
    expect(res.body.engine.ready).toBe(false);
  });
});

// =============================================================================
// GET /api/usi_command/:command
// =============================================================================

describe('GET /api/usi_command/:command', () => {

  // ── void commands ─────────────────────────────────────────────────────────
  test('void command "usinewgame" → 200, result: sent, lines: []', async () => {
    engine.sendVoid.mockResolvedValue(undefined);
    const res = await request(app).get('/api/usi_command/usinewgame');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ command: 'usinewgame', result: 'sent', lines: [] });
    expect(engine.sendVoid).toHaveBeenCalledWith('usinewgame');
  });

  test('void command "stop" → 200', async () => {
    engine.sendVoid.mockResolvedValue(undefined);
    const res = await request(app).get('/api/usi_command/stop');
    expect(res.status).toBe(200);
    expect(res.body.lines).toEqual([]);
  });

  test('void command "gameover" → 200', async () => {
    engine.sendVoid.mockResolvedValue(undefined);
    const res = await request(app).get('/api/usi_command/gameover');
    expect(res.status).toBe(200);
  });

  // ── non-void commands ─────────────────────────────────────────────────────
  test('non-void command "usi" → 200 with lines array', async () => {
    const mockLines = ['id name MockEngine', 'id author Jest', 'usiok'];
    engine.sendAndCollect.mockResolvedValue(mockLines);

    const res = await request(app).get('/api/usi_command/usi');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ command: 'usi', lines: mockLines });
  });

  test('non-void command "isready" → 200 with readyok in lines', async () => {
    engine.sendAndCollect.mockResolvedValue(['readyok']);
    const res = await request(app).get('/api/usi_command/isready');
    expect(res.status).toBe(200);
    expect(res.body.lines).toContain('readyok');
  });

  // ── blocked commands → 400 ────────────────────────────────────────────────
  test.each(['go', 'go%20mate', 'position', 'setoption', 'quit'])(
    'blocked command "%s" → 400',
    async (cmd) => {
      const res = await request(app).get(`/api/usi_command/${cmd}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    },
  );

  // ── engine not ready → 503 ───────────────────────────────────────────────
  test('503 when engine is not ready', async () => {
    setReady(false);
    const res = await request(app).get('/api/usi_command/usi');
    expect(res.status).toBe(503);
    expect(res.body.error).toBeDefined();
  });

  // ── engine error → 500 ───────────────────────────────────────────────────
  test('500 when sendAndCollect rejects', async () => {
    engine.sendAndCollect.mockRejectedValue(new Error('Timeout waiting for response to: "usi"'));
    const res = await request(app).get('/api/usi_command/usi');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Timeout/i);
  });
});

// =============================================================================
// GET /api/setoption/:name/:value
// =============================================================================

describe('GET /api/setoption/:name/:value', () => {

  test('200 with correct command string and result: sent', async () => {
    engine.sendVoid.mockResolvedValue(undefined);
    const res = await request(app).get('/api/setoption/USI_Hash/1024');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      command: 'setoption name USI_Hash value 1024',
      result: 'sent',
    });
  });

  test('sends "setoption name <n> value <v>" to engine', async () => {
    engine.sendVoid.mockResolvedValue(undefined);
    await request(app).get('/api/setoption/MultiPV/3');
    expect(engine.sendVoid).toHaveBeenCalledWith('setoption name MultiPV value 3');
  });

  test('404 when value segment is missing (route not matched)', async () => {
    const res = await request(app).get('/api/setoption/USI_Hash');
    expect(res.status).toBe(404);
  });

  test('503 when engine is not ready', async () => {
    setReady(false);
    const res = await request(app).get('/api/setoption/USI_Hash/256');
    expect(res.status).toBe(503);
    expect(res.body.error).toBeDefined();
  });

  test('500 when sendVoid rejects', async () => {
    engine.sendVoid.mockRejectedValue(new Error('write failed'));
    const res = await request(app).get('/api/setoption/USI_Hash/256');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/write failed/i);
  });
});

// =============================================================================
// POST /api/analyze
// =============================================================================

describe('POST /api/analyze', () => {

  // ── default mock response: no mate ───────────────────────────────────────
  const noMateLines = [
    'info depth 18 seldepth 22 multipv 1 score cp 42 pv 2g2f 8c8d',
    'bestmove 2g2f ponder 8c8d',
  ];

  beforeEach(() => {
    engine.analyze.mockResolvedValue(noMateLines);
  });

  // ── response shape ────────────────────────────────────────────────────────
  test('200 with full no-mate result shape', async () => {
    const res = await request(app)
      .post('/api/analyze/3000')
      .send({ sfen: 'startpos', moves: ['7g7f', '3c3d'] });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sfen: expect.any(String),
      moves: expect.any(Array),
      waittime: 3000,
      depth: null,
      nodes: null,
      lines: noMateLines,
      bestmove: '2g2f',
      ponder: '8c8d',
      mate: false,
      score: 42,
    });
  });

  test('200 with mate result shape', async () => {
    engine.analyze.mockResolvedValue([
      'info depth 33 score mate 11 pv 8a6c 6b6c 3b5b+',
      'bestmove 8a6c ponder 6b6c',
    ]);

    const res = await request(app).post('/api/analyze/6000').send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      mate: true,
      mate_length: 11,
      mate_moves: '8a6c 6b6c 3b5b+',
      bestmove: '8a6c',
      ponder: '6b6c',
    });
    expect(res.body.score).toBeUndefined();
  });

  // ── argument forwarding ───────────────────────────────────────────────────
  test('forwards sfen, waittime, moves, depth, nodes to engine.analyze', async () => {
    const sfen = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
    await request(app)
      .post('/api/analyze/3000')
      .send({ sfen, moves: ['7g7f', '3c3d'], depth: 20, nodes: 500000 });

    expect(engine.analyze).toHaveBeenCalledWith(
      sfen,
      3000,
      ['7g7f', '3c3d'],
      20,
      500000,
    );
  });

  test('omitted sfen → engine receives undefined (uses startpos)', async () => {
    await request(app).post('/api/analyze').send({});
    expect(engine.analyze).toHaveBeenCalledWith(
      undefined, undefined, undefined, undefined, undefined,
    );
  });

  test('omitted waittime → engine.analyze waittime argument is undefined', async () => {
    await request(app).post('/api/analyze').send({});
    const [, waittime] = engine.analyze.mock.calls[0];
    expect(waittime).toBeUndefined();
  });

  test('waittime=0 → 400 (use stream endpoint instead)', async () => {
    const res = await request(app).post('/api/analyze/0').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/waittime=0/i);
  });

  test('waittime exceeding 25000 → 400', async () => {
    const res = await request(app).post('/api/analyze/25001').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/waittime/i);
  });

  test('moves as JSON array forwarded correctly', async () => {
    await request(app).post('/api/analyze').send({ moves: ['7g7f', '3c3d'] });
    const [, , moves] = engine.analyze.mock.calls[0];
    expect(moves).toEqual(['7g7f', '3c3d']);
  });

  test('moves as space-separated string split into array', async () => {
    await request(app).post('/api/analyze').send({ moves: '7g7f 3c3d' });
    const [, , moves] = engine.analyze.mock.calls[0];
    expect(moves).toEqual(['7g7f', '3c3d']);
  });

  test('empty moves string → moves argument is undefined', async () => {
    await request(app).post('/api/analyze').send({ moves: '' });
    const [, , moves] = engine.analyze.mock.calls[0];
    expect(moves).toBeUndefined();
  });

  // ── response body echoes params ───────────────────────────────────────────
  test('response echoes sfen (or "startpos" when omitted)', async () => {
    const res = await request(app).post('/api/analyze').send({});
    expect(res.body.sfen).toBe('startpos');
  });

  test('response echoes custom sfen', async () => {
    const sfen = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
    const res = await request(app).post('/api/analyze').send({ sfen });
    expect(res.body.sfen).toBe(sfen);
  });

  // ── validation → 400 ─────────────────────────────────────────────────────
  test('depth=-1 → 400', async () => {
    const res = await request(app).post('/api/analyze').send({ depth: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/depth/i);
  });

  test('depth=0 → 400 (must be positive, not zero)', async () => {
    const res = await request(app).post('/api/analyze').send({ depth: 0 });
    expect(res.status).toBe(400);
  });

  test('depth=1.5 (float) → 400', async () => {
    const res = await request(app).post('/api/analyze').send({ depth: 1.5 });
    expect(res.status).toBe(400);
  });

  test('depth="fast" (string) → 400', async () => {
    const res = await request(app).post('/api/analyze').send({ depth: 'fast' });
    expect(res.status).toBe(400);
  });

  test('nodes=0 → 400', async () => {
    const res = await request(app).post('/api/analyze').send({ nodes: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nodes/i);
  });

  test('waittime=-5 → 400', async () => {
    const res = await request(app).post('/api/analyze/-5').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/waittime/i);
  });

  // ── engine not ready → 503 ───────────────────────────────────────────────
  test('503 when engine is not ready', async () => {
    setReady(false);
    const res = await request(app).post('/api/analyze').send({});
    expect(res.status).toBe(503);
    expect(res.body.error).toBeDefined();
  });

  // ── engine error → 500 ───────────────────────────────────────────────────
  test('500 when engine.analyze rejects', async () => {
    engine.analyze.mockRejectedValue(
      new Error('Timeout waiting for response to: "go movetime 3000"'),
    );
    const res = await request(app).post('/api/analyze/3000').send({});
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Timeout/i);
  });
});

// =============================================================================
// GET /api/analyze
// =============================================================================

describe('GET /api/analyze', () => {

  const noMateLines = [
    'info depth 18 score cp 42 pv 2g2f 8c8d',
    'bestmove 2g2f ponder 8c8d',
  ];

  beforeEach(() => {
    engine.analyze.mockResolvedValue(noMateLines);
  });

  test('200 with result shape', async () => {
    const res = await request(app).get('/api/analyze/3000');
    expect(res.status).toBe(200);
    expect(res.body.bestmove).toBe('2g2f');
    expect(res.body.waittime).toBe(3000);
  });

  test('forwards depth query param', async () => {
    await request(app).get('/api/analyze?depth=20');
    const [, , , depth] = engine.analyze.mock.calls[0];
    expect(depth).toBe(20);
  });

  test('forwards nodes query param', async () => {
    await request(app).get('/api/analyze?nodes=500000');
    const [, , , , nodes] = engine.analyze.mock.calls[0];
    expect(nodes).toBe(500000);
  });

  test('forwards sfen query param', async () => {
    const sfenEncoded = encodeURIComponent(
      'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1',
    );
    await request(app).get(`/api/analyze?sfen=${sfenEncoded}`);
    const [sfen] = engine.analyze.mock.calls[0];
    expect(sfen).toContain('lnsgkgsnl');
  });

  test('forwards moves query param (space-separated)', async () => {
    await request(app).get('/api/analyze?moves=7g7f%203c3d');
    const [, , moves] = engine.analyze.mock.calls[0];
    expect(moves).toEqual(['7g7f', '3c3d']);
  });

  test('depth=abc → 400', async () => {
    const res = await request(app).get('/api/analyze?depth=abc');
    expect(res.status).toBe(400);
  });

  test('nodes=-1 → 400', async () => {
    const res = await request(app).get('/api/analyze?nodes=-1');
    expect(res.status).toBe(400);
  });

  test('503 when engine is not ready', async () => {
    setReady(false);
    const res = await request(app).get('/api/analyze');
    expect(res.status).toBe(503);
  });
});

// =============================================================================
// POST /api/analyze/stream — session token
// =============================================================================

describe('POST /api/analyze/stream — session token', () => {
  const noMateLines = [
    'info depth 18 score cp 42 pv 2g2f 8c8d',
    'bestmove 2g2f ponder 8c8d',
  ];

  beforeEach(() => {
    engine.analyze.mockResolvedValue(noMateLines);
  });

  test('first SSE event is a session event containing a stopToken', async () => {
    const res = await request(app)
        .post('/api/analyze/stream')
        .send({})
        .buffer(true);
    const firstEvent = (res.text as string).split('\n\n')[0];
    const match = firstEvent.match(/^data: (.+)$/m);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    expect(parsed.type).toBe('session');
    expect(typeof parsed.stopToken).toBe('string');
    expect(parsed.stopToken.length).toBeGreaterThan(0);
  });

  test('engine.analyze is called with a stopToken as the last argument', async () => {
    await request(app).post('/api/analyze/stream').send({}).buffer(true);
    const args = engine.analyze.mock.calls[0];
    const stopToken = args[6];
    expect(typeof stopToken).toBe('string');
    expect(stopToken.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// POST /api/analyze/stream/stop
// =============================================================================

describe('POST /api/analyze/stream/stop', () => {
  test('400 when stopToken is missing', async () => {
    const res = await request(app).post('/api/analyze/stream/stop').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stopToken/i);
  });

  test('400 when stopToken is not a string', async () => {
    const res = await request(app).post('/api/analyze/stream/stop').send({ stopToken: 42 });
    expect(res.status).toBe(400);
  });

  test('404 when no active stream search', async () => {
    engine.stopSearch.mockImplementation(() => {
      throw Object.assign(new Error('No active stream search.'), { code: 'NO_SEARCH' });
    });
    const res = await request(app).post('/api/analyze/stream/stop').send({ stopToken: 'any' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no active/i);
  });

  test('403 when token does not match active search', async () => {
    engine.stopSearch.mockImplementation(() => {
      throw Object.assign(new Error('Invalid stop token.'), { code: 'INVALID_TOKEN' });
    });
    const res = await request(app).post('/api/analyze/stream/stop').send({ stopToken: 'wrong' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invalid/i);
  });

  test('200 with valid token when engine accepts stop', async () => {
    engine.stopSearch.mockImplementation(() => { /* no-op */ });
    const res = await request(app).post('/api/analyze/stream/stop').send({ stopToken: 'valid-token' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('stop sent');
  });

  test('stopSearch is called with the supplied token', async () => {
    engine.stopSearch.mockImplementation(() => { /* no-op */ });
    await request(app).post('/api/analyze/stream/stop').send({ stopToken: 'abc-123' });
    expect(engine.stopSearch).toHaveBeenCalledWith('abc-123');
  });
});
