import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  format: ['esm'],
  // Pins dist names: package.json exports and the root size-limit read them.
  fixedExtension: true,
  platform: 'neutral',
  target: 'es2022',
  tsconfig: 'tsconfig.build.json',
  dts: true,
});
