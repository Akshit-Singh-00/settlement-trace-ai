import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:4173';
const outputDirectory = resolve('public/screenshots');
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'msedge' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  colorScheme: 'dark',
});
const page = await context.newPage();

await page.addInitScript(() => localStorage.setItem('settlement-trace-theme', 'dark'));
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.locator('html[data-app-ready="true"]').waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: resolve(outputDirectory, 'landing-dark.png') });

await page.getByRole('button', { name: 'Use light theme' }).click();
await page.locator('#demo-cases').getByRole('button').filter({ hasText: 'TXN-1097' }).click();
await page.getByRole('heading', { name: 'TXN-1097' }).waitFor();
await page.waitForTimeout(450);
await page.screenshot({ path: resolve(outputDirectory, 'investigation-light.png') });

await page.getByRole('button', { name: 'Use dark theme' }).click();
await page.locator('.evidence-grid').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(outputDirectory, 'conflict-evidence-dark.png') });

await page.setViewportSize({ width: 375, height: 812 });
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.locator('html[data-app-ready="true"]').waitFor();
await page.waitForTimeout(350);
await page.screenshot({ path: resolve(outputDirectory, 'landing-mobile-dark.png') });

await browser.close();
