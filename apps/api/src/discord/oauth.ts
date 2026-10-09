import type { OAuthCredentials } from '../lib/settings.js';
import { DiscordApiError, discordRest } from './rest.js';

export const VERIFY_SCOPES = ['identify', 'guilds.join'] as const;
export const ADMIN_SCOPES = ['identify'] as const;

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  bot?: boolean;
}

/** The grant is gone: the user revoked the app or the refresh token is invalid. */
export class OAuthGrantError extends Error {
  constructor(readonly error: string) {
    super(`OAuth grant rejected: ${error}`);
    this.name = 'OAuthGrantError';
  }
}

/** Our client credentials or redirect URI are wrong. Never treat this as a user revocation. */
export class OAuthConfigError extends Error {
  constructor(readonly error: string, readonly status: number) {
    super(`OAuth client rejected (${status}): ${error}`);
    this.name = 'OAuthConfigError';
  }
}

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
}): string {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  return url.toString();
}

async function tokenRequest(creds: OAuthCredentials, form: Record<string, string>): Promise<OAuthTokenResponse> {
  try {
    return await discordRest.request<OAuthTokenResponse>({
      method: 'POST',
      path: '/oauth2/token',
      form: { ...form, client_id: creds.clientId, client_secret: creds.clientSecret },
      maxRetries: 2,
    });
  } catch (err) {
    if (err instanceof DiscordApiError && err.status < 500) {
      const error = (err.body as { error?: string } | undefined)?.error ?? 'unknown_error';
      if (error === 'invalid_grant') throw new OAuthGrantError(error);
      throw new OAuthConfigError(error, err.status);
    }
    throw err;
  }
}

export function exchangeCode(creds: OAuthCredentials, code: string, redirectUri: string) {
  return tokenRequest(creds, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

export function refreshAccessToken(creds: OAuthCredentials, refreshToken: string) {
  return tokenRequest(creds, { grant_type: 'refresh_token', refresh_token: refreshToken });
}

/** Best effort: revoking also invalidates the paired refresh token. */
export async function revokeToken(creds: OAuthCredentials, token: string): Promise<void> {
  await discordRest.request({
    method: 'POST',
    path: '/oauth2/token/revoke',
    form: { token, client_id: creds.clientId, client_secret: creds.clientSecret },
    maxRetries: 1,
  });
}

export function getCurrentUser(accessToken: string): Promise<DiscordUser> {
  return discordRest.request<DiscordUser>({
    method: 'GET',
    path: '/users/@me',
    auth: { type: 'Bearer', token: accessToken },
    maxRetries: 2,
  });
}

export function avatarUrl(user: { discordId: string; avatar: string | null }): string | null {
  if (!user.avatar) return null;
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.${ext}?size=128`;
}
