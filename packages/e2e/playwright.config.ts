import { defineConfig, devices } from '@playwright/test';

// 8 GB machine and a real-browser suite: one worker, Chromium only, and no
// retries, so a flaky test shows up as a failure instead of hiding.
export default defineConfig({
  testDir: 'tests',
  workers: 1,
  retries: 0,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Two servers, two origins: host pages (this package, built SDK dist) and
  // the fake frame (packages/fake-frame). Ports are a contract of both.
  //
  // Readiness is vite's own banner, not a `url` probe: Playwright probes the
  // url BEFORE launching, and on WSL with mirrored networking a connect to a
  // closed 127.0.0.1 port is dropped instead of refused, so that probe hangs
  // for minutes. Without `url` nothing is reused either: each run starts its
  // own servers on the built dist, and strictPort makes a busy port a loud
  // failure instead of a silent reuse of a stale server.
  webServer: [
    {
      command: 'pnpm exec vite',
      wait: { stdout: /localhost:5173/ },
    },
    {
      command: 'pnpm --filter @lob26/auco-fake-frame serve',
      wait: { stdout: /localhost:5174/ },
    },
  ],
});
