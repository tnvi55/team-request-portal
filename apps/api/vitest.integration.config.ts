import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests talk to the real local Postgres/Redis started by `pnpm infra:up`.
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ['test/**/*.int-spec.ts'],
    setupFiles: ['test/load-env.ts'],
    testTimeout: 15000,
    fileParallelism: false,
  },
});
