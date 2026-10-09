import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { adminIds, env } from '../../config/env.js';
import { ADMIN_SCOPES, buildAuthorizeUrl, exchangeCode, getCurrentUser, revokeToken } from '../../discord/oauth.js';
import { getSettings, requireOAuthCredentials } from '../../lib/settings.js';
import { adminActor, audit } from '../../services/audit.js';
import { consumeOAuthState, issueOAuthState } from '../oauth-state.js';
import { createSession, destroySession, requireAdmin } from '../session.js';

const adminRedirectUri = () => `${env.PUBLIC_URL}/api/auth/callback`;

const loginPage = (error?: string) => {
  const url = new URL('/admin/login', env.PUBLIC_URL);
  if (error) url.searchParams.set('error', error);
  return url.toString();
};

const callbackQuery = z.object({
  code: z.string().min(1).max(512).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(100).optional(),
});

export async function authRoutes(app: FastifyInstance) {
  const rateLimit = { max: 20, timeWindow: 15 * 60_000 };

  app.get('/login', { config: { rateLimit } }, async (_request, reply) => {
    const settings = await getSettings();
    if (!settings.clientId || !settings.clientSecret) return reply.redirect(loginPage('not_configured'), 303);
    const state = await issueOAuthState(reply, 'admin', {});
    return reply.redirect(
      buildAuthorizeUrl({ clientId: settings.clientId, redirectUri: adminRedirectUri(), scopes: ADMIN_SCOPES, state }),
      303,
    );
  });

  app.get('/callback', { config: { rateLimit } }, async (request, reply) => {
    const query = callbackQuery.safeParse(request.query);
    if (!query.success) return reply.redirect(loginPage('invalid_request'), 303);
    const { code, state, error } = query.data;

    const stored = await consumeOAuthState(request, reply, 'admin', state);
    if (error || !code) return reply.redirect(loginPage(error ? 'access_denied' : 'invalid_request'), 303);
    if (!stored) return reply.redirect(loginPage('invalid_state'), 303);

    try {
      const creds = requireOAuthCredentials(await getSettings());
      const tokens = await exchangeCode(creds, code, adminRedirectUri());
      const user = await getCurrentUser(tokens.access_token);
      // The admin token is only needed to learn who signed in.
      revokeToken(creds, tokens.access_token).catch(() => undefined);

      if (!adminIds.has(user.id)) {
        await audit({
          type: 'ADMIN_LOGIN_DENIED',
          actor: { type: 'USER', id: user.id },
          targetDiscordId: user.id,
          message: `Dashboard login denied for ${user.username} (${user.id})`,
        });
        return reply.redirect(loginPage('forbidden'), 303);
      }

      await createSession(reply, { discordId: user.id, username: user.username, avatar: user.avatar });
      await audit({ type: 'ADMIN_LOGIN', actor: adminActor(user.id), message: `${user.username} signed in to the dashboard` });
      return reply.redirect(new URL('/admin', env.PUBLIC_URL).toString(), 303);
    } catch (err) {
      request.log.error({ err }, 'Admin login failed');
      return reply.redirect(loginPage('login_failed'), 303);
    }
  });

  app.post('/logout', { preHandler: requireAdmin }, async (request, reply) => {
    const admin = request.admin!;
    await destroySession(request, reply);
    await audit({ type: 'ADMIN_LOGOUT', actor: adminActor(admin.discordId), message: `${admin.username} signed out` });
    return { ok: true };
  });
}
