/**
 * Unit tests for src/engine/commandQueue.ts
 *
 * Real API:
 *   enqueue<T>(task: () => Promise<T>): Promise<T>
 *   get size(): number   — waiting tasks only, excludes the running one
 */

import { CommandQueue } from '../../src/engine/commandQueue';

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function delayedTask<T>(value: T, ms = 20): () => Promise<T> {
  return () => delay(ms).then(() => value);
}

function failingTask(message: string, ms = 20): () => Promise<never> {
  return () => delay(ms).then(() => Promise.reject(new Error(message)));
}

describe('CommandQueue', () => {
  let queue: CommandQueue;

  beforeEach(() => {
    queue = new CommandQueue();
  });

  // ── basic execution ───────────────────────────────────────────────────────
  test('single task resolves with the correct value', async () => {
    expect(await queue.enqueue(delayedTask('hello'))).toBe('hello');
  });

  test('each caller receives its own resolved value', async () => {
    const [a, b, c] = await Promise.all([
      queue.enqueue(delayedTask('a')),
      queue.enqueue(delayedTask('b')),
      queue.enqueue(delayedTask('c')),
    ]);
    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(c).toBe('c');
  });

  test('handles a synchronous-style Promise.resolve task', async () => {
    expect(await queue.enqueue(() => Promise.resolve(42))).toBe(42);
  });

  // ── serial execution / no concurrency ────────────────────────────────────
  test('never runs two tasks concurrently — maxActive is always 1', async () => {
    let active = 0;
    let maxActive = 0;

    const trackTask = () => new Promise<void>((resolve) => {
      active++;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => { active--; resolve(); }, 20);
    });

    await Promise.all([
      queue.enqueue(trackTask),
      queue.enqueue(trackTask),
      queue.enqueue(trackTask),
    ]);

    expect(maxActive).toBe(1);
  });

  test('tasks execute in FIFO order', async () => {
    const order: number[] = [];
    const makeTask = (n: number) => () =>
      new Promise<void>((resolve) => setTimeout(() => { order.push(n); resolve(); }, 10));

    await Promise.all([
      queue.enqueue(makeTask(1)),
      queue.enqueue(makeTask(2)),
      queue.enqueue(makeTask(3)),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  // ── error handling ────────────────────────────────────────────────────────
  test('rejects the caller when a task throws', async () => {
    await expect(queue.enqueue(failingTask('boom'))).rejects.toThrow('boom');
  });

  test('queue continues processing after a failure', async () => {
    const results: Array<string | Error> = [];

    await Promise.all([
      queue.enqueue(failingTask('err1')).catch((e: Error) => results.push(e)),
      queue.enqueue(delayedTask('ok')).then((v) => results.push(v)),
    ]);

    expect(results[0]).toBeInstanceOf(Error);
    expect((results[0] as Error).message).toBe('err1');
    expect(results[1]).toBe('ok');
  });

  test('multiple sequential failures do not break the queue', async () => {
    const errs: Error[] = [];
    await queue.enqueue(failingTask('e1')).catch((e: Error) => errs.push(e));
    await queue.enqueue(failingTask('e2')).catch((e: Error) => errs.push(e));

    const ok = await queue.enqueue(delayedTask('survived'));
    expect(errs.map((e) => e.message)).toEqual(['e1', 'e2']);
    expect(ok).toBe('survived');
  });

  // ── size property ─────────────────────────────────────────────────────────
  test('size is 0 on a fresh queue', () => {
    expect(queue.size).toBe(0);
  });

  test('size counts waiting tasks, not the running one', async () => {
    let sizeObserved = -1;

    // First task holds the queue and samples size while running.
    // Defer the sample via setTimeout so the two subsequent enqueues
    // have already pushed into the queue before we read size.
    const first = queue.enqueue(() => new Promise<void>((resolve) => {
      setTimeout(() => {
        sizeObserved = queue.size;
        resolve();
      }, 40);
    }));

    // Enqueue two more before the first resolves
    queue.enqueue(delayedTask('x'));
    queue.enqueue(delayedTask('y'));

    await first;
    await delay(100); // drain remaining tasks

    // While first was running, two tasks were queued (not counting runner)
    expect(sizeObserved).toBe(2);
  });

  test('size returns to 0 after all tasks complete', async () => {
    await Promise.all([
      queue.enqueue(delayedTask('a')),
      queue.enqueue(delayedTask('b')),
    ]);
    expect(queue.size).toBe(0);
  });

  test('size returns to 0 even after a failed task', async () => {
    await queue.enqueue(failingTask('oops')).catch(() => {});
    expect(queue.size).toBe(0);
  });
});
