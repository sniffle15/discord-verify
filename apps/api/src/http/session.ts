import type { FastifyReply, FastifyRequest } from 'fastify';
import { adminIds, env, isProduction } from '../config/env.js';
import { randomToken, safeEqual, sha256 } from '../lib/crypto.js';
import { redis } from '../lib/redis.js';

export interface AdminSession {
  discordId: string;
  username: string;
  avatar: string | null;
  csrfToken: string;
  createdAt: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    admin: AdminSession | null;
  }
}

export const SESSION_COOKIE = 'dv_session';
const SESSION_TTL_S = Math.round(env.SESSION_TTL_HOURS * 3600);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const publicOrigin = new URL(env.PUBLIC_URL).origin;

const sessionKey = (id: string) => `dv:admin-session:${sha256(id)}`;

export async function createSession(reply: FastifyReply, user: Omit<AdminSession, 'csrfToken' | 'createdAt'>) {
  const id = randomToken(32);
  const session: AdminSession = { ...user, csrfToken: randomToken(32), createdAt: Date.now() };
  await redis.set(sessionKey(id), JSON.stringify(session), 'EX', SESSION_TTL_S);
  reply.setCookie(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_S,
    signed: true,
  });
}

function sessionId(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}

export async function loadSession(request: FastifyRequest): Promise<AdminSession | null> {
  const id = sessionId(request);
  if (!id) return null;
  const stored = await redis.get(sessionKey(id));
  if (!stored) return null;
  const session = JSON.parse(stored) as AdminSession;
  // Re-checked on every request so removing an ID from ADMIN_DISCORD_IDS takes effect immediately.
  return adminIds.has(session.discordId) ? session : null;
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const id = sessionId(request);
  if (id) await redis.del(sessionKey(id));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** preHandler for every /api/admin route: valid session, plus CSRF token and Origin check on mutations. */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const session = await loadSession(request);
  if (!session) {
    await reply.code(401).send({ error: 'unauthorized' });
    return;
  }

  if (!SAFE_METHODS.has(request.method)) {
    const origin = request.headers.origin;
    if (origin && origin !== publicOrigin) {
      await reply.code(403).send({ error: 'invalid_origin' });
      return;
    }
    const csrf = request.headers['x-csrf-token'];
    if (typeof csrf !== 'string' || !safeEqual(csrf, session.csrfToken)) {
      await reply.code(403).send({ error: 'invalid_csrf_token' });
      return;
    }
  }

  request.admin = session;
}
