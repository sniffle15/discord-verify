import type { Member } from '@prisma/client';
import { OAuthGrantError, refreshAccessToken, type OAuthTokenResponse } from '../discord/oauth.js';
import { cipher, tokenContext } from '../lib/encryption.js';
import { withLock } from '../lib/lock.js';
import { prisma } from '../lib/prisma.js';
import { getSettings, requireOAuthCredentials } from '../lib/settings.js';

/** Refresh slightly before expiry so a token never dies mid-request. */
const REFRESH_SKEW_MS = 5 * 60_000;

export class TokenRevokedError extends Error {
  constructor(readonly reason: string) {
    super(`Member authorization revoked: ${reason}`);
    this.name = 'TokenRevokedError';
  }
}

type TokenFields = Pick<Member, 'id' | 'discordId' | 'accessTokenEnc' | 'refreshTokenEnc' | 'tokenExpiresAt'>;

export function encryptTokens(discordId: string, tokens: OAuthTokenResponse) {
  return {
    accessTokenEnc: cipher.encrypt(tokens.access_token, tokenContext(discordId, 'access')),
    refreshTokenEnc: cipher.encrypt(tokens.refresh_token, tokenContext(discordId, 'refresh')),
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: tokens.scope.split(' ').filter(Boolean),
  };
}

const isFresh = (expiresAt: Date | null) => Boolean(expiresAt && expiresAt.getTime() - Date.now() > REFRESH_SKEW_MS);

export function decryptRefreshToken(member: TokenFields): string | null {
  return member.refreshTokenEnc ? cipher.decrypt(member.refreshTokenEnc, tokenContext(member.discordId, 'refresh')) : null;
}

/**
 * Returns a usable access token, refreshing it when it is about to expire (or when `forceRefresh`
 * is set after a 401). Throws TokenRevokedError when Discord rejects the refresh grant.
 */
export async function getValidAccessToken(member: TokenFields, { forceRefresh = false } = {}): Promise<string> {
  if (!member.accessTokenEnc || !member.refreshTokenEnc) throw new TokenRevokedError('no_tokens_stored');
  if (!forceRefresh && isFresh(member.tokenExpiresAt)) {
    return cipher.decrypt(member.accessTokenEnc, tokenContext(member.discordId, 'access'));
  }
  return refreshMemberTokens(member.id, member.refreshTokenEnc);
}

/**
 * Discord rotates refresh tokens, so two concurrent refreshes would invalidate each other.
 * The lock plus the "did someone else already refresh?" re-read prevents that across processes.
 */
async function refreshMemberTokens(memberId: string, staleRefreshTokenEnc: string): Promise<string> {
  return withLock(`dv:lock:token-refresh:${memberId}`, async () => {
    const current = await prisma.member.findUnique({ where: { id: memberId } });
    if (!current || current.status !== 'ACTIVE' || !current.refreshTokenEnc || !current.accessTokenEnc) {
      throw new TokenRevokedError('no_tokens_stored');
    }
    if (current.refreshTokenEnc !== staleRefreshTokenEnc && isFresh(current.tokenExpiresAt)) {
      return cipher.decrypt(current.accessTokenEnc, tokenContext(current.discordId, 'access'));
    }

    const creds = requireOAuthCredentials(await getSettings());
    let tokens: OAuthTokenResponse;
    try {
      tokens = await refreshAccessToken(creds, decryptRefreshToken(current)!);
    } catch (err) {
      if (err instanceof OAuthGrantError) throw new TokenRevokedError('refresh_token_rejected');
      throw err;
    }

    await prisma.member.update({ where: { id: memberId }, data: encryptTokens(current.discordId, tokens) });
    return tokens.access_token;
  });
}
