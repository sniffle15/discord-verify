import type { FastifyInstance } from 'fastify';
import { redis } from '../../../lib/redis.js';
import { LAST_SWEEP_KEY, SWEEP_SCHEDULER_ID, tokenCheckQueue, triggerTokenSweep } from '../../../queues/index.js';

export async function syncRoutes(app: FastifyInstance) {
  app.get('/status', async () => {
    const [scheduler, lastSweep, counts] = await Promise.all([
      tokenCheckQueue.getJobScheduler(SWEEP_SCHEDULER_ID),
      redis.get(LAST_SWEEP_KEY),
      tokenCheckQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
    ]);
    return {
      nextRunAt: scheduler?.next ? new Date(scheduler.next).toISOString() : null,
      intervalMs: scheduler?.every ?? null,
      lastSweep: lastSweep ? JSON.parse(lastSweep) : null,
      counts,
    };
  });

  app.post('/run', async (_request, reply) => {
    await triggerTokenSweep();
    return reply.code(202).send({ ok: true });
  });
}
