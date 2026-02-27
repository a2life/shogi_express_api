/**
 * Unit tests for src/engine/usiProtocol.ts
 */

import {
  parseLine,
  parseAnalysisResult,
  VOID_COMMANDS,
  BLOCKED_COMMANDS,
  UsiInfo,
  UsiBestMove,
} from '../../src/engine/usiProtocol';

// ─────────────────────────────────────────────────────────────────────────────
// VOID_COMMANDS / BLOCKED_COMMANDS
// ─────────────────────────────────────────────────────────────────────────────

describe('VOID_COMMANDS', () => {
  test.each(['usinewgame', 'gameover', 'stop', 'ponderhit'])(
    'contains "%s"',
    (cmd) => expect(VOID_COMMANDS.has(cmd)).toBe(true),
  );
  test.each(['usi', 'isready', 'go', 'quit'])(
    'does not contain "%s"',
    (cmd) => expect(VOID_COMMANDS.has(cmd)).toBe(false),
  );
});

describe('BLOCKED_COMMANDS', () => {
  test.each(['go', 'go mate', 'position', 'setoption', 'quit'])(
    'contains "%s"',
    (cmd) => expect(BLOCKED_COMMANDS.has(cmd)).toBe(true),
  );
  test.each(['usi', 'isready', 'usinewgame', 'stop'])(
    'does not contain "%s"',
    (cmd) => expect(BLOCKED_COMMANDS.has(cmd)).toBe(false),
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// parseLine()
// ─────────────────────────────────────────────────────────────────────────────

describe('parseLine()', () => {

  // ── fixed tokens ─────────────────────────────────────────────────────────
  test('"usiok" → { type: "usiok" }', () => {
    expect(parseLine('usiok')).toEqual({ type: 'usiok' });
  });

  test('"readyok" → { type: "readyok" }', () => {
    expect(parseLine('readyok')).toEqual({ type: 'readyok' });
  });

  test('trims surrounding whitespace before matching', () => {
    expect(parseLine('  usiok  ')).toEqual({ type: 'usiok' });
    expect(parseLine('  readyok\n')).toEqual({ type: 'readyok' });
  });

  // ── id lines ──────────────────────────────────────────────────────────────
  test('"id name YaneuraOu"', () => {
    expect(parseLine('id name YaneuraOu')).toEqual({
      type: 'id', key: 'name', value: 'YaneuraOu',
    });
  });

  test('"id author yaneurao"', () => {
    expect(parseLine('id author yaneurao')).toEqual({
      type: 'id', key: 'author', value: 'yaneurao',
    });
  });

  test('id value keeps all words after the first space', () => {
    expect(parseLine('id name YaneuraOu NNUE 9.20git 64AVX2')).toMatchObject({
      type: 'id', key: 'name', value: 'YaneuraOu NNUE 9.20git 64AVX2',
    });
  });

  // ── option lines ──────────────────────────────────────────────────────────
  test('option line → { type: "option", raw }', () => {
    const raw = 'option name USI_Hash type spin default 256 min 1 max 33554432';
    expect(parseLine(raw)).toEqual({ type: 'option', raw });
  });

  // ── bestmove lines ────────────────────────────────────────────────────────
  test('"bestmove 7g7f ponder 3c3d"', () => {
    expect(parseLine('bestmove 7g7f ponder 3c3d')).toEqual({
      type: 'bestmove', move: '7g7f', ponder: '3c3d',
    });
  });

  test('"bestmove 2g2f" — ponder is undefined (not null)', () => {
    const result = parseLine('bestmove 2g2f') as UsiBestMove;
    expect(result.type).toBe('bestmove');
    expect(result.move).toBe('2g2f');
    expect(result.ponder).toBeUndefined();
  });

  test('"bestmove resign"', () => {
    expect((parseLine('bestmove resign') as UsiBestMove).move).toBe('resign');
  });

  test('"bestmove win"', () => {
    expect((parseLine('bestmove win') as UsiBestMove).move).toBe('win');
  });

  // ── info lines ────────────────────────────────────────────────────────────
  test('info with depth, score cp, and pv', () => {
    const result = parseLine(
      'info depth 18 seldepth 22 multipv 1 score cp 42 nodes 1234 pv 2g2f 8c8d',
    ) as UsiInfo;

    expect(result.type).toBe('info');
    expect(result.depth).toBe(18);
    expect(result.score).toBe(42);
    expect(result.mate).toBeUndefined();
    expect(result.pv).toEqual(['2g2f', '8c8d']);
  });

  test('info with negative cp score', () => {
    const result = parseLine('info depth 10 score cp -150 pv 8c8d') as UsiInfo;
    expect(result.score).toBe(-150);
    expect(result.mate).toBeUndefined();
  });

  test('info with score mate positive (engine gives mate)', () => {
    const result = parseLine(
      'info depth 33 score mate 11 pv 8a6c 6b6c 3b5b+',
    ) as UsiInfo;
    expect(result.mate).toBe(11);
    expect(result.score).toBeUndefined();
    expect(result.pv).toEqual(['8a6c', '6b6c', '3b5b+']);
  });

  test('info with score mate negative (engine is mated)', () => {
    const result = parseLine('info depth 5 score mate -3 pv 5e5f') as UsiInfo;
    expect(result.mate).toBe(-3);
  });

  test('info preserves raw string', () => {
    const raw = 'info depth 5 score cp 10 pv 7g7f';
    expect((parseLine(raw) as UsiInfo).raw).toBe(raw);
  });

  test('info without pv — pv is undefined', () => {
    expect((parseLine('info depth 1 score cp 0') as UsiInfo).pv).toBeUndefined();
  });

  test('info with no known fields still returns type "info"', () => {
    expect((parseLine('info nodes 100 time 50') as UsiInfo).type).toBe('info');
  });

  // ── raw fallback ──────────────────────────────────────────────────────────
  test('unrecognised line → { type: "raw", line }', () => {
    expect(parseLine('copyprotection ok')).toEqual({
      type: 'raw', line: 'copyprotection ok',
    });
  });

  test('empty string → { type: "raw", line: "" }', () => {
    expect(parseLine('')).toEqual({ type: 'raw', line: '' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseAnalysisResult()
// ─────────────────────────────────────────────────────────────────────────────

describe('parseAnalysisResult()', () => {

  // ── bestmove / ponder ─────────────────────────────────────────────────────
  test('extracts bestmove and ponder', () => {
    const r = parseAnalysisResult([
      'info depth 18 score cp 42 pv 2g2f 8c8d',
      'bestmove 2g2f ponder 8c8d',
    ]);
    expect(r.bestmove).toBe('2g2f');
    expect(r.ponder).toBe('8c8d');
  });

  test('ponder is null when bestmove line has no ponder token', () => {
    const r = parseAnalysisResult(['bestmove 7g7f']);
    expect(r.ponder).toBeNull();
  });

  test('bestmove is null when no bestmove line exists', () => {
    expect(parseAnalysisResult(['info depth 5 score cp 10']).bestmove).toBeNull();
  });

  // ── no-mate path ──────────────────────────────────────────────────────────
  test('mate=false, score from the LAST info line', () => {
    const r = parseAnalysisResult([
      'info depth 10 score cp 10 pv 7g7f',
      'info depth 18 score cp 42 pv 2g2f 8c8d',
      'bestmove 2g2f ponder 8c8d',
    ]);
    expect(r.mate).toBe(false);
    if (!r.mate) expect(r.score).toBe(42);
  });

  test('only the last info line is used for score — earlier lines ignored', () => {
    const r = parseAnalysisResult([
      'info depth 5 score cp 10 pv 7g7f',
      'info depth 20 score cp 99 pv 2g2f',
      'bestmove 2g2f',
    ]);
    if (!r.mate) expect(r.score).toBe(99);
  });

  test('score is null when last info line has no cp token', () => {
    const r = parseAnalysisResult(['info depth 1 nodes 100', 'bestmove 7g7f']);
    if (!r.mate) expect(r.score).toBeNull();
  });

  test('score is null when there are no info lines', () => {
    const r = parseAnalysisResult(['bestmove 7g7f']);
    expect(r.mate).toBe(false);
    if (!r.mate) expect(r.score).toBeNull();
  });

  test('negative centipawn score', () => {
    const r = parseAnalysisResult(['info depth 20 score cp -150 pv 8c8d', 'bestmove 8c8d']);
    if (!r.mate) expect(r.score).toBe(-150);
  });

  // ── mate path ─────────────────────────────────────────────────────────────
  test('mate=true with mate_length and mate_moves from pv', () => {
    const pv = '8a6c 6b6c 3b5b+ 6c7c N*8e 7c8c L*8d 8c8d S*9c 8d8c 5b8b';
    const r = parseAnalysisResult([
      `info depth 33 seldepth 12 score mate 11 pv ${pv}`,
      'bestmove 8a6c ponder 6b6c',
    ]);
    expect(r.mate).toBe(true);
    if (r.mate) {
      expect(r.mate_length).toBe(11);
      expect(r.mate_moves).toBe(pv);
    }
  });

  test('mate_length = Math.abs(mate) for negative mate distance', () => {
    const r = parseAnalysisResult([
      'info depth 5 score mate -3 pv 5e5f 5g5f 4e4f',
      'bestmove 5e5f',
    ]);
    expect(r.mate).toBe(true);
    if (r.mate) expect(r.mate_length).toBe(3);
  });

  test('score field is absent on a mate result', () => {
    const r = parseAnalysisResult([
      'info depth 10 score mate 5 pv 7g7f 3c3d',
      'bestmove 7g7f',
    ]);
    expect(r.mate).toBe(true);
    expect((r as any).score).toBeUndefined();
  });

  test('mate_moves is empty string when info has no pv', () => {
    const r = parseAnalysisResult(['info depth 10 score mate 1', 'bestmove 7g7f']);
    expect(r.mate).toBe(true);
    if (r.mate) expect(r.mate_moves).toBe('');
  });

  // ── edge cases ────────────────────────────────────────────────────────────
  test('empty array → null bestmove, mate=false, score=null', () => {
    const r = parseAnalysisResult([]);
    expect(r.bestmove).toBeNull();
    expect(r.ponder).toBeNull();
    expect(r.mate).toBe(false);
    if (!r.mate) expect(r.score).toBeNull();
  });

  test('non-info/non-bestmove lines (id, usiok, readyok) do not affect result', () => {
    const r = parseAnalysisResult([
      'id name YaneuraOu',
      'usiok',
      'readyok',
      'info depth 5 score cp 20 pv 7g7f',
      'bestmove 7g7f',
    ]);
    expect(r.bestmove).toBe('7g7f');
    if (!r.mate) expect(r.score).toBe(20);
  });
});
