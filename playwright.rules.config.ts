import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results/rules',
  testMatch: 'rules.spec.ts',
  reporter: 'list',
});
