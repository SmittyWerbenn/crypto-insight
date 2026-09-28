import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: { NODE_ENV: 'test', MOCK_MODE: 'true', LOG_LEVEL: 'silent' },
  },
});
