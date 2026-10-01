import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  format: ['esm', 'cjs'],
  // Pins dist names: package.json exports and the root size-limit read them.
  fixedExtension: true,
  platform: 'browser',
  target: 'es2022',
  tsconfig: 'tsconfig.build.json',
  dts: true,
  // embed's dist already inlines protocol, and compat imports protocol too:
  // bundling both dists would ship two AucoError classes and break
  // instanceof. Their sources share one protocol module.
  inputOptions: {
    resolve: { conditionNames: ['source', 'import', 'browser', 'default'] },
  },
});
