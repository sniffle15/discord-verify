import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { env, parseTrustProxy } from '../config/env.js';
import { randomToken } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { createRedis, redis } from '../lib/redis.js';
import { redirectToResult, verifyRoutes } from './routes/verify.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin/index.js';

export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    bodyLimit: 64 * 1024,
    genReqId: () => randomToken(8),
  });

  app.decorateRequest('admin', null);

  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(cookie, { secret: env.SESSION_SECRET });
  await app.register(rateLimit, {
    global: false,
    redis: createRedis('rate-limit'),
    nameSpace: 'dv:rl:',
    // Fail closed: if Redis is down, abuse protection must not silently disappear.
    skipOnError: false,
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.statusCode === 429 && request.url.startsWith('/api/verify')) {
      return redirectToResult(reply, 'error', 'rate_limited');
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'validation_error', issues: error.issues });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.code ?? 'bad_request', message: error.message });
    }
    request.log.error({ err: error }, 'Unhandled request error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/api/health', async (_request, reply) => {
    try {
      await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  await app.register(verifyRoutes, { prefix: '/api/verify' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  return app;
}
