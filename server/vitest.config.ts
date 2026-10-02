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
      JWT_ACCESS_SECRET: 'test-secret-that-is-definitely-long-enough-123',
      STORAGE_DIR: './storage-test',
      ALERTS_INTERVAL_MINUTES: '0',
    },
  },
});
