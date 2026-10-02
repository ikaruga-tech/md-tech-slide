import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/test/export-pdf-e2e.test.ts'],
  },
});
