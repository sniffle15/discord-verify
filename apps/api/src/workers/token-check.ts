import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { OAuthConfigError } from '../discord/oauth.js';
import { DiscordRateLimitError } from '../discord/rest.js';
import { DecryptionError } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { ConfigurationError } from '../lib/settings.js';
import { bullConnection, LAST_SWEEP_KEY, QUEUE_NAMES, tokenCheckQueue, type TokenCheckJob } from '../queues/index.js';
import { audit } from '../services/audit.js';
import { checkMemberAuthorization } from '../services/members.js';

const PAGE_SIZE = 500;
/** Members checked this recently (e.g. manually) are skipped by the sweep. */
const RECENT_CHECK_MS = 5 * 60_000;

async function alertOnce(key: string, message: string): Promise<void> {
  if ((await redis.set(`dv:alert:${key}`, '1', 'EX', 3600, 'NX')) === 'OK') {
    await audit({ type: 'SYSTEM_ALERT', message });
  }
}

async function runSweep(job: Job<TokenCheckJob>): Promise<{ queued: number }> {
  const sweepId = String(job.timestamp);
  const recentCutoff = new Date(Date.now() - RECENT_CHECK_MS);
  let cursor: string | undefined;
  let queued = 0;

  for (;;) {
    const batch = await prisma.member.findMany({
      where: {
        status: 'ACTIVE',
        refreshTokenEnc: { not: null },
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: recentCutoff } }],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;

    await tokenCheckQueue.addBulk(
      batch.map((member) => ({
        name: 'check',
        data: { kind: 'check' as const, memberId: member.id, sweepId },
        // Overlapping sweeps never queue the same member twice.
        opts: { deduplication: { id: `check-${member.id}` } },
      })),
    );
    queued += batch.length;
    cursor = batch.at(-1)!.id;
    await job.updateProgress({ queued });
  }

  await redis.set(
    LAST_SWEEP_KEY,
    JSON.stringify({ at: new Date().toISOString(), queued, trigger: job.data.kind === 'sweep' ? job.data.trigger : 'schedule' }),
  );
  logger.info({ queued, sweepId }, 'Token sweep queued member checks');
  return { queued };
}

export function createTokenCheckWorker(): Worker<TokenCheckJob> {
  const worker: Worker<TokenCheckJob> = new Worker<TokenCheckJob>(
    QUEUE_NAMES.tokenCheck,
    async (job) => {
      if (job.data.kind === 'sweep') return runSweep(job);

      try {
        return await checkMemberAuthorization(job.data.memberId);
      } catch (err) {
        if (err instanceof DiscordRateLimitError) {
          await worker.rateLimit(err.retryAfterMs);
          throw Worker.RateLimitError();
        }
        if (err instanceof OAuthConfigError || err instanceof ConfigurationError) {
          await alertOnce(
            'oauth-config',
            `Token checks paused for affected members: Discord rejected the OAuth client configuration (${err.message}). No members were revoked.`,
          );
          throw new UnrecoverableError(err.message);
        }
        if (err instanceof DecryptionError) {
          await alertOnce('decryption', `Stored tokens could not be decrypted (${err.message}). Check ENCRYPTION_KEY / ENCRYPTION_KEYS_PREVIOUS.`);
          throw new UnrecoverableError(err.message);
        }
        throw err;
      }
    },
    {
      connection: bullConnection,
      concurrency: env.TOKEN_CHECK_CONCURRENCY,
      limiter: { max: env.TOKEN_CHECK_MAX_PER_SECOND, duration: 1000 },
    },
  );

  worker.on('failed', (job, err) => {
    logger.warn({ err, jobId: job?.id, attempts: job?.attemptsMade }, 'Token check job failed');
  });
  return worker;
}
