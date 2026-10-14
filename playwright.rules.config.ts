import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'rules.spec.ts',
  reporter: 'list',
});
