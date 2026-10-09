import type { ActorType, AuditEventType, Prisma } from '@prisma/client';
import { CHANNELS, publish } from '../lib/events.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

export interface Actor {
  type: ActorType;
  id?: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: 'SYSTEM' };
export const adminActor = (discordId: string): Actor => ({ type: 'ADMIN', id: discordId });

export interface AuditEntry {
  type: AuditEventType;
  message: string;
  actor?: Actor;
  memberId?: string | null;
  targetDiscordId?: string | null;
  guildId?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Never throws: an audit failure must not abort the action being audited. */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const row = await prisma.auditLog.create({
      data: {
        type: entry.type,
        message: entry.message,
        actorType: entry.actor?.type ?? 'SYSTEM',
        actorId: entry.actor?.id ?? null,
        memberId: entry.memberId ?? null,
        targetDiscordId: entry.targetDiscordId ?? null,
        guildId: entry.guildId ?? null,
        metadata: entry.metadata,
      },
    });
    await publish(CHANNELS.audit, row);
  } catch (err) {
    logger.error({ err, entry: { type: entry.type, message: entry.message } }, 'Failed to write audit log');
  }
}
