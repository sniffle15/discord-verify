import { closeSubscriber } from './events.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';
import { redis } from './redis.js';

const hooks: (() => Promise<unknown>)[] = [];
let shuttingDown = false;

export function onShutdown(hook: () => Promise<unknown>): void {
  hooks.push(hook);
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const timer = setTimeout(() => process.exit(1), 20_000);
  timer.unref();

  for (const hook of hooks.reverse()) {
    await hook().catch((err) => logger.error({ err }, 'Shutdown hook failed'));
  }
  await closeSubscriber();
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  void shutdown('uncaughtException');
});
