import { Queue } from 'bullmq';
import { createRedis } from '../lib/redis.js';

export const QUEUE_NAMES = {
  tokenCheck: 'dv-token-check',
  restore: 'dv-guild-restore',
} as const;

export type TokenCheckJob =
  | { kind: 'sweep'; trigger: 'schedule' | 'manual' }
  | { kind: 'check'; memberId: string; sweepId: string };

export type RestoreJobData = { kind: 'plan'; restoreJobId: string } | { kind: 'member'; restoreJobId: string; memberId: string };

export const SWEEP_SCHEDULER_ID = 'token-sweep';
export const LAST_SWEEP_KEY = 'dv:sweep:last';

export const bullConnection = createRedis('bullmq', { bullmq: true });

export const tokenCheckQueue = new Queue<TokenCheckJob>(QUEUE_NAMES.tokenCheck, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { age: 24 * 3600, count: 2_000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 10_000 },
  },
});

export const restoreQueue = new Queue<RestoreJobData>(QUEUE_NAMES.restore, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 6,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 24 * 3600, count: 5_000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 10_000 },
  },
});

export async function scheduleTokenSweep(intervalMinutes: number): Promise<void> {
  await tokenCheckQueue.upsertJobScheduler(
    SWEEP_SCHEDULER_ID,
    { every: intervalMinutes * 60_000 },
    { name: 'sweep', data: { kind: 'sweep', trigger: 'schedule' }, opts: { attempts: 1 } },
  );
}

export async function triggerTokenSweep(): Promise<void> {
  await tokenCheckQueue.add(
    'sweep',
    { kind: 'sweep', trigger: 'manual' },
    { attempts: 1, deduplication: { id: 'manual-sweep' } },
  );
}

export async function enqueueRestorePlan(restoreJobId: string): Promise<void> {
  await restoreQueue.add('plan', { kind: 'plan', restoreJobId }, { attempts: 3, jobId: `plan-${restoreJobId}` });
}
