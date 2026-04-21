import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/__e2e__/**/*.e2e.test.ts'],
    testTimeout: 600_000,
  },
});
