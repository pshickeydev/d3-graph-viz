import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.visual\.test\.mjs|.*\.edge-cases\.test\.mjs|.*\.large-fixture\.test\.mjs|.*\.a11y\.test\.mjs/,
  fullyParallel: true,
  reporter: 'list',
  use: {
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
