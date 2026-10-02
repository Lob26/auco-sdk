import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // protocol's sources, as typecheck reads them: through the package's
      // default export vitest would test against a dist that may be stale.
      {
        find: /^@lob26\/auco-protocol$/,
        replacement: fileURLToPath(
          new URL('../protocol/src/index.ts', import.meta.url)
        ),
      },
    ],
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    // 8 GB machine: never let the runner pick one worker per core.
    maxWorkers: 2,
  },
});
