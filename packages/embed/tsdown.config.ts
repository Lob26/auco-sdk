import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  format: ['esm'],
  // Pins dist names: package.json exports and the root size-limit read them.
  fixedExtension: true,
  platform: 'browser',
  target: 'es2022',
  tsconfig: 'tsconfig.build.json',
  dts: true,
  // protocol is a devDependency on purpose: it is bundled, not imported at
  // runtime, so the root size budget measures protocol + embed together.
});
