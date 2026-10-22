import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Seeded demo accounts (pnpm db:seed). The file is Git-ignored and never printed.
const credentials = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../.local/demo-credentials.json'), 'utf8'),
) as Record<string, string>;

/**
 * Each account is used at most once per run (login limit: 5 attempts per account per 15 minutes),
 * so the suite can be run a couple of times in a row.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(credentials[email]!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
