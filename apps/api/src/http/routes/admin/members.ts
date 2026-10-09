import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { adminActor } from '../../../services/audit.js';
import {
  checkMemberAuthorization,
  deleteMemberData,
  memberPublicSelect,
  syncMemberRole,
} from '../../../services/members.js';

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'REVOKED', 'IN_GUILD']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['verifiedAt', 'lastVerifiedAt', 'lastCheckedAt', 'username']).default('lastVerifiedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const idParams = z.object({ id: z.string().min(1).max(40) });
const deleteQuery = z.object({ removeRole: z.enum(['true', 'false']).default('true') });

export async function memberRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const { search, status, page, pageSize, sort, order } = listQuery.parse(request.query);

    const where: Prisma.MemberWhereInput = {
      ...(status === 'IN_GUILD' ? { inTargetGuild: true } : status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { discordId: { startsWith: search } },
              { username: { contains: search, mode: 'insensitive' } },
              { globalName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.member.findMany({
        where,
        select: memberPublicSelect,
        orderBy: { [sort]: order },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.member.count({ where }),
    ]);
    return { items, total, page, pageSize };
  });

  app.get('/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const member = await prisma.member.findUnique({ where: { id }, select: memberPublicSelect });
    if (!member) return reply.code(404).send({ error: 'not_found' });
    const events = await prisma.auditLog.findMany({ where: { memberId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { member, events };
  });

  app.post('/:id/check', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    try {
      const result = await checkMemberAuthorization(id, adminActor(request.admin!.discordId));
      const member = await prisma.member.findUnique({ where: { id }, select: memberPublicSelect });
      return { result, member };
    } catch (err) {
      request.log.warn({ err, id }, 'Manual status check failed');
      return reply.code(502).send({ error: 'check_failed', message: 'Discord could not be reached. Try again shortly.' });
    }
  });

  app.post('/:id/resync-role', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    if (!(await prisma.member.findUnique({ where: { id }, select: { id: true } }))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const result = await syncMemberRole(id, adminActor(request.admin!.discordId));
    const member = await prisma.member.findUnique({ where: { id }, select: memberPublicSelect });
    return { result, member };
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const { removeRole } = deleteQuery.parse(request.query);
    if (!(await prisma.member.findUnique({ where: { id }, select: { id: true } }))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    await deleteMemberData(id, adminActor(request.admin!.discordId), { removeRole: removeRole === 'true' });
    return { ok: true };
  });
}
