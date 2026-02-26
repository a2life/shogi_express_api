/**
 * USI Protocol helpers.
 *
 * USI (Universal Shogi Interface) is the Shogi equivalent of UCI for chess.
 * Reference: http://shogidokoro.starfree.jp/usi.html
 */

/** Commands that produce no engine output (fire-and-forget). */
export const VOID_COMMANDS = new Set([
  'usinewgame',
  'gameover',
  'stop',
  'ponderhit',
]);

/** Commands that are handled via dedicated endpoints and must NOT be issued via the generic route. */
export const BLOCKED_COMMANDS = new Set([
  'go',
  'go mate',
  'position',
  'setoption',
  'quit',
]);

// ---------------------------------------------------------------------------
// Line types
// ---------------------------------------------------------------------------

export interface UsiInfo {
  type: 'info';
  raw: string;
  depth?: number;
  /** Score in centipawns (present when score type is "cp"). */
  score?: number;
  /** Mate distance (positive = engine gives mate, negative = engine is mated). */
  mate?: number;
  pv?: string[];
}

export interface UsiBestMove {
  type: 'bestmove';
  move: string;
  ponder?: string;
}

export type UsiLine =
    | UsiInfo
    | UsiBestMove
    | { type: 'usiok' }
    | { type: 'readyok' }
    | { type: 'id'; key: string; value: string }
    | { type: 'option'; raw: string }
    | { type: 'raw'; line: string };

export function parseLine(line: string): UsiLine {
  const trimmed = line.trim();

  if (trimmed === 'usiok') return { type: 'usiok' };
  if (trimmed === 'readyok') return { type: 'readyok' };

  if (trimmed.startsWith('id ')) {
    const rest = trimmed.slice(3);
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx !== -1) {
      return { type: 'id', key: rest.slice(0, spaceIdx), value: rest.slice(spaceIdx + 1) };
    }
  }

  if (trimmed.startsWith('option ')) {
    return { type: 'option', raw: trimmed };
  }

  if (trimmed.startsWith('bestmove ')) {
    const parts = trimmed.split(/\s+/);
    const move = parts[1] ?? '';
    const ponderIdx = parts.indexOf('ponder');
    const ponder = ponderIdx !== -1 ? parts[ponderIdx + 1] : undefined;
    return { type: 'bestmove', move, ponder };
  }

  if (trimmed.startsWith('info ')) {
    const info: UsiInfo = { type: 'info', raw: trimmed };

    const depthMatch = trimmed.match(/\bdepth (\d+)/);
    if (depthMatch) info.depth = parseInt(depthMatch[1], 10);

    // "score cp <n>" — centipawn score
    const cpMatch = trimmed.match(/\bscore cp (-?\d+)/);
    if (cpMatch) info.score = parseInt(cpMatch[1], 10);

    // "score mate <n>" — mate in N (positive = we give mate, negative = we get mated)
    const mateMatch = trimmed.match(/\bscore mate (-?\d+)/);
    if (mateMatch) info.mate = parseInt(mateMatch[1], 10);

    // "pv <move1> <move2> ..." — principal variation (always last token group)
    const pvMatch = trimmed.match(/\bpv (.+)/);
    if (pvMatch) info.pv = pvMatch[1].trim().split(/\s+/);

    return info;
  }

  return { type: 'raw', line: trimmed };
}

// ---------------------------------------------------------------------------
// Analyze result enrichment
// ---------------------------------------------------------------------------

export interface MateInfo {
  mate: true;
  mate_length: number;
  mate_moves: string;
}

export interface NoMateInfo {
  mate: false;
  /** Centipawn score from the last info line. null if the engine did not report one. */
  score: number | null;
}

export type AnalysisResult = {
  bestmove: string | null;
  ponder: string | null;
} & (MateInfo | NoMateInfo);

/**
 * Given the raw output lines from an analyze session, extract and return a
 * structured result summary:
 *
 *  - Inspects all "info" lines and takes the **last** one for score/mate detection.
 *  - If that info line contains "score mate <n>", sets mate=true and populates
 *    mate_length / mate_moves from the pv.
 *  - Otherwise sets mate=false and populates score from "score cp <n>" (null if absent).
 *  - Parses the "bestmove" line into bestmove / ponder fields.
 */
export function parseAnalysisResult(lines: string[]): AnalysisResult {
  // Collect all parsed info lines; take the last one.
  const infoLines: UsiInfo[] = lines
      .map(parseLine)
      .filter((l): l is UsiInfo => l.type === 'info');

  const lastInfo = infoLines.at(-1);

  // Parse bestmove line
  const bestmoveParsed = lines
      .map(parseLine)
      .find((l): l is UsiBestMove => l.type === 'bestmove');

  const bestmove = bestmoveParsed?.move ?? null;
  const ponder = bestmoveParsed?.ponder ?? null;

  // Mate takes priority — score cp is irrelevant when a forced mate is found
  if (lastInfo?.mate !== undefined) {
    return {
      bestmove,
      ponder,
      mate: true,
      mate_length: Math.abs(lastInfo.mate),
      mate_moves: (lastInfo.pv ?? []).join(' '),
    };
  }

  return {
    bestmove,
    ponder,
    mate: false,
    score: lastInfo?.score ?? null,
  };
}