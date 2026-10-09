import { logger } from '../lib/logger.js';

export const DISCORD_API = 'https://discord.com/api/v10';
const USER_AGENT = 'DiscordBot (https://github.com/sniffle15/discord-verify, 1.0.0)';
const MAJOR_PARAMETERS = new Set(['guilds', 'channels', 'webhooks']);

export const DiscordErrorCode = {
  UnknownGuild: 10004,
  UnknownMember: 10007,
  UnknownRole: 10011,
  UnknownUser: 10013,
  MaxGuilds: 30001,
  UserBanned: 40007,
  MissingAccess: 50001,
  CannotSendMessagesToUser: 50007,
  MissingPermissions: 50013,
  InvalidOAuthToken: 50025,
} as const;

export type DiscordAuth = { type: 'Bot' | 'Bearer'; token: string };
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface DiscordRequest {
  method: HttpMethod;
  path: string;
  auth?: DiscordAuth;
  json?: unknown;
  form?: Record<string, string>;
  /** Shown in the guild's audit log. */
  reason?: string;
  maxRetries?: number;
  /** 429s with a longer retry_after are surfaced as DiscordRateLimitError so queues can reschedule. */
  maxInlineWaitMs?: number;
}

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    message: string,
    readonly method: HttpMethod,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`Discord ${method} ${path} failed with ${status}${code ? ` (code ${code})` : ''}: ${message}`);
    this.name = 'DiscordApiError';
  }
}

export class DiscordRateLimitError extends Error {
  constructor(
    readonly retryAfterMs: number,
    readonly global: boolean,
    readonly scope: string | undefined,
    readonly path: string,
  ) {
    super(`Rate limited on ${path} for ${retryAfterMs}ms${global ? ' (global)' : ''}`);
    this.name = 'DiscordRateLimitError';
  }
}

export class DiscordNetworkError extends Error {
  constructor(readonly path: string, cause: unknown) {
    super(`Network error calling Discord ${path}`, { cause });
    this.name = 'DiscordNetworkError';
  }
}

export function isTransientDiscordError(err: unknown): boolean {
  return (
    err instanceof DiscordNetworkError ||
    err instanceof DiscordRateLimitError ||
    (err instanceof DiscordApiError && err.status >= 500)
  );
}

export function routeKey(method: HttpMethod, path: string): string {
  const pathname = path.split('?')[0] ?? path;
  const normalized = pathname.replace(/\/([a-z_-]+)\/(\d{16,20})/g, (match, segment: string) =>
    MAJOR_PARAMETERS.has(segment) ? match : `/${segment}/:id`,
  );
  return `${method} ${normalized}`;
}

interface Bucket {
  remaining: number;
  resetAt: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const backoff = (attempt: number) => Math.min(30_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class DiscordRestClient {
  private readonly routeBuckets = new Map<string, string>();
  private readonly buckets = new Map<string, Bucket>();
  private globalResetAt = 0;

  constructor(private readonly timeoutMs = 15_000) {}

  async request<T = unknown>(req: DiscordRequest): Promise<T> {
    return (await this.requestWithStatus<T>(req)).data;
  }

  async requestWithStatus<T = unknown>(req: DiscordRequest): Promise<{ status: number; data: T }> {
    const maxRetries = req.maxRetries ?? 3;
    const maxInlineWaitMs = req.maxInlineWaitMs ?? 10_000;
    // Bot buckets are shared per process; bearer buckets are per user token and not worth tracking.
    const tracked = req.auth?.type === 'Bot';
    const key = routeKey(req.method, req.path);

    for (let attempt = 0; ; attempt++) {
      if (tracked) await this.waitForCapacity(key, req.path, maxInlineWaitMs);

      let res: Response;
      try {
        res = await fetch(`${DISCORD_API}${req.path}`, {
          method: req.method,
          headers: this.headers(req),
          body: req.form ? new URLSearchParams(req.form) : req.json !== undefined ? JSON.stringify(req.json) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new DiscordNetworkError(req.path, err);
      }

      if (tracked) this.updateBucket(key, res.headers);

      if (res.status === 429) {
        const body = (await readBody(res)) as { retry_after?: number; global?: boolean } | undefined;
        const retryAfterSeconds = Number(body?.retry_after ?? res.headers.get('retry-after') ?? 1);
        const retryAfterMs = Math.ceil(retryAfterSeconds * 1000);
        const global = Boolean(body?.global) || res.headers.get('x-ratelimit-global') === 'true';
        const scope = res.headers.get('x-ratelimit-scope') ?? undefined;
        if (global) this.globalResetAt = Date.now() + retryAfterMs;
        logger.warn({ path: key, retryAfterMs, global, scope }, 'Discord rate limit hit');

        if (attempt < maxRetries && retryAfterMs <= maxInlineWaitMs) {
          await sleep(retryAfterMs + Math.floor(Math.random() * 250));
          continue;
        }
        throw new DiscordRateLimitError(retryAfterMs, global, scope, req.path);
      }

      if (res.status >= 500 && attempt < maxRetries) {
        await sleep(backoff(attempt));
        continue;
      }

      const data = await readBody(res);
      if (!res.ok) {
        const details = (data ?? {}) as { code?: number; message?: string; error?: string; error_description?: string };
        throw new DiscordApiError(
          res.status,
          details.code,
          details.message ?? details.error_description ?? details.error ?? res.statusText,
          req.method,
          req.path,
          data,
        );
      }
      return { status: res.status, data: data as T };
    }
  }

  private headers(req: DiscordRequest): Record<string, string> {
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
    if (req.auth) headers.Authorization = `${req.auth.type} ${req.auth.token}`;
    if (req.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    else if (req.json !== undefined) headers['Content-Type'] = 'application/json';
    if (req.reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(req.reason);
    return headers;
  }

  private async waitForCapacity(key: string, path: string, maxInlineWaitMs: number): Promise<void> {
    const now = Date.now();
    let waitUntil = this.globalResetAt;
    const hash = this.routeBuckets.get(key);
    const bucket = hash ? this.buckets.get(hash) : undefined;
    if (bucket && bucket.remaining <= 0 && bucket.resetAt > now) waitUntil = Math.max(waitUntil, bucket.resetAt);

    const waitMs = waitUntil - now;
    if (waitMs > 0) {
      if (waitMs > maxInlineWaitMs) throw new DiscordRateLimitError(waitMs, waitUntil === this.globalResetAt, 'local', path);
      await sleep(waitMs);
    }
    if (bucket && bucket.remaining > 0) bucket.remaining -= 1;
  }

  private updateBucket(key: string, headers: Headers): void {
    const hash = headers.get('x-ratelimit-bucket');
    const remaining = headers.get('x-ratelimit-remaining');
    const resetAfter = headers.get('x-ratelimit-reset-after');
    if (!hash || remaining === null || resetAfter === null) return;
    this.routeBuckets.set(key, hash);
    this.buckets.set(hash, { remaining: Number(remaining), resetAt: Date.now() + Number(resetAfter) * 1000 });
  }
}

export const discordRest = new DiscordRestClient();
