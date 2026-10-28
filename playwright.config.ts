import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: [
    'rules.spec.ts',
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
  fullyParallel: true,
  workers: 4,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'touch', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
