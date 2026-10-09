import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const FORMAT_VERSION = 'v1';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** Accepts a 32-byte key encoded as 64 hex chars or base64. */
export function parseKey(raw: string): Buffer {
  const value = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Encryption keys must decode to exactly ${KEY_LENGTH} bytes`);
  }
  return key;
}

function keyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

/**
 * AES-256-GCM envelope: `v1:<keyId>:<iv>:<tag>:<ciphertext>` (base64url parts).
 *
 * Every value is bound to a context string through GCM additional authenticated
 * data, so a ciphertext copied into another row or column fails authentication.
 */
export class TokenCipher {
  private readonly activeKeyId: string;
  private readonly keys = new Map<string, Buffer>();
  private readonly hashKey: Buffer;

  constructor(activeKey: Buffer, previousKeys: Buffer[] = []) {
    this.activeKeyId = keyId(activeKey);
    this.keys.set(this.activeKeyId, activeKey);
    for (const key of previousKeys) this.keys.set(keyId(key), key);
    this.hashKey = Buffer.from(hkdfSync('sha256', activeKey, Buffer.alloc(0), 'dv-identifier-hash', KEY_LENGTH));
  }

  encrypt(plaintext: string, context: string): string {
    const key = this.keys.get(this.activeKeyId)!;
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      FORMAT_VERSION,
      this.activeKeyId,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(payload: string, context: string): string {
    const parts = payload.split(':');
    if (parts.length !== 5 || parts[0] !== FORMAT_VERSION) {
      throw new DecryptionError('Unsupported ciphertext format');
    }
    const [, kid, ivPart, tagPart, dataPart] = parts as [string, string, string, string, string];
    const key = this.keys.get(kid);
    if (!key) throw new DecryptionError(`No encryption key available for key id ${kid}`);

    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
      throw new DecryptionError('Malformed ciphertext');
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new DecryptionError('Ciphertext authentication failed');
    }
  }

  needsRotation(payload: string): boolean {
    return payload.split(':')[1] !== this.activeKeyId;
  }

  /** Keyed, non-reversible identifier hash (IPs, fingerprints). */
  hashIdentifier(value: string, purpose: string): string {
    return createHmac('sha256', this.hashKey).update(`${purpose}\u0000${value}`).digest('hex');
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
