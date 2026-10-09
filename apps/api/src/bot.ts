process.env.DV_SERVICE ??= 'bot';

const { logger } = await import('./lib/logger.js');
const { CHANNELS, subscribe } = await import('./lib/events.js');
const { getSettings, initSettingsSync } = await import('./lib/settings.js');
const { onShutdown } = await import('./lib/shutdown.js');
const { startBot } = await import('./bot/client.js');

initSettingsSync();

let stop: (() => Promise<void>) | null = null;
let activeToken: string | null = null;

async function restartIfTokenChanged(): Promise<void> {
  const { botToken } = await getSettings();
  if (botToken === activeToken) return;
  await stop?.();
  stop = null;
  activeToken = botToken;
  if (!botToken) {
    logger.warn('No bot token configured; gateway client idle until one is saved in Settings');
    return;
  }
  stop = await startBot(botToken).catch((err) => {
    logger.error({ err }, 'Bot login failed (check the token and that the Server Members intent is enabled)');
    return null;
  });
}

await restartIfTokenChanged();

subscribe<{ keys: string[] }>(CHANNELS.configUpdated, ({ keys }) => {
  if (!keys.includes('botToken')) return;
  setTimeout(() => void restartIfTokenChanged().catch((err) => logger.error({ err }, 'Bot restart failed')), 250);
});

onShutdown(async () => {
  await stop?.();
});
