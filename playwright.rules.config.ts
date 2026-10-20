import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results/rules',
  testMatch: [
    'rules.spec.ts',
    'animation-rules.spec.ts',
    'speech-rules.spec.ts',
    'scene-art-rules.spec.ts',
    'editor-jobs-rules.spec.ts',
    'object-mask-rules.spec.ts',
  ],
  reporter: 'list',
});
