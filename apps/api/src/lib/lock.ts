import { randomToken } from './crypto.js';
import { redis } from './redis.js';

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

export class LockTimeoutError extends Error {
  constructor(key: string) {
    super(`Timed out acquiring lock ${key}`);
    this.name = 'LockTimeoutError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Distributed mutex (single Redis instance) shared by the API and worker processes. */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  { ttlMs = 30_000, waitMs = 15_000 }: { ttlMs?: number; waitMs?: number } = {},
): Promise<T> {
  const token = randomToken(16);
  const deadline = Date.now() + waitMs;

  while ((await redis.set(key, token, 'PX', ttlMs, 'NX')) !== 'OK') {
    if (Date.now() > deadline) throw new LockTimeoutError(key);
    await sleep(100 + Math.random() * 150);
  }

  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE_SCRIPT, 1, key, token).catch(() => undefined);
  }
}
