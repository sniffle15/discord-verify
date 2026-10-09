process.env.DV_SERVICE ??= 'api';

const { env } = await import('./config/env.js');
const { buildApp } = await import('./http/app.js');
const { initSettingsSync } = await import('./lib/settings.js');
const { onShutdown } = await import('./lib/shutdown.js');

initSettingsSync();
const app = await buildApp();
onShutdown(() => app.close());

await app.listen({ host: env.HOST, port: env.PORT });
