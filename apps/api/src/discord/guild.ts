import {
  DiscordApiError,
  DiscordErrorCode,
  DiscordNetworkError,
  DiscordRateLimitError,
  discordRest,
  type DiscordAuth,
} from './rest.js';

export type GuildActionFailure =
  | 'not_configured'
  | 'missing_permissions'
  | 'unknown_guild'
  | 'unknown_role'
  | 'not_in_guild'
  | 'max_guilds'
  | 'banned'
  | 'invalid_token'
  | 'rate_limited'
  | 'discord_unavailable'
  | 'discord_error';

export type GuildActionResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; reason: GuildActionFailure; message: string; retryAfterMs?: number };

const HINTS: Partial<Record<GuildActionFailure, string>> = {
  missing_permissions:
    'The bot is missing permissions. Ensure it has Manage Roles (and Create Invite for joins) and that its highest role is above the Verified role.',
  unknown_guild: 'The bot is not in the configured guild or the guild ID is wrong.',
  unknown_role: 'The configured role does not exist in the guild.',
  not_in_guild: 'The user is not a member of the guild.',
  max_guilds: 'The user has reached the maximum number of guilds.',
  banned: 'The user is banned from the guild.',
  invalid_token: 'The user access token is invalid.',
};

/** Maps Discord failures to a reason instead of throwing, so permission problems never crash a flow. */
export function classifyGuildError(err: unknown): Extract<GuildActionResult, { ok: false }> {
  if (err instanceof DiscordRateLimitError) {
    return { ok: false, reason: 'rate_limited', message: err.message, retryAfterMs: err.retryAfterMs };
  }
  if (err instanceof DiscordNetworkError) return { ok: false, reason: 'discord_unavailable', message: err.message };
  if (err instanceof DiscordApiError) {
    const reason = ((): GuildActionFailure => {
      switch (err.code) {
        case DiscordErrorCode.MissingPermissions:
        case DiscordErrorCode.MissingAccess:
          return 'missing_permissions';
        case DiscordErrorCode.UnknownGuild:
          return 'unknown_guild';
        case DiscordErrorCode.UnknownRole:
          return 'unknown_role';
        case DiscordErrorCode.UnknownMember:
        case DiscordErrorCode.UnknownUser:
          return 'not_in_guild';
        case DiscordErrorCode.MaxGuilds:
          return 'max_guilds';
        case DiscordErrorCode.UserBanned:
          return 'banned';
        case DiscordErrorCode.InvalidOAuthToken:
          return 'invalid_token';
      }
      if (err.status === 401) return 'invalid_token';
      if (err.status === 403) return 'missing_permissions';
      if (err.status >= 500) return 'discord_unavailable';
      return 'discord_error';
    })();
    return { ok: false, reason, message: HINTS[reason] ?? err.message };
  }
  return { ok: false, reason: 'discord_error', message: err instanceof Error ? err.message : String(err) };
}

async function attempt<T>(fn: () => Promise<T>): Promise<GuildActionResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return classifyGuildError(err);
  }
}

const bot = (token: string): DiscordAuth => ({ type: 'Bot', token });

