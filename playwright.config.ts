import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e-playwright',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
