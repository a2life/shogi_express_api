/**
 * CommandQueue ensures commands are sent to the USI engine one at a time.
 * Since the engine binary is single-threaded stdin/stdout, we must serialize
 * all interactions — no two commands can be in-flight simultaneously.
 */
export type CommandTask<T> = () => Promise<T>;

export class CommandQueue {
  private queue: Array<() => void> = [];
  private running = false;

  /**
   * Enqueue a task. The task receives exclusive engine access until it resolves.
   */
  enqueue<T>(task: CommandTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.running = false;
          this.next();
        }
      });
      this.next();
    });
  }

  private next(): void {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const task = this.queue.shift()!;
    task();
  }

  /** How many tasks are waiting (not counting the running one). */
  get size(): number {
    return this.queue.length;
  }
}
