import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

loadDotenv({
  path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
  quiet: true,
});

const SNOWFLAKE = /^\d{17,20}$/;

const csv = () =>
  z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    );

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  PUBLIC_URL: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, '')),
  TRUST_PROXY: z.string().default('1'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  ENCRYPTION_KEY: z.string().min(1, 'ENCRYPTION_KEY is required (npm run gen:key)'),
  ENCRYPTION_KEYS_PREVIOUS: csv(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_HOURS: z.coerce.number().positive().max(72).default(8),
  ADMIN_DISCORD_IDS: csv().refine(
    (ids) => ids.length > 0 && ids.every((id) => SNOWFLAKE.test(id)),
    'ADMIN_DISCORD_IDS must contain at least one valid Discord user ID',
  ),

  DISCORD_CLIENT_ID: optionalString,
  DISCORD_CLIENT_SECRET: optionalString,
  DISCORD_BOT_TOKEN: optionalString,
  DISCORD_GUILD_ID: optionalString,
  DISCORD_VERIFIED_ROLE_ID: optionalString,
  DISCORD_LOG_CHANNEL_ID: optionalString,

  VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  VERIFY_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60_000),
  IP_INTEL_PROVIDER: z.enum(['none', 'proxycheck']).default('none'),
  PROXYCHECK_API_KEY: optionalString,
  IP_INTEL_FAIL_OPEN: bool(true),

  TOKEN_CHECK_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(4),
  TOKEN_CHECK_MAX_PER_SECOND: z.coerce.number().int().min(1).max(50).default(5),
  RESTORE_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(2),
  RESTORE_RATE_MAX: z.coerce.number().int().min(1).default(10),
  RESTORE_RATE_DURATION_MS: z.coerce.number().int().min(100).default(10_000),
});

export type Env = z.infer<typeof schema>;

function parseEnv(): Env {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    console.error(`Invalid environment configuration:\n${issues.join('\n')}`);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
export const isProduction = env.NODE_ENV === 'production';
export const adminIds = new Set(env.ADMIN_DISCORD_IDS);

/** A number means "trust that many reverse-proxy hops" (Caddy = 1, Caddy + Next.js rewrites = 2). */
export function parseTrustProxy(value: string): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    return (_address, hop) => hop < hops;
  }
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

export function isSnowflake(value: unknown): value is string {
  return typeof value === 'string' && SNOWFLAKE.test(value);
}
