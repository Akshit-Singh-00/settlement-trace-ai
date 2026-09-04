import { expect, test, type Page } from '@playwright/test';

async function search(page: Page, query: string) {
  if (!await page.getByRole('textbox', { name: 'Transaction ID, date, or support question' }).isVisible()) {
    await page.locator('.desktop-navigation').getByRole('link', { name: 'Investigation', exact: true }).click();
  }
  const input = page.getByRole('textbox', { name: 'Transaction ID, date, or support question' });
  await input.fill(query);
  await input.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
});

test('landing page communicates the product and leads into investigation', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Follow the money. Find the break.' })).toBeVisible();
  await expect(page.getByText('Simulated dataset — not live financial data.', { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Investigate a Transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Ask where the settlement stopped.' })).toBeInViewport();
});

test('mobile navigation remains keyboard-accessible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  const menu = page.getByRole('button', { name: 'Open navigation menu' });
  await expect(page.locator('.boot-overlay')).toHaveCount(0);
  await menu.focus();
  await menu.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'How it works' })).toBeVisible();
});

test('avoids page-level overflow at submission breakpoints', async ({ page }) => {
  for (const width of [375, 430, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: width < 700 ? 812 : 900 });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
    const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, page: document.documentElement.scrollWidth }));
    expect(dimensions.page, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewport);
  }
});

test('loads landing and investigation without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await page.locator('#demo-cases').getByRole('button').filter({ hasText: 'TXN-1055' }).click();
  await expect(page.getByRole('heading', { name: 'TXN-1055' })).toBeVisible();
  expect(errors).toEqual([]);
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
  await search(page, 'Show failed transactions from September 3 2026');
  await expect(page.getByText('Matching transactions', { exact: true })).toBeVisible();
  await page.locator('.query-result-grid').getByRole('button').filter({ hasText: 'TXN-1071' }).click();
  await expect(page.getByRole('heading', { name: 'TXN-1071' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settlement batch failed' })).toBeVisible();
});

test('imports a valid synthetic CSV and investigates its transaction', async ({ page }) => {
  await page.goto('/#upload');
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
  await page.goto('/#upload');
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
