import { AuditEventType, type Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CHANNELS, subscribe } from '../../../lib/events.js';
import { prisma } from '../../../lib/prisma.js';

const listQuery = z.object({
  cursor: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  type: z.nativeEnum(AuditEventType).optional(),
  memberId: z.string().max(40).optional(),
});

const HEARTBEAT_MS = 25_000;

export async function auditRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const { cursor, limit, type, memberId } = listQuery.parse(request.query);
    const where: Prisma.AuditLogWhereInput = { ...(type ? { type } : {}), ...(memberId ? { memberId } : {}) };
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null };
  });

  /** Server-Sent Events feed of new audit entries, fanned out from Redis pub/sub. */
  app.get('/stream', async (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    const unsubscribe = subscribe(CHANNELS.audit, (entry: { id: string }) => {
      res.write(`id: ${entry.id}\nevent: audit\ndata: ${JSON.stringify(entry)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
