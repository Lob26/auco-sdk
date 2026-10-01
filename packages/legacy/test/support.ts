import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Mock, vi } from 'vitest';
import { AucoSDK } from '../src/index';
import type { Config } from '../src/types';

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
