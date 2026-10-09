import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../session.js';
import { auditRoutes } from './audit.js';
import { memberRoutes } from './members.js';
import { restoreRoutes } from './restore.js';
import { settingsRoutes } from './settings.js';
import { statsRoutes } from './stats.js';
import { syncRoutes } from './sync.js';

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.rateLimit({ max: 300, timeWindow: 60_000 }));
  app.addHook('preHandler', requireAdmin);

  app.get('/me', async (request) => {
    const { discordId, username, avatar, csrfToken } = request.admin!;
    return { discordId, username, avatar, csrfToken };
  });

  await app.register(statsRoutes);
  await app.register(memberRoutes, { prefix: '/members' });
  await app.register(settingsRoutes, { prefix: '/settings' });
  await app.register(auditRoutes, { prefix: '/audit' });
  await app.register(restoreRoutes, { prefix: '/restore' });
  await app.register(syncRoutes, { prefix: '/sync' });
}
