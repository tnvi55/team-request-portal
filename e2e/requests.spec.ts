import { expect, test } from '@playwright/test';
import { signIn } from './helpers.js';

// One journey across three Atlas accounts; each signs in once per run.
test('submit, read, ownership, and the company view', async ({ browser }) => {
  const title = `E2E monitor ${Date.now()}`;

  // 1. An employee submits a request and lands on its detail page.
  const employee = await browser.newPage();
  await signIn(employee, 'employee@atlas.example');
  await employee.getByRole('link', { name: 'New request' }).first().click();
  await employee.getByLabel('Title').fill(title);
  await employee.getByLabel('Category').selectOption('EQUIPMENT');
  await employee.getByLabel('Description').fill('A second monitor for reviewing designs.');
  await employee.getByRole('button', { name: 'Submit request' }).click();
  await expect(employee).toHaveURL(/\/requests\/[0-9a-f-]{36}$/);
  await expect(employee.getByRole('heading', { name: title })).toBeVisible();
  await expect(employee.getByText('Pending')).toBeVisible();
  const detailUrl = employee.url();

  // ...and sees it in "My requests".
  await employee.getByRole('link', { name: 'Requests', exact: true }).click();
  await expect(employee.getByRole('heading', { name: 'My requests' })).toBeVisible();
  await expect(employee.getByRole('link', { name: title })).toBeVisible();

  // 2. A coworker opening the same URL gets "not found" (the API answers 404).
  const coworker = await browser.newPage();
  await signIn(coworker, 'employee2@atlas.example');
  await coworker.goto(detailUrl);
  await expect(coworker.getByRole('heading', { name: 'Request not found' })).toBeVisible();
  await expect(coworker.getByText(title)).toHaveCount(0);

  // 3. A manager of the same company sees it in the company list and can open it.
  const manager = await browser.newPage();
  await signIn(manager, 'manager@atlas.example');
  await manager.getByRole('link', { name: 'Requests', exact: true }).click();
  await expect(manager.getByRole('heading', { name: 'Company requests' })).toBeVisible();
  await manager.getByLabel('Status').selectOption('PENDING');
  await manager.getByRole('link', { name: title }).click();
  await expect(manager.getByRole('heading', { name: title })).toBeVisible();
});
