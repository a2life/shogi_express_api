import { Router, Request, Response } from 'express';
import { engine } from '../engine/engineProcess';
import { BLOCKED_COMMANDS, VOID_COMMANDS, parseLine } from '../engine/usiProtocol';

const router = Router();

/**
 * Terminal tokens: lines that signal the engine has finished responding
 * to the current command. The collector stops on the first match.
 */
const TERMINAL_TOKENS = new Set(['usiok', 'readyok', 'bestmove']);

/**
 * GET /api/usi_command/:command
 *
 * Issues a raw USI command to the engine.
 * Blocked commands (go, position, setoption, quit, go mate) are rejected.
 * Void commands (no response expected) resolve immediately.
 * All other commands collect output until:
 *   - a known terminal token is received (usiok, readyok, bestmove), OR
 *   - an empty line is received (engine signals end of list), OR
 *   - the timeout elapses.
 */
router.get('/:command', async (req: Request, res: Response) => {
  const command = req.params.command.trim();

  // Block forbidden commands
  if (BLOCKED_COMMANDS.has(command.toLowerCase())) {
    res.status(400).json({
      error: `Command "${command}" is not allowed via this endpoint.`,
      hint: 'Use dedicated endpoints for go/position/setoption/quit.',
    });
    return;
  }

  if (!engine.isReady) {
    res.status(503).json({ error: 'Engine is not ready.' });
    return;
  }

  try {
    if (VOID_COMMANDS.has(command.toLowerCase())) {
      await engine.sendVoid(command);
      res.json({ command, result: 'sent', lines: [] });
    } else {
      const lines = await engine.sendAndCollect(
          command,
          (_parsed, raw) => {
            const trimmed = raw.trim();
            // Stop on known terminal tokens
            if (TERMINAL_TOKENS.has(trimmed)) return true;
            // Stop on a token that starts with a terminal keyword
            // e.g. "bestmove 7g7f ponder 3c3d"
            const firstWord = trimmed.split(' ')[0];
            if (firstWord && TERMINAL_TOKENS.has(firstWord)) return true;
            // Stop on blank line (engine signals end of an option/id list)
            if (trimmed === '') return true;
            return false;
          },
          10_000,
      );
      res.json({ command, lines });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;