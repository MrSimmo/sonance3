import { defineConfig, devices } from '@playwright/test';

// Sonance e2e suite (prompt-3.10 T2, ticket-3.10 §8).
//
// Chromium only, 1920×1080 at DPR 1 — the Q90R's viewport. One worker and no
// parallelism: several specs measure timing (90 ms key gaps, 120 ms
// Enter/Back), and deterministic timing matters more here than wall-clock.
//
// The web server is started with `process.execPath` rather than a bare
// `node`: on this machine `node` resolves to a broken nvm lazy-loader that
// recurses and runs nothing.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8091',
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: `"${process.execPath}" tests/dev-server.js 8091`,
    url: 'http://localhost:8091/index.html',
    reuseExistingServer: true,
  },
});
