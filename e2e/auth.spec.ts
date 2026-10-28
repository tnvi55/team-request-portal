import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// Accounts not used by other specs, so repeated runs stay under the per-account login limit.
const EMPLOYEE = 'employee@birch.example';
const OTHER = 'admin@cedar.example';

test('a signed-out visitor is sent to the login page', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('a wrong password shows a generic error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(OTHER);
  await page.getByLabel('Password').fill('definitely not the password');
  // Show/Hide only changes how the field is displayed.
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByLabel('Password')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  // The remaining tries for this email are shown (wording depends on earlier runs' attempts).
  await expect(page.getByText(/attempts? left|No attempts left/)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('an employee signs in, sees their company, and signs out', async ({ page, context }) => {
  await signIn(page, EMPLOYEE);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Birch Logistics').first()).toBeVisible();
  await expect(page.locator('.user-menu')).toContainText('Employee');
  // Profile: designation, current project, and that project's manager (pnpm db:seed).
  const profile = page.getByRole('region', { name: 'Ananya Iyer' });
  await expect(profile).toContainText('Backend Developer');
  await expect(profile).toContainText('Route Optimizer');
  await expect(profile).toContainText('Priya Reddy');

  // System status is an admin page; employees get a clear message and a way back.
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to dashboard' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // The session cookie is HttpOnly and SameSite=Lax; the page script cannot read it.
  const cookie = (await context.cookies()).find((c) => c.name === 'trp.sid');
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('trp.sid');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});
