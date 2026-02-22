import { defineConfig } from '@playwright/test';

const baseURL = process.env.PW_BASE_URL || 'http://127.0.0.1:3000';
const useHeaded = process.env.PW_HEADFUL === '1';
const useChromeChannel = process.env.PW_CHANNEL !== 'chromium';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 12 * 60 * 1000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    headless: !useHeaded,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...(useChromeChannel ? { channel: 'chrome' } : {}),
  },
  webServer: process.env.PW_SKIP_WEBSERVER === '1'
    ? undefined
    : {
        command: 'npm run dev',
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
