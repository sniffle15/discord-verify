import { Prisma, type Member } from '@prisma/client';
import { addGuildMember, addRole, removeRole, type GuildActionResult } from '../discord/guild.js';
import { getCurrentUser, revokeToken, type DiscordUser } from '../discord/oauth.js';
import { DiscordApiError } from '../discord/rest.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { getSettings, requireOAuthCredentials } from '../lib/settings.js';
import { audit, SYSTEM_ACTOR, type Actor } from './audit.js';
import { decryptRefreshToken, getValidAccessToken, TokenRevokedError } from './tokens.js';

/** Everything the dashboard may see about a member. Token columns are deliberately absent. */
export const memberPublicSelect = {
  id: true,
  discordId: true,
  username: true,
  globalName: true,
  avatar: true,
  status: true,
  scopes: true,
  inTargetGuild: true,
  roleAssigned: true,
  lastJoinedGuildId: true,
  lastJoinedAt: true,
  verifiedAt: true,
  lastVerifiedAt: true,
  lastCheckedAt: true,
  checkFailures: true,
  revokedAt: true,
  revokeReason: true,
  tokenExpiresAt: true,
} satisfies Prisma.MemberSelect;

export type PublicMember = Prisma.MemberGetPayload<{ select: typeof memberPublicSelect }>;

export type CheckResult =
  | { status: 'active'; user: Pick<DiscordUser, 'id' | 'username'> }
  | { status: 'revoked'; reason: string }
  | { status: 'skipped'; reason: string };

const isUnauthorized = (err: unknown) => err instanceof DiscordApiError && err.status === 401;

/**
 * Deauthorization probe. A user who removes the app under Settings > Authorized Apps invalidates
 * both tokens, so `/users/@me` returns 401 and the refresh grant fails with `invalid_grant`.
 * Network errors, 5xx and our own credential problems are rethrown and never cause a revocation.
 */
export async function checkMemberAuthorization(memberId: string, actor: Actor = SYSTEM_ACTOR): Promise<CheckResult> {
  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return { status: 'skipped', reason: 'not_found' };
  if (member.status !== 'ACTIVE') return { status: 'skipped', reason: 'not_active' };

  try {
    let user: DiscordUser;
    try {
      user = await getCurrentUser(await getValidAccessToken(member));
    } catch (err) {
      if (!isUnauthorized(err)) throw err;
      user = await getCurrentUser(await getValidAccessToken(member, { forceRefresh: true }));
    }

    await prisma.member.update({
      where: { id: member.id },
      data: {
        username: user.username,
        globalName: user.global_name,
        avatar: user.avatar,
        lastCheckedAt: new Date(),
        checkFailures: 0,
      },
    });
    if (actor.type === 'ADMIN') {
      await audit({
        type: 'MEMBER_CHECKED',
        actor,
        memberId: member.id,
        targetDiscordId: member.discordId,
        message: `Manual check: ${user.username} still authorized`,
      });
    }
    return { status: 'active', user: { id: user.id, username: user.username } };
  } catch (err) {
    if (err instanceof TokenRevokedError || isUnauthorized(err)) {
      const reason = err instanceof TokenRevokedError ? err.reason : 'access_token_unauthorized';
      await revokeMember(member, reason, actor);
      return { status: 'revoked', reason };
    }
    await prisma.member
      .update({ where: { id: member.id }, data: { checkFailures: { increment: 1 }, lastCheckedAt: new Date() } })
      .catch(() => undefined);
    throw err;
  }
}

export async function revokeMember(member: Member, reason: string, actor: Actor = SYSTEM_ACTOR): Promise<void> {
  const { count } = await prisma.member.updateMany({
    where: { id: member.id, status: 'ACTIVE' },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokeReason: reason,
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
    },
  });
  if (count === 0) return;

  await audit({
    type: 'MEMBER_DEAUTHORIZED',
    actor,
    memberId: member.id,
    targetDiscordId: member.discordId,
    message: `${member.username} deauthorized the application (${reason})`,
    metadata: { reason },
  });

  await removeVerifiedRole(member, actor, 'Deauthorized OAuth application');
}

export async function removeVerifiedRole(member: Member, actor: Actor, reason: string): Promise<GuildActionResult> {
  const settings = await getSettings();
  if (!settings.botToken || !settings.targetGuildId || !settings.verifiedRoleId) {
    return { ok: false, reason: 'not_configured', message: 'Bot token, guild or role not configured' };
  }

  const result = await removeRole(settings.botToken, settings.targetGuildId, member.discordId, settings.verifiedRoleId, reason);
  if (result.ok || result.reason === 'not_in_guild') {
    await prisma.member.update({
      where: { id: member.id },
      data: { roleAssigned: false, ...(result.ok ? {} : { inTargetGuild: false }) },
    });
  }

  await audit({
    type: result.ok || result.reason === 'not_in_guild' ? 'ROLE_REVOKED' : 'ROLE_REVOKE_FAILED',
    actor,
    memberId: member.id,
    targetDiscordId: member.discordId,
    guildId: settings.targetGuildId,
    message: result.ok
      ? `Removed verified role from ${member.username}`
      : result.reason === 'not_in_guild'
        ? `${member.username} is no longer in the guild; nothing to remove`
        : `Could not remove verified role from ${member.username}: ${result.message}`,
    metadata: result.ok ? { reason } : { reason, failure: result.reason },
  });
  return result;
}

