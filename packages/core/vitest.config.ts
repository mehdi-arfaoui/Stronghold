import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/index.ts',
        'src/types/**',
        'src/**/*-types.ts',
        'src/ports/**',
        'src/providers/provider-interface.ts',
        'src/providers/aws/services/**',
        'src/providers/aws/aws-client-factory.ts',
        'src/providers/aws/aws-scanner.ts',
        'src/providers/aws/scan-utils.ts',
        'src/providers/aws/enrichers/**',
        'src/providers/azure/**',
      ],
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 70,
        lines: 70,
      },
    },
  },
});
