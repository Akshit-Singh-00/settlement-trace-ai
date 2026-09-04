import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    coverage: {
      include: ['lib/reconciliation.ts', 'lib/csv-import.ts'],
    },
  },
});
