import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { redis } from '../../../lib/redis.js';
import { LAST_SWEEP_KEY, restoreQueue, tokenCheckQueue } from '../../../queues/index.js';
import { memberPublicSelect } from '../../../services/members.js';

export async function statsRoutes(app: FastifyInstance) {
  app.get('/stats', async () => {
    const since24h = new Date(Date.now() - 24 * 3600_000);
    const [total, active, revoked, inGuild, activeTokens, verified24h, revoked24h, recent, daily, lastSweep, tokenQueue, restore] =
      await Promise.all([
        prisma.member.count(),
        prisma.member.count({ where: { status: 'ACTIVE' } }),
        prisma.member.count({ where: { status: 'REVOKED' } }),
        prisma.member.count({ where: { inTargetGuild: true } }),
        prisma.member.count({ where: { status: 'ACTIVE', refreshTokenEnc: { not: null } } }),
        prisma.member.count({ where: { lastVerifiedAt: { gte: since24h } } }),
        prisma.member.count({ where: { revokedAt: { gte: since24h } } }),
        prisma.member.findMany({ select: memberPublicSelect, orderBy: { lastVerifiedAt: 'desc' }, take: 8 }),
        prisma.$queryRaw<{ day: Date; verified: bigint; revoked: bigint }[]>`
          SELECT d.day,
                 COUNT(m.id) FILTER (WHERE date_trunc('day', m.verified_at) = d.day) AS verified,
                 COUNT(m.id) FILTER (WHERE date_trunc('day', m.revoked_at) = d.day) AS revoked
          FROM generate_series(date_trunc('day', NOW()) - INTERVAL '13 days', date_trunc('day', NOW()), INTERVAL '1 day') AS d(day)
          LEFT JOIN members m
            ON date_trunc('day', m.verified_at) = d.day OR date_trunc('day', m.revoked_at) = d.day
          GROUP BY d.day
          ORDER BY d.day`,
        redis.get(LAST_SWEEP_KEY),
        tokenCheckQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
        restoreQueue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
      ]);

    return {
      totals: { total, active, revoked, inGuild, activeTokens, verified24h, revoked24h },
      recent,
      daily: daily.map((row) => ({ day: row.day, verified: Number(row.verified), revoked: Number(row.revoked) })),
      lastSweep: lastSweep ? JSON.parse(lastSweep) : null,
      queues: { tokenCheck: tokenQueue, restore },
    };
  });
}
