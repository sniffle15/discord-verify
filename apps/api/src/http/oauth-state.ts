import type { FastifyReply, FastifyRequest } from 'fastify';
import { isProduction } from '../config/env.js';
import { randomToken, safeEqual, sha256 } from '../lib/crypto.js';
import { redis } from '../lib/redis.js';

export type OAuthFlow = 'verify' | 'admin';

const STATE_TTL_S = 600;

const FLOW_CONFIG: Record<OAuthFlow, { cookie: string; path: string }> = {
  verify: { cookie: 'dv_vstate', path: '/api/verify' },
  admin: { cookie: 'dv_astate', path: '/api/auth' },
};

const redisKey = (flow: OAuthFlow, state: string) => `dv:oauth-state:${flow}:${sha256(state)}`;

/**
 * Double-bound CSRF protection: the random state lives in a signed, HttpOnly cookie *and* in Redis.
 * The callback must present the same value in the query string, and the Redis entry is single-use.
 */
export async function issueOAuthState<T extends Record<string, unknown>>(
  reply: FastifyReply,
  flow: OAuthFlow,
  data: T,
): Promise<string> {
  const state = randomToken(32);
  await redis.set(redisKey(flow, state), JSON.stringify({ ...data, issuedAt: Date.now() }), 'EX', STATE_TTL_S);
  const { cookie, path } = FLOW_CONFIG[flow];
  reply.setCookie(cookie, state, {
    httpOnly: true,
    secure: isProduction,
    // Lax is required: the callback is a top-level navigation coming back from discord.com.
    sameSite: 'lax',
    path,
    maxAge: STATE_TTL_S,
    signed: true,
  });
  return state;
}

export async function consumeOAuthState<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  flow: OAuthFlow,
  stateParam: string | undefined,
): Promise<T | null> {
  const { cookie, path } = FLOW_CONFIG[flow];
  const raw = request.cookies[cookie];
  reply.clearCookie(cookie, { path });

  if (!raw || !stateParam) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value || !safeEqual(unsigned.value, stateParam)) return null;

  const stored = await redis.getdel(redisKey(flow, stateParam));
  return stored ? (JSON.parse(stored) as T) : null;
}
