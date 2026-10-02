// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dist = fileURLToPath(new URL('../dist/index.mjs', import.meta.url));

// Plain node, outside vitest: every DOM global is a getter that records the
// access, so even a `typeof window` at module scope shows up.
const probe = `
const touched = [];
for (const name of ['window', 'document', 'location']) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() { touched.push(name); return undefined; },
  });
}
const entry = await import(process.argv[1]);
console.log(JSON.stringify({ touched, exports: Object.keys(entry).sort() }));
`;

describe('SSR import', () => {
  it('importing dist in plain node touches no window, document or location', () => {
    expect(existsSync(dist), `${dist} is missing: build embed first`).toBe(
      true
    );
    const output = execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', probe, dist],
      { encoding: 'utf8', timeout: 10_000 }
    );
    const { touched, exports } = JSON.parse(output) as {
      touched: string[];
      exports: string[];
    };
    expect(touched).toEqual([]);
    expect(exports).toContain('createSession');
  });
});
