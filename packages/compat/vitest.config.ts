import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Acceptance for compat is the 1.x suite itself, unedited: its single runtime
// import, `../src/index`, is pointed here, and AUCO_TARGET flips its
// `legacyOnly` and `defect` cases to compat's expectations.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^\.\.\/src\/index$/, replacement: source('./src/index.ts') },
      // The siblings' sources, as typecheck reads them, not a dist that a
      // missing rebuild would leave stale. One copy of each module also keeps
      // `instanceof AucoError` true across protocol, embed and compat.
      {
        find: /^@lob26\/auco-embed$/,
        replacement: source('../embed/src/index.ts'),
      },
      {
        find: /^@lob26\/auco-protocol$/,
        replacement: source('../protocol/src/index.ts'),
      },
    ],
  },
  test: {
    environment: 'happy-dom',
    include: ['../legacy/test/**/*.test.ts', 'test/**/*.test.ts'],
    maxWorkers: 2,
    env: { AUCO_TARGET: 'compat' },
  },
});
