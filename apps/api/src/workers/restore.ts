import type { RestoreJob } from '@prisma/client';
import { Worker, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { addRole, putGuildMember } from '../discord/guild.js';
import { OAuthConfigError } from '../discord/oauth.js';
import { DiscordApiError, DiscordErrorCode, DiscordRateLimitError, isTransientDiscordError } from '../discord/rest.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { getSettings } from '../lib/settings.js';
import { bullConnection, QUEUE_NAMES, restoreQueue, type RestoreJobData } from '../queues/index.js';
import { audit } from '../services/audit.js';
import { revokeMember } from '../services/members.js';
import { getValidAccessToken, TokenRevokedError } from '../services/tokens.js';

const PAGE_SIZE = 500;
type Outcome = 'added' | 'alreadyMember' | 'skipped' | 'failed';

class FatalRestoreError extends Error {}

async function planRestore(restoreJobId: string): Promise<void> {
  const restore = await prisma.restoreJob.findUnique({ where: { id: restoreJobId } });
  if (!restore || restore.status !== 'PENDING') return;

  const where = { status: 'ACTIVE' as const, refreshTokenEnc: { not: null } };
  const total = await prisma.member.count({ where });
  await prisma.restoreJob.update({
    where: { id: restoreJobId },
    data: { status: total === 0 ? 'COMPLETED' : 'RUNNING', total, startedAt: new Date(), ...(total === 0 ? { finishedAt: new Date() } : {}) },
  });
  if (total === 0) return;

  let cursor: string | undefined;
  let queued = 0;
  for (;;) {
    const batch = await prisma.member.findMany({
      where,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    await restoreQueue.addBulk(
      batch.map((member) => ({
        name: 'member',
        data: { kind: 'member' as const, restoreJobId, memberId: member.id },
        opts: { jobId: `restore-${restoreJobId}-${member.id}` },
      })),
    );
    queued += batch.length;
    cursor = batch.at(-1)!.id;
  }

  // Members who verified or revoked while planning would otherwise leave the job unfinishable.
  if (queued !== total) {
    await prisma.restoreJob.update({ where: { id: restoreJobId }, data: { total: queued } });
  }
}

async function recordOutcome(restoreJobId: string, outcome: Outcome): Promise<void> {
  const job = await prisma.restoreJob.update({ where: { id: restoreJobId }, data: { [outcome]: { increment: 1 } } });
  const processed = job.added + job.alreadyMember + job.skipped + job.failed;
  if (processed < job.total) return;

  const { count } = await prisma.restoreJob.updateMany({
    where: { id: restoreJobId, status: 'RUNNING' },
    data: { status: 'COMPLETED', finishedAt: new Date() },
  });
  if (count > 0) {
    await audit({
      type: 'RESTORE_COMPLETED',
      guildId: job.guildId,
      message: `Restore into ${job.guildId} finished: ${job.added} added, ${job.alreadyMember} already present, ${job.skipped} skipped, ${job.failed} failed`,
      metadata: { restoreJobId, added: job.added, alreadyMember: job.alreadyMember, skipped: job.skipped, failed: job.failed },
    });
  }
}

async function failRestore(restore: RestoreJob, message: string): Promise<void> {
  const { count } = await prisma.restoreJob.updateMany({
    where: { id: restore.id, status: 'RUNNING' },
    data: { status: 'FAILED', error: message, finishedAt: new Date() },
  });
  if (count > 0) {
    await audit({ type: 'RESTORE_FAILED', guildId: restore.guildId, message: `Restore into ${restore.guildId} aborted: ${message}`, metadata: { restoreJobId: restore.id } });
  }
}

async function restoreMember(restore: RestoreJob, memberId: string): Promise<Outcome> {
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member || member.status !== 'ACTIVE') return 'skipped';

  const settings = await getSettings();
  if (!settings.botToken) throw new FatalRestoreError('Bot token is no longer configured');

  let outcome: Outcome | null = null;
  for (let attempt = 0; attempt < 2 && !outcome; attempt++) {
    let accessToken: string;
    try {
      accessToken = await getValidAccessToken(member, { forceRefresh: attempt > 0 });
    } catch (err) {
      if (err instanceof TokenRevokedError) {
        await revokeMember(member, err.reason);
        return 'skipped';
      }
      if (err instanceof OAuthConfigError) throw new FatalRestoreError(`OAuth client rejected by Discord: ${err.error}`);
      throw err;
    }

    try {
      const result = await putGuildMember({
        botToken: settings.botToken,
        guildId: restore.guildId,
        userId: member.discordId,
        accessToken,
        roleIds: restore.roleIds,
      });
      outcome = result === 'added' ? 'added' : 'alreadyMember';
    } catch (err) {
      if (!(err instanceof DiscordApiError)) throw err;
      if (err.status === 401 || err.code === DiscordErrorCode.InvalidOAuthToken) {
        if (attempt === 0) continue;
        await revokeMember(member, 'access_token_unauthorized');
        return 'skipped';
      }
      if (err.code === DiscordErrorCode.MaxGuilds || err.code === DiscordErrorCode.UserBanned) return 'skipped';
      if (
        err.code === DiscordErrorCode.MissingPermissions ||
        err.code === DiscordErrorCode.MissingAccess ||
        err.code === DiscordErrorCode.UnknownGuild
      ) {
        throw new FatalRestoreError(
          'The bot lacks access to the target guild (requires membership, Create Invite and Manage Roles for role assignment)',
        );
      }
      throw err;
    }
  }
  if (!outcome) return 'failed';

  // Discord ignores `roles` for users who are already members, so apply them explicitly.
  if (outcome === 'alreadyMember') {
    for (const roleId of restore.roleIds) {
      const result = await addRole(settings.botToken, restore.guildId, member.discordId, roleId, 'Member restore');
      if (!result.ok) logger.warn({ reason: result.reason, roleId }, 'Could not apply restore role to existing member');
    }
  }

  await prisma.member.update({
    where: { id: member.id },
    data: {
      lastJoinedGuildId: restore.guildId,
      lastJoinedAt: new Date(),
      ...(restore.guildId === settings.targetGuildId ? { inTargetGuild: true } : {}),
    },
  });
  return outcome;
}

export function createRestoreWorker(): Worker<RestoreJobData> {
  const worker: Worker<RestoreJobData> = new Worker<RestoreJobData>(
    QUEUE_NAMES.restore,
    async (job: Job<RestoreJobData>) => {
      if (job.data.kind === 'plan') return planRestore(job.data.restoreJobId);

      const { restoreJobId, memberId } = job.data;
      const restore = await prisma.restoreJob.findUnique({ where: { id: restoreJobId } });
      if (!restore || restore.status !== 'RUNNING') return;

      try {
        await recordOutcome(restoreJobId, await restoreMember(restore, memberId));
      } catch (err) {
        if (err instanceof DiscordRateLimitError) {
          // Pauses the whole queue (all workers) and requeues this job without consuming an attempt.
          await worker.rateLimit(err.retryAfterMs);
          throw Worker.RateLimitError();
        }
        if (err instanceof FatalRestoreError) {
          await failRestore(restore, err.message);
          return;
        }
        const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        const permanent = err instanceof DiscordApiError && !isTransientDiscordError(err);
        if (finalAttempt || permanent) {
          logger.warn({ err, restoreJobId, memberId }, 'Restore of member failed permanently');
          await recordOutcome(restoreJobId, 'failed');
          return;
        }
        throw err;
      }
    },
    {
      connection: bullConnection,
      concurrency: env.RESTORE_CONCURRENCY,
      limiter: { max: env.RESTORE_RATE_MAX, duration: env.RESTORE_RATE_DURATION_MS },
    },
  );

  worker.on('failed', (job, err) => logger.warn({ err, jobId: job?.id }, 'Restore job attempt failed'));
  return worker;
}
