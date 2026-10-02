import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/generated/**',
      '**/test/suite/**',
      '**/out/**',
      '**/test/export-pdf-e2e.test.ts',
    ],
  },
});
