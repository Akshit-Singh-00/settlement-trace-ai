import { defineConfig, devices } from '@playwright/test';

const webServerCommand = process.platform === 'win32'
  ? 'node_modules\\.bin\\vinext.cmd dev --port 4173'
  : 'pnpm exec vinext dev --port 4173';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    video: 'off',
  },
  webServer: {
    command: webServerCommand,
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
    env: { ...process.env, GEMINI_API_KEY: '' },
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'msedge' as const }),
      },
    },
  ],
});
