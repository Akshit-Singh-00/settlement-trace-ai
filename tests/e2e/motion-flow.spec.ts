import { expect, test, type Page } from '@playwright/test';

async function ready(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true', { timeout: 15_000 });
  await expect(page.locator('.boot-overlay')).toHaveCount(0);
  const view = path.split('#')[1] || 'top';
  await expect(page.locator(`[data-view="${view === 'top' ? 'landing' : view}"]`)).toBeVisible();
}

test('branded boot reveals an interactive landing and does not replay on navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.boot-overlay .loader-brand')).toHaveText('Settlement Trace AI');
  await expect(page.locator('.boot-overlay .sequence-stage')).toHaveCount(4);
  await expect(page.locator('.boot-overlay')).toHaveCount(0);
  await page.getByRole('link', { name: 'Investigate a Transaction' }).click();
  await expect(page.locator('[data-view="investigation"]')).toBeVisible();
  await expect(page.getByRole('textbox')).toBeVisible();
  await page.getByRole('link', { name: 'Settlement Trace AI home' }).click();
  await expect(page.locator('[data-view="landing"]')).toBeVisible();
  await expect(page.locator('.boot-overlay')).toHaveCount(0);
});

test('all views preserve the selected investigation and support history and refresh', async ({ page }) => {
  await ready(page);
  await page.locator('#demo-cases').getByRole('button').filter({ hasText: 'TXN-1055' }).click();
  await expect(page.getByRole('heading', { name: 'TXN-1055' })).toBeVisible();
  for (const [label, id] of [['Dashboard', 'dashboard'], ['Demo cases', 'demos'], ['CSV upload', 'upload'], ['Reports', 'reports']]) {
    await page.locator('.desktop-navigation').getByRole('link', { name: label, exact: true }).click();
    await expect(page.locator(`[data-view="${id}"]`)).toBeVisible();
    await expect(page.locator('.desktop-navigation [aria-current="page"]')).toHaveText(label);
  }
  await expect(page.getByRole('heading', { name: 'TXN-1055' })).toBeVisible();
  await page.goBack();
  await expect(page.locator('[data-view="upload"]')).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-view="upload"]')).toBeVisible();
});

test('trace stops at bank and never activates a downstream waiting ledger', async ({ page }) => {
  await ready(page, '/#investigation');
  // Capture transient DOM state as it appears so slow CI assertions cannot miss the trace.
  const traceHistory = await page.evaluateHandle(() => {
    const snapshots: Record<string, Record<string, string | boolean | null>> = {};
    const observer = new MutationObserver(() => {
      const trace = document.querySelector('.trace-loading-panel .trace-sequence');
      const transaction = trace?.getAttribute('data-transaction');
      if (!trace || !transaction || snapshots[transaction]) return;
      const bounds = trace.getBoundingClientRect();
      snapshots[transaction] = {
        settlement: trace.querySelector('[data-stage="settlement"]')?.getAttribute('data-status') ?? null,
        bank: trace.querySelector('[data-stage="bank"]')?.getAttribute('data-status') ?? null,
        ledger: trace.querySelector('[data-stage="ledger"]')?.getAttribute('data-status') ?? null,
        bankFlow: trace.querySelector('[data-stage="bank"] .sequence-connector')?.getAttribute('data-flow') ?? null,
        inViewport: bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight
          && bounds.right > 0 && bounds.left < innerWidth,
      };
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    return { snapshots, disconnect: () => observer.disconnect() };
  });
  await page.getByRole('textbox').fill('TXN-1055');
  await page.getByRole('textbox').press('Enter');
  await expect.poll(() => traceHistory.evaluate(({ snapshots }) => snapshots['TXN-1055'])).toMatchObject({
    ledger: 'waiting', bankFlow: 'false', inViewport: true,
  });
  await expect(page.getByRole('heading', { name: 'TXN-1055' })).toBeVisible();
  await page.getByRole('textbox').fill('TXN-1071');
  await page.getByRole('textbox').press('Enter');
  await expect.poll(() => traceHistory.evaluate(({ snapshots }) => snapshots['TXN-1071'])).toMatchObject({
    settlement: 'failed', bank: 'waiting',
  });
  await expect(page.locator('.status-pill')).toHaveText('Failed');
  await traceHistory.evaluate(({ disconnect }) => disconnect());
  await traceHistory.dispose();
});

test('leaving during a trace cancels stale completion and restores navigation', async ({ page }) => {
  await ready(page, '/#investigation');
  await page.getByRole('textbox').fill('TXN-1055');
  await page.getByRole('textbox').press('Enter');
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settlement health at a glance' })).toBeVisible();
  await page.getByRole('link', { name: 'Investigation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Investigate', exact: false }).first()).toBeEnabled();
  await expect(page.locator('.trace-loading-panel')).toHaveCount(0);
});

test('mobile drawer traps focus, closes with Escape, and unlocks scrolling after selection', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await ready(page);
  const trigger = page.getByRole('button', { name: 'Open navigation menu' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Settlement health at a glance' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
});

test('reduced motion keeps every view functional and responds to system theme', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await ready(page, '/#investigation');
  await expect(page.locator('.workspace-pipeline .pipeline-fallback')).toBeVisible();
  await expect(page.locator('.workspace-pipeline canvas')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('textbox').fill('TXN-1055');
  await page.getByRole('textbox').press('Enter');
  await expect(page.getByRole('heading', { name: 'TXN-1055' })).toBeVisible();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settlement health at a glance' })).toBeVisible();
});

test('provider failure preserves deterministic findings and support action', async ({ page }) => {
  await page.route('**/api/explain', (route) => route.fulfill({ status: 503, body: 'Provider unavailable' }));
  await ready(page, '/#investigation');
  await page.getByRole('textbox').fill('TXN-1055');
  await page.getByRole('textbox').press('Enter');
  await expect(page.getByText('Deterministic explanation', { exact: true })).toBeVisible();
  await expect(page.getByText(/Bank credit has not completed/)).toBeVisible();
  await expect(page.locator('.action-box p')).not.toBeEmpty();
});

test('all animated surfaces fit the requested responsive sizes without runtime errors', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  for (const width of [375, 430, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: width < 700 ? 812 : 900 });
    for (const view of ['top', 'investigation', 'dashboard', 'demos', 'upload', 'reports']) {
      await ready(page, '/#' + view);
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      expect(dimensions.scroll, `${view} at ${width}px`).toBeLessThanOrEqual(dimensions.width);
      const frame = page.locator('[data-view]');
      await expect(frame).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});
