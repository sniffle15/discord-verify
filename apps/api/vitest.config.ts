import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      PUBLIC_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      SESSION_SECRET: 'test-session-secret-test-session-secret',
      ADMIN_DISCORD_IDS: '123456789012345678',
    },
  },
});
