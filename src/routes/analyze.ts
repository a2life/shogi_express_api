import { Router, Request, Response } from 'express';
import { engine } from '../engine/engineProcess';
import { parseAnalysisResult } from '../engine/usiProtocol';

const router = Router();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parseWaittime(raw: string | undefined): { value: number | undefined } | { error: string } {
  if (raw === undefined) return { value: undefined };
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 0) {
    return { error: 'waittime must be a non-negative integer (milliseconds).' };
  }
  return { value: n };
}

function parsePosInt(
    raw: unknown,
    name: string,
): { value: number | undefined } | { error: string } {
  if (raw === undefined || raw === null || raw === '') return { value: undefined };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return { error: `"${name}" must be a positive integer.` };
  }
  return { value: n };
}

function parseMoves(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;

  let tokens: string[];
  if (Array.isArray(raw)) {
    tokens = raw.map(String);
  } else if (typeof raw === 'string') {
    tokens = raw.trim().split(/\s+/);
  } else {
    return undefined;
  }

  const filtered = tokens.filter((t) => t.length > 0);
  return filtered.length > 0 ? filtered : undefined;
}

interface GoParams {
  waittime: number | undefined;
  depth: number | undefined;
  nodes: number | undefined;
}

function parseGoParams(
    waittimeRaw: string | undefined,
    depthRaw: unknown,
    nodesRaw: unknown,
): { value: GoParams } | { error: string } {
  const wt = parseWaittime(waittimeRaw);
  if ('error' in wt) return { error: wt.error };

  const dp = parsePosInt(depthRaw, 'depth');
  if ('error' in dp) return { error: dp.error };

  const nd = parsePosInt(nodesRaw, 'nodes');
  if ('error' in nd) return { error: nd.error };

  return { value: { waittime: wt.value, depth: dp.value, nodes: nd.value } };
}

// ---------------------------------------------------------------------------
// Core handler shared by GET and POST
// ---------------------------------------------------------------------------

async function runAnalyze(
    res: Response,
    /** Undefined means use startpos. */
    sfen: string | undefined,
    moves: string[] | undefined,
    goParams: GoParams,
): Promise<void> {
  if (!engine.isReady) {
    res.status(503).json({ error: 'Engine is not ready.' });
    return;
  }

  const { waittime, depth, nodes } = goParams;

  try {
    const lines = await engine.analyze(sfen, waittime, moves, depth, nodes);
    const analysis = parseAnalysisResult(lines);

    res.json({
      // Echo back which position was used so the caller can confirm
      sfen: sfen ?? 'startpos',
      moves: moves ?? [],
      waittime,
      depth: depth ?? null,
      nodes: nodes ?? null,
      lines,
      ...analysis,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
}

// ---------------------------------------------------------------------------
// POST /api/analyze/:waittime?
//
// Body: {
//   "sfen":  "<sfen>",               (optional — omit to use startpos)
//   "moves": "<m1> <m2>..." | [...], (optional)
//   "depth": <number>,               (optional)
//   "nodes": <number>                (optional)
// }
// ---------------------------------------------------------------------------
router.post('/:waittime?', async (req: Request, res: Response) => {
  const { sfen, moves: rawMoves, depth: rawDepth, nodes: rawNodes } =
      req.body as { sfen?: unknown; moves?: unknown; depth?: unknown; nodes?: unknown };

  // sfen must be a non-empty string when supplied; otherwise we use startpos
  const sfenValue: string | undefined =
      typeof sfen === 'string' && sfen.trim() !== '' ? sfen.trim() : undefined;

  const goResult = parseGoParams(req.params.waittime, rawDepth, rawNodes);
  if ('error' in goResult) {
    res.status(400).json({ error: goResult.error });
    return;
  }

  await runAnalyze(res, sfenValue, parseMoves(rawMoves), goResult.value);
});

// ---------------------------------------------------------------------------
// GET /api/analyze/:waittime?
//
// Query parameters:
//   sfen=<url-encoded>   (optional — omit to use startpos)
//   moves=<url-encoded>  (optional)
//   depth=<integer>      (optional)
//   nodes=<integer>      (optional)
// ---------------------------------------------------------------------------
router.get('/:waittime?', async (req: Request, res: Response) => {
  const rawSfen = req.query.sfen;

  // sfen must be a non-empty string when supplied; otherwise we use startpos
  const sfenValue: string | undefined =
      typeof rawSfen === 'string' && rawSfen.trim() !== '' ? rawSfen.trim() : undefined;

  const goResult = parseGoParams(req.params.waittime, req.query.depth, req.query.nodes);
  if ('error' in goResult) {
    res.status(400).json({ error: goResult.error });
    return;
  }

  await runAnalyze(res, sfenValue, parseMoves(req.query.moves), goResult.value);
});

export default router;