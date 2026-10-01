import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    // This config always runs the suite against 1.0.9: a stray
    // AUCO_TARGET=compat in the shell would run compat's expectations here.
    env: { AUCO_TARGET: 'legacy' },
  },
});
