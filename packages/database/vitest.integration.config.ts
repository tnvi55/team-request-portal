import { defineConfig } from 'vitest/config';

// Runs against the isolated *_test databases prepared by `test:prepare` (never the dev data).
// Tests import the built package (dist/) so they exercise exactly what the API will import.
export default defineConfig({
  test: {
    include: ['test/**/*.int-spec.ts'],
    setupFiles: ['test/load-env.ts'],
    testTimeout: 20000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
