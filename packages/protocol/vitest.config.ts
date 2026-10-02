import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // 8 GB machine: never let the runner pick one worker per core.
    maxWorkers: 2,
  },
});
