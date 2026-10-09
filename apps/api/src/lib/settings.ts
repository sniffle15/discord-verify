import { z } from 'zod';
import { env } from '../config/env.js';
import { cipher, settingContext } from './encryption.js';
import { CHANNELS, publish, subscribe } from './events.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';

export interface RuntimeSettings {
  botToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
  targetGuildId: string | null;
  verifiedRoleId: string | null;
  logChannelId: string | null;
  syncIntervalMinutes: number;
  dmConfirmation: boolean;
  autoJoinOnVerify: boolean;
  blockVpn: boolean;
}

export type SettingKey = keyof RuntimeSettings;

const SECRET_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>(['botToken', 'clientSecret']);
const CACHE_TTL_MS = 30_000;

const snowflake = z.string().trim().regex(/^\d{17,20}$/, 'Must be a Discord ID');

export const settingsUpdateSchema = z
  .object({
    botToken: z.string().trim().min(50).max(120).optional(),
    clientId: snowflake.optional(),
    clientSecret: z.string().trim().min(16).max(128).optional(),
    targetGuildId: snowflake.nullable().optional(),
    verifiedRoleId: snowflake.nullable().optional(),
    logChannelId: snowflake.nullable().optional(),
    syncIntervalMinutes: z.number().int().min(5).max(1440).optional(),
    dmConfirmation: z.boolean().optional(),
    autoJoinOnVerify: z.boolean().optional(),
    blockVpn: z.boolean().optional(),
  })
  .strict();

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

function defaults(): RuntimeSettings {
  return {
    botToken: env.DISCORD_BOT_TOKEN ?? null,
    clientId: env.DISCORD_CLIENT_ID ?? null,
    clientSecret: env.DISCORD_CLIENT_SECRET ?? null,
    targetGuildId: env.DISCORD_GUILD_ID ?? null,
    verifiedRoleId: env.DISCORD_VERIFIED_ROLE_ID ?? null,
    logChannelId: env.DISCORD_LOG_CHANNEL_ID ?? null,
    syncIntervalMinutes: 30,
    dmConfirmation: true,
    autoJoinOnVerify: true,
    blockVpn: false,
  };
}

function serialize(value: RuntimeSettings[SettingKey]): string {
  return value === null ? '' : String(value);
}

function apply(settings: RuntimeSettings, key: SettingKey, raw: string): void {
  const fallback = settings[key];
  const target = settings as unknown as Record<SettingKey, unknown>;
  if (typeof fallback === 'number') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) target[key] = parsed;
  } else if (typeof fallback === 'boolean') {
    target[key] = raw === 'true';
  } else {
    target[key] = raw === '' ? null : raw;
  }
}

let cache: { value: RuntimeSettings; expiresAt: number } | null = null;
let syncing = false;

/** Invalidate the in-process cache whenever any process publishes a settings change. */
export function initSettingsSync(): void {
  if (syncing) return;
  syncing = true;
  subscribe(CHANNELS.configUpdated, () => {
    cache = null;
  });
}

export async function getSettings(): Promise<RuntimeSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const settings = defaults();
  const rows = await prisma.setting.findMany();
  for (const row of rows) {
    if (!(row.key in settings)) continue;
    const key = row.key as SettingKey;
    try {
      apply(settings, key, row.encrypted ? cipher.decrypt(row.value, settingContext(key)) : row.value);
    } catch (err) {
      logger.error({ err, key }, 'Failed to decrypt setting, falling back to environment default');
    }
  }

  cache = { value: settings, expiresAt: Date.now() + CACHE_TTL_MS };
  return settings;
}

export async function updateSettings(patch: SettingsUpdate, updatedBy: string): Promise<SettingKey[]> {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as [
    SettingKey,
    RuntimeSettings[SettingKey],
  ][];
  if (entries.length === 0) return [];

  await prisma.$transaction(
    entries.map(([key, value]) => {
      const encrypted = SECRET_KEYS.has(key);
      const raw = serialize(value);
      const stored = encrypted ? cipher.encrypt(raw, settingContext(key)) : raw;
      return prisma.setting.upsert({
        where: { key },
        create: { key, value: stored, encrypted, updatedBy },
        update: { value: stored, encrypted, updatedBy },
      });
    }),
  );

  cache = null;
  const keys = entries.map(([key]) => key);
  await publish(CHANNELS.configUpdated, { keys });
  return keys;
}

export interface PublicSettings extends Omit<RuntimeSettings, 'botToken' | 'clientSecret'> {
  botTokenConfigured: boolean;
  clientSecretConfigured: boolean;
}

/** Shape safe to send to the dashboard: secrets are reduced to "is configured" flags. */
export function toPublicSettings(settings: RuntimeSettings): PublicSettings {
  const { botToken, clientSecret, ...rest } = settings;
  return { ...rest, botTokenConfigured: Boolean(botToken), clientSecretConfigured: Boolean(clientSecret) };
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function requireOAuthCredentials(settings: RuntimeSettings): OAuthCredentials {
  if (!settings.clientId || !settings.clientSecret) {
    throw new ConfigurationError('Discord client ID / secret are not configured');
  }
  return { clientId: settings.clientId, clientSecret: settings.clientSecret };
}
