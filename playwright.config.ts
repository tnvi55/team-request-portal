import { defineConfig, devices } from '@playwright/test';

// Browser tests against the running app at http://localhost:8080 (same origin as users get).
// Prerequisites: pnpm infra:up, pnpm db:migrate:all, pnpm db:seed, then pnpm dev (or pnpm demo:up).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
