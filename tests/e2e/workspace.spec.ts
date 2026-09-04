import { test, expect, type Page } from '@playwright/test';
import { buildSandboxData } from '../../lib/sandbox-data';
import { reconcileTransaction } from '../../lib/reconciliation';
import { deterministicExplanation } from '../../lib/ai-explanation';
const now = new Date('2026-09-04T12:00:00Z');
const dataset = buildSandboxData(now);
const results = ['TXN-1001', 'TXN-1048', 'TXN-1055', 'TXN-1080'].map((id) =>
  reconcileTransaction(id, dataset, now),
);
async function workspace(page: Page, role = 'investigator') {
  let member = {
    id: '11111111-1111-4111-8111-111111111111',
    auth_user_id: '22222222-2222-4222-8222-222222222222',
    email: 'test@example.com',
    display_name: 'Test Investigator',
    avatar_url: '',
    role,
    active: true,
    theme: 'dark',
    timezone: 'Asia/Kolkata',
    default_view: 'overview',
    last_login_at: now.toISOString(),
    trace_count: 0,
    created_at: now.toISOString(),
  };
  const writes: Array<{ path: string; body: unknown }> = [];
  await page.route('**/api/workspace/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/workspace/', '');
    if (request.method() !== 'GET')
      writes.push({ path, body: request.postDataJSON() });
    let data: unknown = { ok: true };
    if (path === 'session') data = { configured: true, member };
    if (path === 'overview')
      data = {
        counts: { successful: 1, pending: 1, delayed: 1, mismatch: 1 },
        transactions: results.map((r) => ({
          ...r,
          issueCodes: r.validationIssues.map((i) => i.code),
          caseStatus: 'todo',
          assigneeId: null,
        })),
        lastScan: null,
        members: [member],
        settings: {},
      };
    if (path === 'profile') {
      member = { ...member, ...request.postDataJSON() };
      data = { member };
    }
    if (path === 'trace' || path.startsWith('result/')) {
      const id =
        path === 'trace'
          ? request.postDataJSON().transactionId
          : path.split('/')[1];
      const result = reconcileTransaction(id, dataset, now);
      data = {
        result,
        explanation: {
          source: 'deterministic',
          explanation: deterministicExplanation(result),
        },
      };
    }
    if (path.startsWith('case/') && request.method() === 'GET')
      data = { case: null, notes: [] };
    if (path === 'extract')
      data = {
        evidence: {
          transactionId: 'TXN-5000',
          settlementId: null,
          bankReference: 'BANK-5000',
          amountMinor: 10000,
          currency: 'INR',
          creditedAt: '2026-09-04T12:00:00Z',
          bankStatus: 'credited',
          utr: null,
          uncertainty: 'Settlement ID unavailable.',
        },
        requiresReview: true,
      };
    if (path === 'imports') data = { count: 1 };
    if (path === 'admin')
      data = {
        members: [member],
        logs: [],
        auditCount: 0,
        settings: {
          bank_sla_minutes: 180,
          ledger_sla_minutes: 30,
          gateway_sla_minutes: 120,
          alert_after_minutes: 2880,
          alerts_enabled: false,
        },
        connections: {
          stripe: false,
          documents: true,
          alerts: false,
          scheduled: false,
        },
      };
    await route.fulfill({ json: data });
  });
  return writes;
}
test('workspace shows a clear setup state without a database connection', async ({
  page,
}) => {
  await page.route('**/api/workspace/session', (route) =>
    route.fulfill({ json: { configured: false, member: null } }),
  );
  await page.goto('/workspace');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText('Workspace setup is in progress')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Continue with Google' }),
  ).toHaveCount(0);
});
test('Viewer can inspect evidence and cannot see mutation controls', async ({
  page,
}) => {
  await workspace(page, 'viewer');
  await page.goto('/workspace');
  await expect(
    page.getByRole('heading', { name: 'Follow the money.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Sources & imports' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Scan all transactions' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect TXN-1001' }).click();
  await expect(page.getByText('Reconciliation timeline')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run trace' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Export report' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('button', { name: 'Add note', exact: true }),
  ).toHaveCount(0);
});
test('Investigator can filter and update selected cases', async ({ page }) => {
  const writes = await workspace(page);
  await page.goto('/workspace');
  await page
    .getByRole('textbox', { name: 'Search transactions' })
    .fill('TXN-1048');
  await expect(
    page.getByRole('button', { name: 'Inspect TXN-1001' }),
  ).toHaveCount(0);
  await page
    .getByRole('checkbox', { name: 'Select TXN-1048', exact: true })
    .check();
  await page.getByRole('button', { name: 'Apply status' }).click();
  await expect(page.getByText('Case statuses updated.')).toBeVisible();
  expect(writes.find((w) => w.path === 'cases/bulk')?.body).toEqual({
    transactionIds: ['TXN-1048'],
    status: 'in_progress',
  });
});
test('profile preferences persist after a page reload', async ({ page }) => {
  const writes = await workspace(page);
  await page.goto('/settings');
  await page.getByLabel('Display name', { exact: true }).fill('Akshit Singh');
  await page
    .getByRole('combobox', { name: 'Theme', exact: true })
    .selectOption('light');
  await page.getByLabel('Timezone', { exact: false }).fill('UTC');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Profile and preferences saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Display name', { exact: true })).toHaveValue(
    'Akshit Singh',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(writes.find((w) => w.path === 'profile')?.body).toMatchObject({
    theme: 'light',
    timezone: 'UTC',
  });
});
test('document extraction requires review and a completed settlement ID', async ({
  page,
}) => {
  const writes = await workspace(page);
  await page.goto('/workspace');
  await page
    .getByRole('button', { name: 'Sources & imports', exact: true })
    .click();
  await page
    .getByLabel('Bank document', { exact: true })
    .setInputFiles({
      name: 'bank.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    });
  await page.getByRole('button', { name: 'Extract for review' }).click();
  await expect(page.getByText('Human review required')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Import reviewed bank record' }),
  ).toBeDisabled();
  expect(writes.filter((w) => w.path === 'imports')).toHaveLength(0);
  await page.getByLabel('settlement id', { exact: true }).fill('SET-5000');
  await page
    .getByRole('checkbox', {
      name: 'I verified these fields against the original evidence.',
    })
    .check();
  await page
    .getByRole('button', { name: 'Import reviewed bank record' })
    .click();
  await expect(
    page.getByText('Reviewed bank evidence imported.'),
  ).toBeVisible();
  expect(writes.find((w) => w.path === 'imports')?.body).toMatchObject({
    source: 'bank',
  });
});
test('workspace layouts fit mobile and desktop screens', async ({ page }) => {
  await workspace(page, 'admin');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/workspace');
    await expect(
      page.getByRole('heading', { name: 'Follow the money.' }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page
      .getByRole('button', { name: 'Administration', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Team members' }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  expect(errors).toEqual([]);
});
