import { env } from '../config/env.js';
import { TokenCipher, parseKey } from './crypto.js';

export const cipher = new TokenCipher(
  parseKey(env.ENCRYPTION_KEY),
  env.ENCRYPTION_KEYS_PREVIOUS.map(parseKey),
);

export const tokenContext = (discordId: string, kind: 'access' | 'refresh') => `member:${discordId}:${kind}`;
export const settingContext = (key: string) => `setting:${key}`;