/**
 * Gives the member the verified role. With an access token and auto-join enabled, a user who is not
 * yet in the guild is added through `guilds.join` with the role attached in a single call.
 */
export async function assignVerifiedRole(
  member: Member,
  actor: Actor,
  { accessToken }: { accessToken?: string } = {},
): Promise<GuildActionResult> {
  const settings = await getSettings();
  if (!settings.botToken || !settings.targetGuildId || !settings.verifiedRoleId) {
    const result = { ok: false, reason: 'not_configured', message: 'Bot token, guild or role not configured' } as const;
    await audit({
      type: 'ROLE_ASSIGN_FAILED',
      actor,
      memberId: member.id,
      targetDiscordId: member.discordId,
      message: `Cannot assign role to ${member.username}: ${result.message}`,
    });
    return result;
  }
  const { botToken, targetGuildId: guildId, verifiedRoleId: roleId } = settings;
  const reason = `Verified via OAuth (${member.username})`;

  let result: GuildActionResult;
  let joined = false;
  if (accessToken && settings.autoJoinOnVerify) {
    const join = await addGuildMember({ botToken, guildId, userId: member.discordId, accessToken, roleIds: [roleId] });
    if (join.ok && join.value === 'added') {
      joined = true;
      result = { ok: true, value: undefined };
    } else {
      result = await addRole(botToken, guildId, member.discordId, roleId, reason);
    }
  } else {
    result = await addRole(botToken, guildId, member.discordId, roleId, reason);
  }

  await prisma.member.update({
    where: { id: member.id },
    data: result.ok
      ? { roleAssigned: true, inTargetGuild: true, ...(joined ? { lastJoinedGuildId: guildId, lastJoinedAt: new Date() } : {}) }
      : { roleAssigned: false, ...(result.reason === 'not_in_guild' ? { inTargetGuild: false } : {}) },
  });

  await audit({
    type: result.ok ? 'ROLE_ASSIGNED' : 'ROLE_ASSIGN_FAILED',
    actor,
    memberId: member.id,
    targetDiscordId: member.discordId,
    guildId,
    message: result.ok
      ? `Assigned verified role to ${member.username}${joined ? ' (added to guild)' : ''}`
      : `Could not assign verified role to ${member.username}: ${result.message}`,
    metadata: result.ok ? { joined } : { failure: result.reason },
  });
  return result;
}

/** Makes Discord match the database: active members get the role, revoked members lose it. */
export async function syncMemberRole(memberId: string, actor: Actor): Promise<GuildActionResult> {
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  if (member.status === 'REVOKED') return removeVerifiedRole(member, actor, 'Manual role re-sync');

  let accessToken: string | undefined;
  try {
    accessToken = await getValidAccessToken(member);
  } catch (err) {
    if (err instanceof TokenRevokedError) {
      await revokeMember(member, err.reason, actor);
      return { ok: false, reason: 'invalid_token', message: 'Member has revoked authorization' };
    }
    logger.warn({ err, memberId }, 'Could not obtain access token for re-sync, assigning role only');
  }
  return assignVerifiedRole(member, actor, { accessToken });
}

/** GDPR-style erasure: revoke our grant at Discord, drop the role, delete the row, scrub audit references. */
export async function deleteMemberData(memberId: string, actor: Actor, { removeRole: shouldRemoveRole = true } = {}) {
  const member = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
  const settings = await getSettings();

  if (member.refreshTokenEnc && settings.clientId && settings.clientSecret) {
    try {
      const refreshToken = decryptRefreshToken(member);
      if (refreshToken) await revokeToken(requireOAuthCredentials(settings), refreshToken);
    } catch (err) {
      logger.warn({ err, memberId }, 'Failed to revoke OAuth grant during deletion');
    }
  }

  if (shouldRemoveRole && member.roleAssigned) {
    await removeVerifiedRole(member, actor, 'Member data deleted');
  }

  await prisma.$transaction([
    prisma.auditLog.updateMany({
      where: { memberId: member.id },
      data: { targetDiscordId: null, metadata: Prisma.DbNull, message: '[redacted: member data deleted]' },
    }),
    prisma.member.delete({ where: { id: member.id } }),
  ]);

  await audit({
    type: 'MEMBER_DATA_DELETED',
    actor,
    targetDiscordId: member.discordId,
    message: `Deleted all stored data for member ${member.discordId}`,
  });
}
