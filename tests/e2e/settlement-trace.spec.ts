import { expect, test, type Page } from '@playwright/test';

async function search(page: Page, query: string) {
  const input = page.getByRole('textbox', { name: 'Transaction ID, date, or support question' });
  await input.fill(query);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
});

test('searches a successful transaction and shows a reconciled result', async ({ page }) => {
  await search(page, 'TXN-1001');
  await expect(page.getByRole('heading', { name: 'TXN-1001' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All settlement stages reconciled' })).toBeVisible();
  await expect(page.locator('.status-pill')).toHaveText('Settled');
});

test('shows the root cause for a delayed transaction', async ({ page }) => {
  await search(page, 'Why is TXN-1048 pending?');
  await expect(page.getByRole('heading', { name: 'TXN-1048' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Captured payment is missing from a settlement batch' })).toBeVisible();
  await expect(page.locator('.status-pill')).toHaveText('Delayed');
});

test('exposes exceptions for an uncertain conflicting case', async ({ page }) => {
  await search(page, 'What happened to TXN-1097?');
  await expect(page.getByText('Exceptions & Uncertainty', { exact: true })).toBeVisible();
  await expect(page.locator('.exceptions-card').getByText('Conflicting records', { exact: true })).toBeVisible();
  await expect(page.locator('.status-pill')).toHaveText('Uncertain');
});

test('keeps timeline and evidence selection synchronized', async ({ page }) => {
  await search(page, 'TXN-1001');
  await page.locator('.trace-stage').filter({ hasText: 'Bank credit' }).click();
  await expect(page.getByRole('tab', { name: /Bank/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.evidence-card').getByText('BNK-501', { exact: true })).toBeVisible();
});

test('persists a light theme selection after reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Use light theme' }).click();
  await expect(page.locator('html')).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/light/);
  await expect(page.getByRole('button', { name: 'Use light theme' })).toHaveAttribute('aria-pressed', 'true');
});

test('searches by date and opens a matching transaction', async ({ page }) => {
  await search(page, 'Show failed transactions from September 3');
  await expect(page.getByText('Matching transactions', { exact: true })).toBeVisible();
  await page.locator('.query-result-grid').getByRole('button').filter({ hasText: 'TXN-1071' }).click();
  await expect(page.getByRole('heading', { name: 'TXN-1071' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settlement batch failed' })).toBeVisible();
});

test('imports a valid synthetic CSV and investigates its transaction', async ({ page }) => {
  await page.getByLabel('Upload Gateway CSV').setInputFiles({
    name: 'gateway.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from([
      'transaction_id,merchant_id,merchant_name,amount,currency,status,gateway_reference,captured_at,expected_settlement_minutes',
      'TXN-5000,MRC-500,Example Merchant,120000,INR,captured,GTW-5000,2026-09-04T10:00:00Z,120',
    ].join('\n')),
  });
  await expect(page.getByText('1 gateway record validated and loaded.')).toBeVisible();
  await search(page, 'TXN-5000');
  await expect(page.getByRole('heading', { name: 'TXN-5000' })).toBeVisible();
  await expect(page.getByText('Example Merchant', { exact: true })).toBeVisible();
});

test('shows recoverable row validation for malformed CSV', async ({ page }) => {
  await page.getByLabel('Upload Bank CSV').setInputFiles({
    name: 'bad-bank.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('bank_reference,settlement_id,transaction_id,amount,status,credited_at\nBNK-1,BAD,TXN-5000,nope,credited,not-a-date'),
  });
  await expect(page.getByText('The CSV was not imported. Fix the highlighted validation issues and try again.')).toBeVisible();
  await expect(page.locator('.upload-message.error li')).toBeVisible();
});

test('shows a useful unknown transaction state', async ({ page }) => {
  await search(page, 'TXN-9999');
  await expect(page.getByText('Transaction not found', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try another search' })).toBeVisible();
});

test('uses a deterministic explanation when no AI key is configured', async ({ page }) => {
  await search(page, 'TXN-1055');
  await expect(page.getByText('Deterministic explanation', { exact: true })).toBeVisible();
  await expect(page.getByText(/Bank credit has not completed/)).toBeVisible();
});
