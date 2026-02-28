import { Router, Request, Response } from 'express';
import { engine } from '../engine/engineProcess';
import { BLOCKED_COMMANDS, VOID_COMMANDS } from '../engine/usiProtocol';

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
 *   - a blank line is received AFTER at least one non-blank content line
 *     (handles engines that emit a leading blank line before their output), OR
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
            // Track whether we have seen at least one non-blank content line.
            // This prevents a leading blank line (emitted by some engines before
            // their actual output) from terminating the collection prematurely.
            let hasContent = false;

            const lines = await engine.sendAndCollect(
                command,
                (_parsed, raw) => {
                    const trimmed = raw.trim();

                    // Stop on known terminal keyword (exact or as first word)
                    if (TERMINAL_TOKENS.has(trimmed)) return true;
                    const firstWord = trimmed.split(' ')[0];
                    if (firstWord && TERMINAL_TOKENS.has(firstWord)) return true;

                    if (trimmed === '') {
                        // Blank line: only stop if we have already received content.
                        // A leading blank line is skipped so collection continues.
                        return hasContent;
                    }

                    // Non-blank, non-terminal line — mark that real content has arrived.
                    hasContent = true;
                    return false;
                },
                10_000,
                500, // resolve automatically if no new output for 500 ms (e.g. `config`)
            );

            res.json({ command, lines: lines.filter(l => l.trim() !== '') });
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});

export default router;