import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DecryptionError, parseKey, TokenCipher } from '../src/lib/crypto.js';

const key = () => randomBytes(32);

describe('TokenCipher', () => {
  it('round-trips a value', () => {
    const cipher = new TokenCipher(key());
    const encrypted = cipher.encrypt('access-token-value', 'member:1:access');
    expect(encrypted).not.toContain('access-token-value');
    expect(cipher.decrypt(encrypted, 'member:1:access')).toBe('access-token-value');
  });

  it('uses a fresh IV for every encryption', () => {
    const cipher = new TokenCipher(key());
    expect(cipher.encrypt('same', 'ctx')).not.toBe(cipher.encrypt('same', 'ctx'));
  });

  it('rejects ciphertext moved to a different context', () => {
    const cipher = new TokenCipher(key());
    const encrypted = cipher.encrypt('token', 'member:1:access');
    expect(() => cipher.decrypt(encrypted, 'member:2:access')).toThrow(DecryptionError);
  });

  it('rejects tampered ciphertext', () => {
    const cipher = new TokenCipher(key());
    const parts = cipher.encrypt('token', 'ctx').split(':');
    const data = Buffer.from(parts[4]!, 'base64url');
    data[0] = data[0]! ^ 0xff;
    parts[4] = data.toString('base64url');
    expect(() => cipher.decrypt(parts.join(':'), 'ctx')).toThrow(DecryptionError);
  });

  it('decrypts with previous keys and flags them for rotation', () => {
    const oldKey = key();
    const encrypted = new TokenCipher(oldKey).encrypt('token', 'ctx');
    const rotated = new TokenCipher(key(), [oldKey]);
    expect(rotated.decrypt(encrypted, 'ctx')).toBe('token');
    expect(rotated.needsRotation(encrypted)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt('token', 'ctx'))).toBe(false);
  });

  it('fails when the key is unknown', () => {
    const encrypted = new TokenCipher(key()).encrypt('token', 'ctx');
    expect(() => new TokenCipher(key()).decrypt(encrypted, 'ctx')).toThrow(/No encryption key/);
  });

  it('produces stable, purpose-separated identifier hashes', () => {
    const cipher = new TokenCipher(key());
    expect(cipher.hashIdentifier('1.2.3.4', 'ip')).toBe(cipher.hashIdentifier('1.2.3.4', 'ip'));
    expect(cipher.hashIdentifier('1.2.3.4', 'ip')).not.toBe(cipher.hashIdentifier('1.2.3.4', 'fingerprint'));
  });
});

describe('parseKey', () => {
  it('accepts hex and base64 32-byte keys', () => {
    const raw = key();
    expect(parseKey(raw.toString('hex')).equals(raw)).toBe(true);
    expect(parseKey(raw.toString('base64')).equals(raw)).toBe(true);
  });

  it('rejects keys of the wrong length', () => {
    expect(() => parseKey(randomBytes(16).toString('base64'))).toThrow();
  });
});
