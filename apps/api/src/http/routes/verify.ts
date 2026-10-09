import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { buildAuthorizeUrl, OAuthConfigError, OAuthGrantError, VERIFY_SCOPES } from '../../discord/oauth.js';
import { cipher } from '../../lib/encryption.js';
import { getSettings } from '../../lib/settings.js';
import { audit } from '../../services/audit.js';
import { checkIp } from '../../services/ip-intel.js';
import { completeVerification, VerificationError, verifyRedirectUri } from '../../services/verification.js';
import { consumeOAuthState, issueOAuthState } from '../oauth-state.js';

type VerifyState = {
  ipHash: string;
  fingerprintHash: string | null;
};

const startQuery = z.object({
  fp: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional()
    .catch(undefined),
});

const callbackQuery = z.object({
  code: z.string().min(1).max(512).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(100).optional(),
});

export function redirectToResult(reply: FastifyReply, status: 'success' | 'error', reason?: string) {
  const url = new URL('/verify/result', env.PUBLIC_URL);
  url.searchParams.set('status', status);
  if (reason) url.searchParams.set('reason', reason);
  return reply.redirect(url.toString(), 303);
}

export async function verifyRoutes(app: FastifyInstance) {
  app.get(
    '/start',
    {
      config: {
        rateLimit: { max: env.VERIFY_RATE_LIMIT_MAX, timeWindow: env.VERIFY_RATE_LIMIT_WINDOW_MS },
      },
    },
    async (request, reply) => {
      const settings = await getSettings();
      if (!settings.clientId || !settings.clientSecret) return redirectToResult(reply, 'error', 'not_configured');

      const { fp } = startQuery.parse(request.query);
      const ipHash = cipher.hashIdentifier(request.ip, 'ip');

      if (settings.blockVpn) {
        const verdict = await checkIp(request.ip);
        if (verdict.proxy) {
          await audit({
            type: 'VERIFICATION_BLOCKED',
            message: verdict.degraded
              ? 'Verification blocked: IP reputation service unavailable (fail-closed)'
              : `Verification blocked: VPN/proxy detected (${verdict.type ?? 'unknown'})`,
            metadata: { ipHash, type: verdict.type ?? null, degraded: Boolean(verdict.degraded) },
          });
          return redirectToResult(reply, 'error', 'vpn_blocked');
        }
      }

      const state = await issueOAuthState<VerifyState>(reply, 'verify', {
        ipHash,
        fingerprintHash: fp ? cipher.hashIdentifier(fp, 'fingerprint') : null,
      });

      return reply.redirect(
        buildAuthorizeUrl({ clientId: settings.clientId, redirectUri: verifyRedirectUri(), scopes: VERIFY_SCOPES, state }),
        303,
      );
    },
  );

  app.get(
    '/callback',
    { config: { rateLimit: { max: env.VERIFY_RATE_LIMIT_MAX * 2, timeWindow: env.VERIFY_RATE_LIMIT_WINDOW_MS } } },
    async (request, reply) => {
      const query = callbackQuery.safeParse(request.query);
      if (!query.success) return redirectToResult(reply, 'error', 'invalid_request');
      const { code, state, error } = query.data;

      const stored = await consumeOAuthState<VerifyState>(request, reply, 'verify', state);
      if (error) return redirectToResult(reply, 'error', error === 'access_denied' ? 'access_denied' : 'oauth_error');
      if (!stored) return redirectToResult(reply, 'error', 'invalid_state');
      if (!code) return redirectToResult(reply, 'error', 'invalid_request');

      try {
        const { role } = await completeVerification({
          code,
          ipHash: stored.ipHash,
          fingerprintHash: stored.fingerprintHash,
        });
        return redirectToResult(reply, 'success', role.ok ? undefined : 'role_pending');
      } catch (err) {
        const reason =
          err instanceof VerificationError
            ? err.reason
            : err instanceof OAuthGrantError
              ? 'code_expired'
              : err instanceof OAuthConfigError
                ? 'not_configured'
                : 'internal_error';
        request.log.warn({ err, reason }, 'Verification failed');
        await audit({
          type: 'VERIFICATION_FAILED',
          message: `Verification failed: ${reason}`,
          metadata: { reason, ipHash: stored.ipHash },
        });
        return redirectToResult(reply, 'error', reason);
      }
    },
  );
}
