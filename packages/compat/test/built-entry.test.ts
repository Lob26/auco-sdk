import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Entry from '../src/index';
import {
  baseEvents,
  flush,
  mountIframe,
  sendReady,
  signConfig,
  teardown,
} from './support';

// What ships, not what typechecks: tsdown bundles embed and protocol into
// compat's dist, and the day it bundles two copies of protocol, onSDKError
// receives an AucoError the exported class does not match (instanceof is
// false, and the d.ts declares the class twice). These tests read dist, so
// the build has to run first, as it does in scripts/ci.sh.

const packageDir = join(import.meta.dirname, '..');
const distDir = join(packageDir, 'dist');
const DECLARATIONS = ['index.d.mts', 'index.d.cts'];

const newestMtime = (dir: string): number =>
  Math.max(
    ...readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => statSync(join(entry.parentPath, entry.name)).mtimeMs)
  );

beforeAll(() => {
  const built = Math.min(
    ...['index.mjs', 'index.cjs', ...DECLARATIONS].map((file) => {
      try {
        return statSync(join(distDir, file)).mtimeMs;
      } catch {
        throw new Error(
          `${file} is missing from packages/compat/dist; run pnpm --filter @lob26/auco-compat build first`
        );
      }
    })
  );
  // compat's dist bundles the sources of all three packages.
  const sources = ['compat', 'embed', 'protocol'].map((pkg) =>
    join(packageDir, '..', pkg, 'src')
  );
  if (sources.some((dir) => newestMtime(dir) > built)) {
    throw new Error(
      'packages/compat/dist is older than the sources it bundles; run pnpm --filter @lob26/auco-compat build first'
    );
  }
});

afterEach(() => {
  teardown();
  vi.restoreAllMocks();
});

describe('the built declarations', () => {
  it.each(DECLARATIONS)('%s declares AucoError exactly once', (file) => {
    const text = readFileSync(join(distDir, file), 'utf8');

    expect(text.match(/\bclass AucoError\b/g)).toHaveLength(1);
  });

  it.each(DECLARATIONS)('%s imports no sibling package', (file) => {
    const text = readFileSync(join(distDir, file), 'utf8');

    expect(text).not.toMatch(/from ['"]@lob26\//);
  });

  it('type-check against the built entry: onSDKError receives the exported AucoError', async () => {
    const root = createRequire(join(packageDir, '..', '..', 'package.json'));
    const tsc = join(
      dirname(root.resolve('typescript/package.json')),
      'bin',
      'tsc'
    );

    const { stdout } = await promisify(execFile)(
      process.execPath,
      [tsc, '-p', join(packageDir, 'test', 'types'), '--listFiles'],
      { timeout: 60_000 }
    ).catch((failure: { stdout?: string }) => {
      throw new Error(`tsc -p test/types failed:\n${failure.stdout ?? ''}`);
    });

    // Guards the guard: a resolution to src would check the wrong file.
    const files = stdout.split('\n');
    expect(files).toContain(join(distDir, 'index.d.mts'));
    expect(files).not.toContain(join(packageDir, 'src', 'index.ts'));
  }, 60_000);
});

describe.each([
  {
    format: 'ESM',
    load: async () =>
      (await import(
        /* @vite-ignore */ pathToFileURL(join(distDir, 'index.mjs')).href
      )) as typeof Entry,
  },
  {
    format: 'CJS',
    load: async () =>
      createRequire(import.meta.url)(
        join(distDir, 'index.cjs')
      ) as typeof Entry,
  },
])('the built $format entry', ({ load }) => {
  it('hands onSDKError an instance of its exported AucoError', async () => {
    const entry = await load();
    const frame = mountIframe();
    const onSDKError = vi.fn();
    const unsubscribe = entry.AucoSDK(
      signConfig(frame, {
        events: {
          ...baseEvents(),
          onSDKReady: () => {
            throw new Error('integrador falló');
          },
          onSDKError,
        },
      }) as unknown as Entry.Config
    );

    sendReady(frame);
    await flush();
    unsubscribe();

    expect(onSDKError).toHaveBeenCalledTimes(1);
    expect(onSDKError.mock.calls[0]?.[0]).toBeInstanceOf(entry.AucoError);
  });

  it.each([
    { refused: 'an unknown sdkType', overrides: { sdkType: 'contrato' } },
    {
      refused: 'a customOrigin that is not an origin',
      overrides: { customOrigin: 'https://lista.example.com/' },
    },
  ])(
    'throws $refused as an instance of its exported AucoError',
    async ({ overrides }) => {
      const entry = await load();
      const frame = mountIframe();

      expect(() =>
        entry.AucoSDK(signConfig(frame, overrides) as unknown as Entry.Config)
      ).toThrow(entry.AucoError);
    }
  );
});
