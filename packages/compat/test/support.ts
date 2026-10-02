import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Mock, vi } from 'vitest';
import { AucoSDK } from '../src/index';
import type { Config } from '../src/types';

// Compat-only helpers. The 1.x suite's own support.ts is not imported: it
// carries the AUCO_TARGET switch and resolves `../src/index` to legacy under
// tsc, while everything here is compat's behavior on its own.

/** `puk_` + 32 zeros: the 36-char fake key of the protocol fixtures. */
export const KEY_PUBLIC = `puk_${'0'.repeat(32)}`;
export const SIGN_ORIGIN = 'https://sign.auco.ai';
export const UPLOAD_ORIGIN = 'https://upload.auco.ai';
export const VALIDATION_ORIGIN = 'https://veriface.auco.ai';
export const CUSTOM_ORIGIN = 'https://lista.example.com';
export const UX_OPTIONS = {
  primaryColor: '#021c30',
  alternateColor: '#a557f2',
};
export const TOKEN = 'fake-session-token-0000';

/** 1.0.9 cache-buster: `new Date().toISOString()` with `:` replaced by `-`. */
const ID_QUERY = String.raw`\?id=\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z`;
const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const srcPattern = (origin: string): RegExp =>
  new RegExp(`^${escapeRegExp(origin)}${ID_QUERY}$`);

// A path, not a file: URL: happy-dom replaces the global URL, which node:fs
// does not accept.
const fixturesDir = join(
  import.meta.dirname,
  '..',
  '..',
  'protocol',
  'fixtures'
);

/** `data` of `fixtures/<id>[.<variant>].json`, read fresh on every call. */
export const fixtureData = (
  id: string,
  variant: string | null = null
): Record<string, unknown> => {
  const file = variant === null ? `${id}.json` : `${id}.${variant}.json`;
  const parsed = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as {
    data: Record<string, unknown>;
  };
  return parsed.data;
};

export interface FakeFrame {
  iframe: HTMLIFrameElement;
  /** Stands in for `iframe.contentWindow`; also the `source` of its messages. */
  window: Window;
  postMessage: Mock<(message: unknown, targetOrigin: string) => void>;
}

/**
 * Mounts `<iframe id>` with a fake `contentWindow` and an own `src` data
 * property, so assigning `src` records the string instead of making
 * happy-dom navigate to a real Auco host.
 */
export const mountIframe = (id = 'auco'): FakeFrame => {
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

/** A frame whose iframe was unmounted: `contentWindow` reads `null`. */
export const detachContentWindow = (frame: FakeFrame): void => {
  Object.defineProperty(frame.iframe, 'contentWindow', {
    configurable: true,
    value: null,
  });
};

const subscriptions: Array<() => void> = [];

/**
 * Calls `AucoSDK` with a plain object: several cases are deliberately
 * outside the `Config` union (unknown sdkType, null keyPublic, no events).
 */
export const start = (config: Record<string, unknown>): (() => void) => {
  const unsubscribe = AucoSDK(config as unknown as Config);
  subscriptions.push(unsubscribe);
  return unsubscribe;
};

/** Ends every session `start` opened and unmounts the iframes. */
export const teardown = (): void => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  document.body.innerHTML = '';
};

export const sendFromFrame = (
  frame: FakeFrame,
  data: unknown,
  origin = SIGN_ORIGIN
): void => {
  window.dispatchEvent(
    new MessageEvent('message', { origin, data, source: frame.window })
  );
};

export const sendReady = (frame: FakeFrame, origin = SIGN_ORIGIN): void => {
  sendFromFrame(frame, fixtureData('frame.ready'), origin);
};

/** A macrotask: every microtask a callback chain queued has run by then. */
export const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Runs `body`, flushes, and returns the unhandled rejections raised
 * meanwhile. Vitest skips its own reporting while another
 * `unhandledRejection` listener exists; this one lives only for the call,
 * so a rejection anywhere else still fails the run.
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

/** A promise settled from outside (`Promise.withResolvers` is ES2024). */
export const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

export const baseEvents = () => ({
  onSDKReady: vi.fn(),
  onSDKClose: vi.fn(),
});

export const signConfig = (
  frame: FakeFrame,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  sdkType: 'sign',
  env: 'PROD',
  iframeId: frame.iframe.id,
  language: 'es',
  sdkData: { document: 'DOC0000000AA', uxOptions: UX_OPTIONS },
  events: baseEvents(),
  ...overrides,
});
