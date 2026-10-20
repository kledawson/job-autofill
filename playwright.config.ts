import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  // CI runners occasionally crash a Chromium tab mid-test. One retry reruns the spec file's serial
  // group; the report still lists the test as flaky so real failures stay visible.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
});
