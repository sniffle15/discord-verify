import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { diagnoseGuild } from '../../../discord/guild.js';
import { prisma } from '../../../lib/prisma.js';
import { getSettings } from '../../../lib/settings.js';
import { enqueueRestorePlan } from '../../../queues/index.js';
import { adminActor, audit } from '../../../services/audit.js';

const snowflake = z.string().regex(/^\d{17,20}$/, 'Must be a Discord ID');
const createBody = z.object({
  guildId: snowflake,
  roleIds: z.array(snowflake).max(10).default([]),
});
const idParams = z.object({ id: z.string().min(1).max(40) });

export async function restoreRoutes(app: FastifyInstance) {
  app.get('/', async () =>
    prisma.restoreJob.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
  );

  app.get('/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const job = await prisma.restoreJob.findUnique({ where: { id } });
    return job ?? reply.code(404).send({ error: 'not_found' });
  });

  app.post('/', async (request, reply) => {
    const { guildId, roleIds } = createBody.parse(request.body);
    const admin = request.admin!;
    const settings = await getSettings();
    if (!settings.botToken) return reply.code(400).send({ error: 'not_configured', message: 'No bot token configured.' });

    const running = await prisma.restoreJob.findFirst({ where: { guildId, status: { in: ['PENDING', 'RUNNING'] } } });
    if (running) return reply.code(409).send({ error: 'restore_in_progress', message: 'A restore for this guild is already running.', job: running });

    const diagnostics = await diagnoseGuild(settings.botToken, guildId, roleIds);
    const blocking = diagnostics.checks.filter(
      (check) => !check.ok && (check.id !== 'manage_roles' || roleIds.length > 0),
    );
    if (blocking.length > 0) {
      return reply.code(400).send({ error: 'preflight_failed', message: 'The bot cannot restore members into this guild.', diagnostics });
    }

    const job = await prisma.restoreJob.create({ data: { guildId, roleIds, createdBy: admin.discordId } });
    await enqueueRestorePlan(job.id);
    await audit({
      type: 'RESTORE_STARTED',
      actor: adminActor(admin.discordId),
      guildId,
      message: `${admin.username} started a member restore into ${diagnostics.guild?.name ?? guildId}`,
      metadata: { restoreJobId: job.id, roleIds },
    });
    return reply.code(201).send(job);
  });

  app.post('/:id/cancel', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const admin = request.admin!;
    const { count } = await prisma.restoreJob.updateMany({
      where: { id, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    if (count === 0) return reply.code(409).send({ error: 'not_cancellable' });
    const job = await prisma.restoreJob.findUniqueOrThrow({ where: { id } });
    await audit({
      type: 'RESTORE_CANCELLED',
      actor: adminActor(admin.discordId),
      guildId: job.guildId,
      message: `${admin.username} cancelled restore ${id}`,
      metadata: { restoreJobId: id },
    });
    return job;
  });
}
