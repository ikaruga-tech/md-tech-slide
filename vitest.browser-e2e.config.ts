import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DIAGNOSTICS_FILE_OUTPUT__: 'true',
  },
  test: {
    server: {
      deps: {
        inline: ['puppeteer-core'],
      },
    },
    globalSetup: ['./test/helpers/diagnostics-global-setup.ts'],
    setupFiles: ['./test/helpers/diagnostics-worker-setup.ts'],
    include: ['**/test/diagram-launch-e2e.test.ts'],
    testTimeout: 30000,
  },
});
