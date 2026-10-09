process.env.DV_SERVICE ??= 'worker';

const { logger } = await import('./lib/logger.js');
const { CHANNELS, subscribe } = await import('./lib/events.js');
const { getSettings, initSettingsSync } = await import('./lib/settings.js');
const { onShutdown } = await import('./lib/shutdown.js');
const { restoreQueue, scheduleTokenSweep, tokenCheckQueue } = await import('./queues/index.js');
const { createTokenCheckWorker } = await import('./workers/token-check.js');
const { createRestoreWorker } = await import('./workers/restore.js');

initSettingsSync();

const tokenWorker = createTokenCheckWorker();
const restoreWorker = createRestoreWorker();

let currentInterval = (await getSettings()).syncIntervalMinutes;
await scheduleTokenSweep(currentInterval);
logger.info({ intervalMinutes: currentInterval }, 'Token sweep scheduled');

subscribe<{ keys: string[] }>(CHANNELS.configUpdated, ({ keys }) => {
  if (!keys.includes('syncIntervalMinutes')) return;
  void (async () => {
    // Small delay so the settings cache invalidation from the same message lands first.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const next = (await getSettings()).syncIntervalMinutes;
    if (next === currentInterval) return;
    await scheduleTokenSweep(next);
    currentInterval = next;
    logger.info({ intervalMinutes: next }, 'Token sweep rescheduled');
  })().catch((err) => logger.error({ err }, 'Failed to reschedule token sweep'));
});

onShutdown(async () => {
  await Promise.all([tokenWorker.close(), restoreWorker.close()]);
  await Promise.all([tokenCheckQueue.close(), restoreQueue.close()]);
});

logger.info('Worker started');
