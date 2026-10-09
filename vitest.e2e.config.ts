import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __DIAGNOSTICS_FILE_OUTPUT__: 'true',
  },
  test: {
    include: ['**/test/export-pdf-e2e.test.ts'],
  },
});
