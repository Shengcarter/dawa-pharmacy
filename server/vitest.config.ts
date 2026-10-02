import { randomBytes } from 'node:crypto';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://dawa:dawa_dev_pw@localhost:5432/dawa_test',
      // Generated per run: no signing key is committed, even for tests.
      JWT_ACCESS_SECRET: randomBytes(48).toString('base64'),
      STORAGE_DIR: './storage-test',
      ALERTS_INTERVAL_MINUTES: '0',
    },
  },
});
