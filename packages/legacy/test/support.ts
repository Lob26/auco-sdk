import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it, type Mock, type TestFunction, vi } from 'vitest';
import { AucoSDK } from '../src/index';
import type { Config } from '../src/types';

const TARGETS = ['legacy', 'compat'] as const;
export type Target = (typeof TARGETS)[number];

const parseTarget = (raw: string | undefined): Target => {
  if (raw === undefined) return 'legacy';
  const target = TARGETS.find((known) => known === raw);
  if (!target) {
    throw new Error(
      `AUCO_TARGET must be unset or one of ${TARGETS.join(', ')}; got ${JSON.stringify(raw)}`
    );
  }
  return target;
};

/**
 * The implementation `../src/index` resolves to in this run: `legacy` (the
 * frozen 1.0.9, the default) or `compat` (`@lob26/auco-compat`, whose vitest
 * config aliases `../src/index` to its own entry and sets
 * `AUCO_TARGET=compat`). Any other value fails the run at collection, so a
 * typo cannot silently run the legacy expectations against compat.
 *
 * A test with no target logic is contract: it runs identically on both.
 * Target logic is only ever `legacyOnly` or `defect`, so it stays greppable.
 */
export const TARGET: Target = parseTarget(process.env.AUCO_TARGET);

/** Runtime findings of the 1.x audit (Lob26/auco-sdk#1) a test can pin. */
export type AuditId =
  | '1.1'
  | '1.2'
  | '1.3'
  | '1.4'
  | '1.5'
  | '1.6'
  | '1.7'
  | '1.8'
  | '1.9'
  | '6.2';

/**
 * Where an audit finding gets fixed: `compat` (Phase 1, same 1.x signature),
 * `v2` (only the new API; compat keeps the 1.x semantics on purpose) or `auco`
 * (needs a frame-side protocol message that does not exist yet).
 */
export type FixedIn = 'compat' | 'v2' | 'auco';

export interface Defect {
  id: AuditId;
  fixedIn: FixedIn;
}

type EachBody<T> = (testCase: T) => void | Promise<void>;

const runsOnLegacy = TARGET === 'legacy';
const legacyOnlyName = (auditId: AuditId, name: string) =>
  `legacy-only ${auditId}: ${name}`;

/**
 * Pins a 1.0.9 behavior that compat deliberately changes (audit `auditId`):
 * the test runs on `legacy` and is skipped on `compat`. `.each` is the
 * parameterized form; `.assert` guards the 1.0.9-only assertions inside a
 * test whose other assertions are contract, so that half keeps running.
 */
export const legacyOnly = Object.assign(
  (auditId: AuditId, name: string, fn: TestFunction): void => {
    it.runIf(runsOnLegacy)(legacyOnlyName(auditId, name), fn);
  },
  {
    each:
      <T>(auditId: AuditId, cases: readonly T[]) =>
      (name: string, fn: EachBody<T>): void => {
        it.runIf(runsOnLegacy).each(cases)(legacyOnlyName(auditId, name), fn);
      },
    assert: (_auditId: AuditId, body: () => void): void => {
      if (runsOnLegacy) body();
    },
  }
);

const defectTest = ({ fixedIn }: Defect) =>
  TARGET === 'compat' && fixedIn === 'compat' ? it : it.fails;

/**
 * A test that asserts the CORRECT behavior for an audit defect. It is
 * `it.fails` on `legacy`, and on `compat` too unless `fixedIn` is `compat`,
 * where it becomes a plain `it`: compat has to fix exactly those. The
 * reported name is prefixed with the audit id.
 */
export const defect = Object.assign(
  (meta: Defect, name: string, fn: TestFunction): void => {
    defectTest(meta)(`${meta.id} ${name}`, fn);
  },
  {
    each:
      <T>(meta: Defect, cases: readonly T[]) =>
      (name: string, fn: EachBody<T>): void => {
        defectTest(meta).each(cases)(`${meta.id} ${name}`, fn);
      },
  }
);

// Paths, not file: URLs: happy-dom replaces the global URL, which node:fs
// does not accept.
const protocolDir = join(import.meta.dirname, '..', '..', 'protocol');
const fixturesDir = join(protocolDir, 'fixtures');

export const SDK_TYPES = [
  'upload',
  'upload-v2',
  'read',
  'attachments',
  'validation-attachments',
  'validation',
  'sign',
  'fill',
  'list-validation',
] as const;
export type SdkType = (typeof SDK_TYPES)[number];

