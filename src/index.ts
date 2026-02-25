import config from './config';
import { createApp } from './app';
import { engine } from './engine/engineProcess';

async function main(): Promise<void> {
  // Initialize the engine before accepting traffic
  try {
    await engine.initialize();
  } catch (err) {
    console.error('[Startup] Engine initialization failed:', err);
    process.exit(1);
  }

  engine.on('fatal', () => {
    console.error('[Engine] Fatal crash — too many retries. Shutting down server.');
    process.exit(1);
  });

  const app = createApp();

  app.listen(config.port, () => {
    console.log(`[Server] Shogi API listening on http://localhost:${config.port}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[Server] Received ${signal}. Shutting down…`);
    await engine.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[Startup] Unhandled error:', err);
  process.exit(1);
});
