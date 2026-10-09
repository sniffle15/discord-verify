import type { Member } from '@prisma/client';
import { sendChannelMessage, sendDirectMessage, type GuildActionResult } from '../discord/guild.js';
import { exchangeCode, getCurrentUser, VERIFY_SCOPES } from '../discord/oauth.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { getSettings, requireOAuthCredentials } from '../lib/settings.js';
import { audit } from './audit.js';
import { assignVerifiedRole } from './members.js';
import { encryptTokens } from './tokens.js';

export class VerificationError extends Error {
  constructor(readonly reason: 'missing_scopes' | 'bot_account', message: string) {
    super(message);
    this.name = 'VerificationError';
  }
}

export const verifyRedirectUri = () => `${env.PUBLIC_URL}/api/verify/callback`;

/** Users sharing a fingerprint with this many other accounts are flagged as possible alts. */
const FINGERPRINT_ALT_THRESHOLD = 1;
const IP_ALT_THRESHOLD = 3;

export interface VerificationOutcome {
  member: Member;
  role: GuildActionResult;
}

export async function completeVerification(params: {
  code: string;
  ipHash: string | null;
  fingerprintHash: string | null;
}): Promise<VerificationOutcome> {
  const settings = await getSettings();
  const tokens = await exchangeCode(requireOAuthCredentials(settings), params.code, verifyRedirectUri());

  const granted = new Set(tokens.scope.split(' '));
  const missing = VERIFY_SCOPES.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    throw new VerificationError('missing_scopes', `Missing OAuth scopes: ${missing.join(', ')}`);
  }

  const user = await getCurrentUser(tokens.access_token);
  if (user.bot) throw new VerificationError('bot_account', 'Bot accounts cannot verify');

  const previous = await prisma.member.findUnique({ where: { discordId: user.id }, select: { status: true } });
  const now = new Date();
  const profile = {
    username: user.username,
    globalName: user.global_name,
    avatar: user.avatar,
    ...encryptTokens(user.id, tokens),
    ipHash: params.ipHash,
    fingerprintHash: params.fingerprintHash,
    lastVerifiedAt: now,
    lastCheckedAt: now,
    checkFailures: 0,
  };

  const member = await prisma.member.upsert({
    where: { discordId: user.id },
    create: { discordId: user.id, ...profile, verifiedAt: now },
    update: { ...profile, status: 'ACTIVE', revokedAt: null, revokeReason: null },
  });

  await audit({
    type: 'MEMBER_VERIFIED',
    actor: { type: 'USER', id: user.id },
    memberId: member.id,
    targetDiscordId: user.id,
    message: previous
      ? `${user.username} re-verified${previous.status === 'REVOKED' ? ' after a previous revocation' : ''}`
      : `${user.username} verified`,
    metadata: { reverification: Boolean(previous), previousStatus: previous?.status ?? null },
  });

  await flagPossibleAlts(member);

  const role = await assignVerifiedRole(member, { type: 'SYSTEM' }, { accessToken: tokens.access_token });
  if (role.ok) await sendConfirmations(member).catch((err) => logger.warn({ err }, 'Confirmation message failed'));

  return { member, role };
}

async function flagPossibleAlts(member: Member): Promise<void> {
  const [sameFingerprint, sameIp] = await Promise.all([
    member.fingerprintHash
      ? prisma.member.count({ where: { fingerprintHash: member.fingerprintHash, id: { not: member.id } } })
      : 0,
    member.ipHash ? prisma.member.count({ where: { ipHash: member.ipHash, id: { not: member.id } } }) : 0,
  ]);

  if (sameFingerprint >= FINGERPRINT_ALT_THRESHOLD || sameIp >= IP_ALT_THRESHOLD) {
    await audit({
      type: 'SUSPICIOUS_ACTIVITY',
      memberId: member.id,
      targetDiscordId: member.discordId,
      message: `${member.username} shares a device fingerprint with ${sameFingerprint} and an IP with ${sameIp} other verified account(s)`,
      metadata: { sameFingerprint, sameIp },
    });
  }
}

async function sendConfirmations(member: Member): Promise<void> {
  const settings = await getSettings();
  if (!settings.botToken) return;
  const timestamp = new Date().toISOString();

  if (settings.dmConfirmation) {
    const dm = await sendDirectMessage(settings.botToken, member.discordId, {
      embeds: [
        {
          title: 'Verification complete',
          description: 'You are now verified and have been given access to the server.',
          color: 0x22c55e,
          footer: { text: 'You can revoke access at any time in Discord > Settings > Authorized Apps.' },
          timestamp,
        },
      ],
    });
    if (!dm.ok) logger.info({ reason: dm.reason, discordId: member.discordId }, 'Could not DM verification confirmation');
  }

  if (settings.logChannelId) {
    await sendChannelMessage(settings.botToken, settings.logChannelId, {
      embeds: [
        {
          title: 'Member verified',
          description: `<@${member.discordId}> (${member.username}) completed verification.`,
          color: 0x5865f2,
          timestamp,
        },
      ],
    });
  }
}
