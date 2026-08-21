import { defineConfig, devices } from '@playwright/test';

/**
 * Two servers run for the suite:
 *   :4173 serves the site at the root, like a user-site deployment;
 *   :4174 serves it under /property-investment-tax-model/, exactly the way
 *         GitHub Pages serves a project site — this is what catches
 *         root-absolute asset paths before they reach production.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    // Some CI images ship a Chromium build that does not match the pinned
    // Playwright version. PLAYWRIGHT_CHROMIUM_PATH lets those runners point at
    // the browser they already have instead of downloading another one.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: [
    { command: 'node tools/serve.js 4173', url: 'http://127.0.0.1:4173/', reuseExistingServer: !process.env.CI, timeout: 20000 },
    { command: 'node tools/serve.js 4174 /property-investment-tax-model', url: 'http://127.0.0.1:4174/property-investment-tax-model/', reuseExistingServer: !process.env.CI, timeout: 20000 },
  ],
});
