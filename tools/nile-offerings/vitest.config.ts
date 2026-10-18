import { defineConfig } from 'vitest/config';

// Isolated config so this tool does not touch the shared root vitest.config.ts.
// Run:  npx vitest run --config tools/nile-offerings/vitest.config.ts
export default defineConfig({
  test: {
    root: new URL('../..', import.meta.url).pathname,
    include: ['tools/nile-offerings/**/*.test.ts'],
  },
});
