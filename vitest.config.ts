import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.support.ts', 'src/**/types.ts', 'src/index.ts'],
      reporter: ['text', 'html', 'json-summary', 'json'],
    },
  },
});
