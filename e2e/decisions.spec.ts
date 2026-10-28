import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// Birch accounts are used only here (one sign-in each per run).
test('a manager approves a request and the admin sees it in the audit history', async ({ browser }) => {
  const title = `E2E decision ${Date.now()}`;

  // 1. An employee submits; employees never see the decision panel.
  const employee = await browser.newPage();
  await signIn(employee, 'employee2@birch.example');
  await employee.getByRole('link', { name: 'New request' }).first().click();
  await employee.getByLabel('Title').fill(title);
  await employee.getByLabel('Description').fill('Barcode scanner for the warehouse dock.');
  await employee.getByRole('button', { name: 'Submit request' }).click();
  await expect(employee.getByRole('heading', { name: title })).toBeVisible();
  await expect(employee.getByRole('heading', { name: 'Decision', exact: true })).toHaveCount(0);
  const detailUrl = employee.url();

  // 2. A manager rejects without a comment (refused in the form), then approves.
  const manager = await browser.newPage();
  await signIn(manager, 'manager@birch.example');
  await manager.goto(detailUrl);
  await expect(manager.getByRole('heading', { name: 'Decision', exact: true })).toBeVisible();
  await manager.getByRole('button', { name: 'Reject' }).click();
  await expect(manager.getByText(/comment is required when rejecting/)).toBeVisible();
  await manager.getByRole('button', { name: 'Approve' }).click();
  await expect(manager.getByText('Approved', { exact: true })).toBeVisible();
  await expect(manager.getByRole('heading', { name: 'Decision', exact: true })).toHaveCount(0);

  // 3. The employee sees the outcome.
  await employee.reload();
  await expect(employee.getByText('Approved', { exact: true })).toBeVisible();

  // 4. The admin finds both events in the audit history.
  const admin = await browser.newPage();
  await signIn(admin, 'admin@birch.example');
  await admin.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Audit' }).click();
  await expect(admin.getByRole('heading', { name: 'Audit history' })).toBeVisible();
  const rows = admin.getByRole('row').filter({ hasText: title });
  await expect(rows.filter({ hasText: 'Approved' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Submitted' })).toHaveCount(1);
});
