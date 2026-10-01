import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/index.ts',
  format: ['esm', 'cjs'],
  // Pins the .mjs/.cjs names the root size-limit entries and package.json
  // exports point at; without it the names follow the platform default.
  fixedExtension: true,
  platform: 'browser',
  // 1.0.9 already calls String.prototype.replaceAll, so ES2021 is the real
  // floor; tsdx's ES5 downlevel only added helpers and weight.
  target: 'es2021',
  tsconfig: 'tsconfig.build.json',
  dts: true,
});
