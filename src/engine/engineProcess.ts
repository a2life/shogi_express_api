import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import readline from 'readline';
import config from '../config';
import { parseLine, UsiLine } from './usiProtocol';
import { CommandQueue } from './commandQueue';

const MAX_RETRIES = 3;
const RETRY_WINDOW_MS = 3 * 60 * 1000; // 3 minutes

export interface EngineInfo {
  name: string;
  author: string;
}

export class EngineProcess extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readonly queue = new CommandQueue();
  private ready = false;
  private crashTimestamps: number[] = [];
  private shuttingDown = false;
  private _engineInfo: EngineInfo = { name: 'unknown', author: 'unknown' };
  /** Token held by the currently-running stream search. null when idle. */
  private activeStopToken: string | null = null;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Start the engine and run the USI initialization handshake. */
  async initialize(): Promise<void> {
    await this.spawnEngine();
    await this.handshake();
    this.ready = true;
    console.log('[Engine] Initialized and ready.');
  }

  /**
   * Send a command that expects no output (fire-and-forget).
   * Still goes through the queue so it doesn't interleave with other commands.
   */
  sendVoid(command: string): Promise<void> {
    return this.queue.enqueue(async () => {
      this.write(command);
    });
  }

  /**
   * Send a command and collect all output lines until `stopPredicate` returns
   * true for a received line. Resolves with the collected lines.
   *
   * @param idleTimeoutMs - If set, resolve automatically when no new lines
   *   arrive for this many milliseconds (useful for commands with no terminal
   *   token, like `config`).
   */
  sendAndCollect(
      command: string,
      stopPredicate: (parsed: UsiLine, raw: string) => boolean,
      timeoutMs = 30_000,
      idleTimeoutMs?: number,
  ): Promise<string[]> {
    return this.queue.enqueue(() => this.doSendAndCollect(command, stopPredicate, timeoutMs, idleTimeoutMs));
  }

  /**
   * Specialized method for the 'analyze' workflow:
   * 1. position sfen <sfen> [moves <move1> <move2> ...]
   * 2. go [movetime <ms>] [depth <n>] [nodes <n>]  |  go infinite
   * 3. (optionally) stop after idle timeout for infinite mode
   * Returns all output lines up to and including bestmove.
   *
   * @param sfen     - SFEN position string
   * @param waittime - milliseconds for movetime, 0 for infinite, undefined for plain go
   * @param moves    - optional list of USI moves played from the position (e.g. ["7g7f","3c3d"])
   * @param depth    - optional maximum search depth (go depth <n>)
   * @param nodes    - optional maximum node count (go nodes <n>)
   * @param onLine   - optional callback invoked for each line as it arrives (for SSE streaming)
   *
   * Note: waittime=0 (infinite) takes priority over depth/nodes.
   * depth and nodes can be combined with each other and with waittime > 0.
   */
  async analyze(
      sfen: string | undefined,
      waittime?: number,
      moves?: string[],
      depth?: number,
      nodes?: number,
      onLine?: (raw: string, parsed: UsiLine) => void,
      stopToken?: string,
  ): Promise<string[]> {
    return this.queue.enqueue(async () => {
      if (stopToken) this.activeStopToken = stopToken;
      try {
        // Step 1: send position
        // When sfen is omitted use "startpos", otherwise "sfen <sfen>"
        const positionBase = sfen ? `sfen ${sfen}` : 'startpos';
        const moveSuffix =
            moves && moves.length > 0 ? ` moves ${moves.join(' ')}` : '';
        this.write(`position ${positionBase}${moveSuffix}`);

        // Step 2: build go command
        // waittime === 0 → go infinite (depth/nodes ignored; stop sent after idle)
        if (waittime === 0) {
          return await this.doInfiniteGo('go infinite', onLine);
        }

        const parts: string[] = ['go'];
        if (waittime !== undefined) parts.push(`movetime ${waittime}`);
        if (depth !== undefined)    parts.push(`depth ${depth}`);
        if (nodes !== undefined)    parts.push(`nodes ${nodes}`);

        const goCommand = parts.join(' ');

        // Timeout: generous headroom beyond movetime; for depth/nodes-only searches
        // we allow up to 5 minutes since we have no wall-clock bound.
        const timeoutMs = waittime !== undefined
            ? waittime + 30_000
            : 5 * 60_000;

        return await this.doSendAndCollect(
            goCommand,
            (parsed) => parsed.type === 'bestmove',
            timeoutMs,
            undefined,
            onLine,
        );
      } finally {
        if (stopToken) this.activeStopToken = null;
      }
    });
  }

  /**
   * Send 'stop' directly to the engine, bypassing the command queue.
   * Only succeeds when the token matches the active stream search.
   * Called from the /api/analyze/stream/stop endpoint.
   */
  stopSearch(token: string): void {
    if (!this.activeStopToken) {
      throw Object.assign(new Error('No active stream search.'), { code: 'NO_SEARCH' });
    }
    if (token !== this.activeStopToken) {
      throw Object.assign(new Error('Invalid stop token.'), { code: 'INVALID_TOKEN' });
    }
    this.write('stop');
  }

  /** Graceful shutdown. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.proc) {
      this.write('quit');
      await new Promise<void>((res) => setTimeout(res, 500));
      this.proc.kill();
    }
  }

  get isReady(): boolean {
    return this.ready;
  }

  get engineInfo(): EngineInfo {
    return this._engineInfo;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private spawnEngine(): Promise<void> {
    return new Promise((resolve, reject) => {
      const enginePath = config.enginePath;
      console.log(`[Engine] Spawning: ${enginePath}`);

      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = spawn(enginePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (err) {
        return reject(new Error(`Failed to spawn engine at "${enginePath}": ${err}`));
      }

      this.proc = proc;

      const rl = readline.createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        const parsed = parseLine(line);
        this.emit('line', line, parsed);
      });

      proc.stderr.on('data', (data: Buffer) => {
        console.error('[Engine stderr]', data.toString().trim());
      });

      proc.on('error', (err) => {
        console.error('[Engine] Process error:', err);
        reject(err);
      });

      proc.on('exit', (code, signal) => {
        console.warn(`[Engine] Process exited (code=${code}, signal=${signal})`);
        this.ready = false;
        this.proc = null;
        if (!this.shuttingDown) {
          this.handleCrash();
        }
      });

      // Resolve once the process is running (we haven't yet sent usi)
      resolve();
    });
  }

  /** Run the USI initialization handshake (usi → usiok → setoptions → isready → readyok). */
  private async handshake(): Promise<void> {
    // Send 'usi' and wait for 'usiok'; capture id name / id author from the response
    const usiLines = await this.doSendAndCollect('usi', (parsed) => parsed.type === 'usiok', 10_000);
    for (const line of usiLines) {
      const parsed = parseLine(line);
      if (parsed.type === 'id') {
        if (parsed.key === 'name')   this._engineInfo.name   = parsed.value;
        if (parsed.key === 'author') this._engineInfo.author = parsed.value;
      }
    }
    console.log(`[Engine] usiok received. Engine: ${this._engineInfo.name} by ${this._engineInfo.author}`);

    // Apply options from config
    for (const [name, value] of Object.entries(config.engineOptions)) {
      this.write(`setoption name ${name} value ${value}`);
    }

    // Send 'isready' and wait for 'readyok'
    await this.doSendAndCollect('isready', (parsed) => parsed.type === 'readyok', 30_000);
    console.log('[Engine] readyok received.');
  }

  /** Core send+collect implementation (runs directly, not via queue). */
  private doSendAndCollect(
      command: string,
      stopPredicate: (parsed: UsiLine, raw: string) => boolean,
      timeoutMs: number,
      idleTimeoutMs?: number,
      onEachLine?: (raw: string, parsed: UsiLine) => void,
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      let idleTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        clearTimeout(timer);
        if (idleTimer) clearTimeout(idleTimer);
        this.removeListener('line', onLine);
      };

      const onLine = (raw: string, parsed: UsiLine) => {
        lines.push(raw);
        onEachLine?.(raw, parsed);
        if (stopPredicate(parsed, raw)) {
          cleanup();
          resolve(lines);
        } else if (idleTimeoutMs) {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            cleanup();
            resolve(lines);
          }, idleTimeoutMs);
        }
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for response to: "${command}"`));
      }, timeoutMs);

      this.on('line', onLine);
      this.write(command);
    });
  }

  /**
   * Handle 'go infinite': send the command, then monitor stdout.
   * If no output arrives for 10 seconds, send 'stop' and wait for 'bestmove'.
   */
  private doInfiniteGo(
      goCommand: string,
      onEachLine?: (raw: string, parsed: UsiLine) => void,
  ): Promise<string[]> {
    return new Promise((resolve) => {
      const lines: string[] = [];
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;

      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (!stopped) {
            stopped = true;
            console.log('[Engine] No output for 10s — sending stop.');
            this.write('stop');
          }
        }, 10_000);
      };

      const onLine = (raw: string, parsed: UsiLine) => {
        lines.push(raw);
        onEachLine?.(raw, parsed);
        if (parsed.type === 'bestmove') {
          if (idleTimer) clearTimeout(idleTimer);
          this.removeListener('line', onLine);
          resolve(lines);
          return;
        }
        resetIdleTimer();
      };

      this.on('line', onLine);
      this.write(goCommand);
      resetIdleTimer();
    });
  }

  private write(command: string): void {
    if (!this.proc) {
      throw new Error('[Engine] No process running.');
    }
    console.log(`[Engine →] ${command}`);
    this.proc.stdin.write(command + '\n');
  }

  // ---------------------------------------------------------------------------
  // Crash / restart logic
  // ---------------------------------------------------------------------------

  private handleCrash(): void {
    const now = Date.now();
    // Prune timestamps outside the 3-minute window
    this.crashTimestamps = this.crashTimestamps.filter((t) => now - t < RETRY_WINDOW_MS);
    this.crashTimestamps.push(now);

    if (this.crashTimestamps.length > MAX_RETRIES) {
      console.error('[Engine] Too many crashes in 3 minutes. Giving up.');
      this.emit('fatal');
      return;
    }

    const delay = 1000 * this.crashTimestamps.length; // back-off: 1s, 2s, 3s
    console.warn(`[Engine] Restarting in ${delay}ms (attempt ${this.crashTimestamps.length}/${MAX_RETRIES})…`);

    setTimeout(async () => {
      try {
        await this.spawnEngine();
        await this.handshake();
        this.ready = true;
        console.log('[Engine] Restarted successfully.');
        this.emit('restarted');
      } catch (err) {
        console.error('[Engine] Restart failed:', err);
        this.handleCrash();
      }
    }, delay);
  }
}

// Singleton instance
export const engine = new EngineProcess();