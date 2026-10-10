import { defineConfig } from '@playwright/test';

/**
 * Multi-client browser E2E (testing-strategy.md §2.3): a throwaway game server (in-memory
 * PGlite, test env so guest play is enabled) plus the Vite dev client on their own ports, so a
 * running dev setup on 8090/3000 is never disturbed. Uses an installed browser channel
 * (PW_CHANNEL, default msedge; "chrome" also works) — no Playwright browser download needed.
 * PW_CHANNEL=chromium uses Playwright's own Chromium (CI: `playwright install chromium`).
 */
const channel = process.env['PW_CHANNEL'] ?? 'msedge';
const SERVER_PORT = Number(process.env['E2E_SERVER_PORT'] ?? 8091);
const CLIENT_PORT = Number(process.env['E2E_CLIENT_PORT'] ?? 3001);

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    ...(channel === 'chromium' ? {} : { channel }),
    headless: process.env['HEADED'] !== '1',
    viewport: { width: 960, height: 600 },
  },
  webServer: [
    {
      command: 'pnpm --filter @crusaders/server start',
      url: `http://127.0.0.1:${SERVER_PORT}/healthz`,
      env: { NODE_ENV: 'test', SERVER_PORT: String(SERVER_PORT), DATABASE_URL: 'pglite:memory', LOG_LEVEL: 'warn' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @crusaders/client exec vite --port ${CLIENT_PORT} --strictPort`,
      url: `http://localhost:${CLIENT_PORT}`,
      env: { SERVER_PORT: String(SERVER_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