export function addRole(botToken: string, guildId: string, userId: string, roleId: string, reason: string) {
  return attempt(() =>
    discordRest.request<undefined>({
      method: 'PUT',
      path: `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
      auth: bot(botToken),
      reason,
    }),
  );
}

export function removeRole(botToken: string, guildId: string, userId: string, roleId: string, reason: string) {
  return attempt(() =>
    discordRest.request<undefined>({
      method: 'DELETE',
      path: `/guilds/${guildId}/members/${userId}/roles/${roleId}`,
      auth: bot(botToken),
      reason,
    }),
  );
}

export type JoinOutcome = 'added' | 'already_member';

/**
 * PUT /guilds/{guild}/members/{user} using the member's `guilds.join` token.
 * Throws raw Discord errors; restore workers need them for rate-limit and retry decisions.
 */
export async function putGuildMember(params: {
  botToken: string;
  guildId: string;
  userId: string;
  accessToken: string;
  roleIds?: string[];
}): Promise<JoinOutcome> {
  const { status } = await discordRest.requestWithStatus({
    method: 'PUT',
    path: `/guilds/${params.guildId}/members/${params.userId}`,
    auth: bot(params.botToken),
    json: {
      access_token: params.accessToken,
      ...(params.roleIds?.length ? { roles: params.roleIds } : {}),
    },
    maxInlineWaitMs: 5_000,
  });
  return status === 201 ? 'added' : 'already_member';
}

export function addGuildMember(params: Parameters<typeof putGuildMember>[0]) {
  return attempt(() => putGuildMember(params));
}

export interface MessagePayload {
  content?: string;
  embeds?: Record<string, unknown>[];
  components?: Record<string, unknown>[];
}

export function sendDirectMessage(botToken: string, userId: string, payload: MessagePayload) {
  return attempt(async () => {
    const channel = await discordRest.request<{ id: string }>({
      method: 'POST',
      path: '/users/@me/channels',
      auth: bot(botToken),
      json: { recipient_id: userId },
    });
    await discordRest.request({
      method: 'POST',
      path: `/channels/${channel.id}/messages`,
      auth: bot(botToken),
      json: { ...payload, allowed_mentions: { parse: [] } },
    });
  });
}

export function sendChannelMessage(botToken: string, channelId: string, payload: MessagePayload) {
  return attempt(() =>
    discordRest.request({
      method: 'POST',
      path: `/channels/${channelId}/messages`,
      auth: bot(botToken),
      json: { ...payload, allowed_mentions: { parse: [] } },
    }),
  );
}

const PERMISSION = {
  CreateInstantInvite: 1n << 0n,
  Administrator: 1n << 3n,
  ManageRoles: 1n << 28n,
} as const;

interface ApiRole {
  id: string;
  name: string;
  position: number;
  permissions: string;
  managed: boolean;
}

export interface GuildDiagnostics {
  botUser: { id: string; username: string } | null;
  guild: { id: string; name: string } | null;
  checks: { id: string; label: string; ok: boolean; detail?: string }[];
}

/** Pre-flight check surfaced in the dashboard so hierarchy problems are caught before they bite. */
export async function diagnoseGuild(botToken: string, guildId: string, roleIds: string[]): Promise<GuildDiagnostics> {
  const result: GuildDiagnostics = { botUser: null, guild: null, checks: [] };
  const check = (id: string, label: string, ok: boolean, detail?: string) => result.checks.push({ id, label, ok, detail });

  const me = await attempt(() =>
    discordRest.request<{ id: string; username: string }>({ method: 'GET', path: '/users/@me', auth: bot(botToken) }),
  );
  if (!me.ok) {
    check('bot_token', 'Bot token is valid', false, me.message);
    return result;
  }
  result.botUser = { id: me.value.id, username: me.value.username };
  check('bot_token', 'Bot token is valid', true);

  const [guild, roles, botMember] = await Promise.all([
    attempt(() => discordRest.request<{ id: string; name: string; owner_id: string }>({ method: 'GET', path: `/guilds/${guildId}`, auth: bot(botToken) })),
    attempt(() => discordRest.request<ApiRole[]>({ method: 'GET', path: `/guilds/${guildId}/roles`, auth: bot(botToken) })),
    attempt(() => discordRest.request<{ roles: string[] }>({ method: 'GET', path: `/guilds/${guildId}/members/${me.value.id}`, auth: bot(botToken) })),
  ]);

  if (!guild.ok || !roles.ok || !botMember.ok) {
    check('bot_in_guild', 'Bot is a member of the guild', false, (!guild.ok && guild.message) || 'Bot cannot access this guild');
    return result;
  }
  result.guild = { id: guild.value.id, name: guild.value.name };
  check('bot_in_guild', 'Bot is a member of the guild', true);

  const roleById = new Map(roles.value.map((role) => [role.id, role]));
  const botRoles = [guildId, ...botMember.value.roles].map((id) => roleById.get(id)).filter((r): r is ApiRole => Boolean(r));
  const permissions = botRoles.reduce((acc, role) => acc | BigInt(role.permissions), 0n);
  const isAdmin = (permissions & PERMISSION.Administrator) !== 0n;
  const has = (flag: bigint) => isAdmin || (permissions & flag) !== 0n;
  const highestPosition = Math.max(0, ...botRoles.map((role) => role.position));

  check('manage_roles', 'Bot has Manage Roles', has(PERMISSION.ManageRoles));
  check('create_invite', 'Bot has Create Invite (required for member restore)', has(PERMISSION.CreateInstantInvite));

  for (const roleId of roleIds) {
    const role = roleById.get(roleId);
    if (!role) {
      check(`role_${roleId}`, `Role ${roleId} exists`, false, 'Role not found in guild');
      continue;
    }
    check(
      `role_${roleId}`,
      `Bot can manage role "${role.name}"`,
      !role.managed && role.position < highestPosition,
      role.managed
        ? 'Role is managed by an integration'
        : role.position >= highestPosition
          ? `Move the bot's role above "${role.name}" in Server Settings > Roles`
          : undefined,
    );
  }
  return result;
}
