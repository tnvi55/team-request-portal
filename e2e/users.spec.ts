import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers.js';

// admin@atlas.example is used only here (one sign-in per run). Each run creates its own user.
test('an admin creates an account, the user must change the password, and disabling signs them out', async ({
  browser,
}) => {
  const stamp = Date.now();
  const email = `e2e-${stamp}@atlas.example`;
  const name = `E2E User ${stamp}`;
  const temporaryPassword = `temporary ${stamp}`;
  const ownPassword = `my own password ${stamp}`;

  // 1. The admin creates the account.
  const admin = await browser.newPage();
  await signIn(admin, 'admin@atlas.example');
  await admin.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Users' }).click();
  await expect(admin.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await admin.getByLabel('Work email').fill(email);
  await admin.getByLabel('Display name').fill(name);
  await admin.getByLabel('Designation', { exact: true }).fill('QA Engineer');
  await admin
    .getByLabel('Project', { exact: true })
    .selectOption({ label: 'Vision Platform (Sofia Fernandes)' });
  await admin.getByLabel('Temporary password').fill(temporaryPassword);
  await admin.getByRole('button', { name: 'Create account' }).click();
  await expect(admin.getByText(`Account created for ${email}`)).toBeVisible();
  const row = admin.getByRole('row').filter({ hasText: email });
  await expect(row).toContainText('must change password');
  // The project's manager is the new user's manager.
  await expect(row).toContainText('Sofia Fernandes');

  // 2. The new user is sent to change the password before anything else.
  const user = await browser.newPage();
  await signInWith(user, email, temporaryPassword, /\/change-password$/);
  await user.getByLabel('Current password').fill(temporaryPassword);
  await user.getByLabel('New password', { exact: true }).fill(ownPassword);
  await user.getByLabel('Confirm new password').fill(ownPassword);
  await user.getByRole('button', { name: 'Change password' }).click();
  await expect(user.getByText('Password changed.')).toBeVisible();
  await signInWith(user, email, ownPassword, /\/dashboard$/);

  // 3. The admin disables the account; the user's next action finds them signed out.
  await row.getByRole('button', { name: `Disable ${name}` }).click();
  await expect(row).toContainText('Disabled');
  await user.reload();
  await expect(user).toHaveURL(/\/login$/);

  // 4. The only admin cannot demote themselves.
  const self = admin.getByRole('row').filter({ hasText: '(you)' });
  await self.getByLabel(/^Role for/).selectOption('MANAGER');
  await expect(self.getByRole('alert')).toContainText('at least one active admin');
  await expect(self.getByLabel(/^Role for/)).toHaveValue('ADMIN');
});

async function signInWith(page: Page, email: string, password: string, landing: RegExp) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(landing);
}
