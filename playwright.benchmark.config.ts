import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/benchmark', timeout: 180_000, workers: 1,
  outputDir: 'test-results/benchmark', reporter: 'list',
});