/** `puk_` + 32 zeros: the 36-char fake key the protocol fixtures use. */
export const KEY_PUBLIC = `puk_${'0'.repeat(32)}`;

/** 1.0.9 cache-buster: `new Date().toISOString()` with `:` replaced by `-`. */
export const ID_QUERY = String.raw`\?id=\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z`;

export interface Fixture {
  file: string;
  id: string;
  variant: string | null;
  direction: string;
  products: string[];
  source: string;
  confidence: string;
  data: Record<string, unknown>;
}

export const readProtocol = (): string =>
  readFileSync(join(protocolDir, 'PROTOCOL.md'), 'utf8');

export const loadFixtures = (): Fixture[] =>
  readdirSync(fixturesDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      ...(JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as Omit<
        Fixture,
        'file'
      >),
    }));

const fixtures = loadFixtures();

/** The single fixture with this id (and variant), or a loud failure. */
export const fixture = (id: string, variant: string | null = null): Fixture => {
  const found = fixtures.find((f) => f.id === id && f.variant === variant);
  if (!found) {
    throw new Error(`No fixture with id ${id} and variant ${variant}`);
  }
  return found;
};

export interface FakeFrame {
  iframe: HTMLIFrameElement;
  /** Stands in for `iframe.contentWindow`; also the `source` of its messages. */
  window: Window;
  postMessage: Mock<(message: unknown, targetOrigin: string) => void>;
}

/**
 * Mounts `<iframe id>` with a fake `contentWindow` and an own `src` data
 * property. Without the latter, assigning `src` makes happy-dom navigate the
 * frame to the real Auco host over the network; the test only needs the
 * string 1.0.9 assigns.
 */
export const mountIframe = (id: string): FakeFrame => {
  const iframe = document.createElement('iframe');
  iframe.id = id;
  const postMessage = vi.fn<(message: unknown, targetOrigin: string) => void>();
  const frameWindow = { postMessage } as unknown as Window;
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: frameWindow,
  });
  Object.defineProperty(iframe, 'src', {
    configurable: true,
    writable: true,
    value: '',
  });
  document.body.appendChild(iframe);
  return { iframe, window: frameWindow, postMessage };
};

const subscriptions: Array<() => void> = [];

/**
 * Calls `AucoSDK` with a config the tests build as a plain object: several
 * cases are deliberately outside the `Config` union (bad language, unknown
 * sdkType, array `custom`).
 */
export const start = (config: Record<string, unknown>): (() => void) => {
  const unsubscribe = AucoSDK(config as unknown as Config);
  subscriptions.push(unsubscribe);
  return unsubscribe;
};

/** Removes every listener `start` left behind and the mounted iframes. */
export const teardown = (): void => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  document.body.innerHTML = '';
};

export const sendFromFrame = (
  origin: string,
  data: unknown,
  source: Window | null
): void => {
  window.dispatchEvent(new MessageEvent('message', { origin, data, source }));
};

/** A macrotask: every microtask the async listener queued has run by then. */
export const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Sets `location.href` without navigating (a real navigation would replace
 * the document and the mounted iframes).
 */
export const setPageURL = (url: string): void => {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(url);
};

/**
 * Runs `body` and returns the unhandled rejections raised meanwhile.
 *
 * Vitest's worker skips its own reporting when another `unhandledRejection`
 * listener exists, so registering one here captures them for this call only;
 * the listener is removed before returning, so rejections anywhere else still
 * fail the run.
 */
export const captureUnhandledRejections = async (
  body: () => Promise<void> | void
): Promise<unknown[]> => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => {
    rejections.push(reason);
  };
  process.on('unhandledRejection', onRejection);
  try {
    await body();
    await flush();
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  return rejections;
};

/**
 * A promise settled from outside, to hold an integrator callback pending while
 * the test sends more messages. (`Promise.withResolvers` is ES2024; the
 * project targets ES2022.)
 */
export const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

/** A frame whose iframe was unmounted: `contentWindow` reads `null`. */
export const detachContentWindow = (frame: FakeFrame): void => {
  Object.defineProperty(frame.iframe, 'contentWindow', {
    configurable: true,
    value: null,
  });
};

export const baseEvents = () => ({
  onSDKReady: vi.fn(),
  onSDKClose: vi.fn(),
});
