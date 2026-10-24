import { defineConfig } from 'vitest/config';

// Picks up both the implementer's unit tests (test/unit) and the QA suite (test/qa).
// Tests run in plain Node; jobs get a real local D1 via Miniflare (see test/unit/README.md).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
