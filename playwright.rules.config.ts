import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results/rules',
  testMatch: [
    'rules.spec.ts',
    'story-runtime-rules.spec.ts',
    'story-content-rules.spec.ts',
    'world-map-rules.spec.ts',
    'animation-rules.spec.ts',
    'speech-rules.spec.ts',
    'scene-art-rules.spec.ts',
    'prepared-artwork-rules.spec.ts',
    'registration-rules.spec.ts',
    'editor-jobs-rules.spec.ts',
    'object-mask-rules.spec.ts',
    'remote-segmentation-rules.spec.ts',
    'codex-rules.spec.ts',
  ],
  reporter: 'list',
});
