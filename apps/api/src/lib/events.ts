import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import { logger } from './logger.js';
import { createRedis, redis } from './redis.js';

export const CHANNELS = {
  configUpdated: 'dv:config-updated',
  audit: 'dv:audit',
} as const;

type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

const bus = new EventEmitter();
bus.setMaxListeners(0);
let subscriber: Redis | null = null;

function ensureSubscriber(): void {
  if (subscriber) return;
  subscriber = createRedis('subscriber');
  subscriber.subscribe(...Object.values(CHANNELS)).catch((err) => logger.error({ err }, 'Redis subscribe failed'));
  subscriber.on('message', (channel: string, message: string) => {
    try {
      bus.emit(channel, JSON.parse(message));
    } catch (err) {
      logger.warn({ err, channel }, 'Dropping malformed pub/sub message');
    }
  });
}

export async function publish(channel: Channel, payload: unknown): Promise<void> {
  await redis.publish(channel, JSON.stringify(payload));
}

/** Returns an unsubscribe function. */
export function subscribe<T = unknown>(channel: Channel, handler: (payload: T) => void): () => void {
  ensureSubscriber();
  bus.on(channel, handler);
  return () => bus.off(channel, handler);
}

export async function closeSubscriber(): Promise<void> {
  if (subscriber) {
    await subscriber.quit().catch(() => undefined);
    subscriber = null;
  }
}
