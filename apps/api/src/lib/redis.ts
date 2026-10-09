import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export function createRedis(name: string, options: { bullmq?: boolean } = {}): Redis {
  const client = new Redis(env.REDIS_URL, {
    connectionName: `dv:${name}`,
    // BullMQ requires null so blocking commands are never aborted.
    maxRetriesPerRequest: options.bullmq ? null : 3,
    enableReadyCheck: true,
  });
  client.on('error', (err) => logger.error({ err, connection: name }, 'Redis connection error'));
  return client;
}

export const redis = createRedis('main');
