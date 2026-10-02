import { afterEach, vi } from 'vitest';
import {
  type AucoSession,
  type AucoSessionEventMap,
  createSession,
  type SessionOptions,
} from '../src/index';

export const ORIGIN = 'https://sign.auco.ai';

// happy-dom navigates an iframe whose src is set, over the real network. The
// session always sets src, so a created iframe would fetch Auco's hosts.
(
  window as unknown as {
    happyDOM: {
      settings: { navigation: { disableChildFrameNavigation: boolean } };
    };
  }
).happyDOM.settings.navigation.disableChildFrameNavigation = true;

export const setPageUrl = (url: string): void => {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(url);
};

export interface Post {
  readonly message: unknown;
  readonly targetOrigin: string;
}

export interface FakeFrame {
  readonly iframe: HTMLIFrameElement;
  /** Stands in for `iframe.contentWindow` and is the `source` of its messages. */
  readonly window: Window;
  readonly posts: Post[];
}

/** Replaces `iframe.contentWindow` with a fake that records every post. */
export const fakeContentWindow = (
  iframe: HTMLIFrameElement,
  postMessage?: (message: unknown, targetOrigin: string) => void
): FakeFrame => {
  const posts: Post[] = [];
  const fake = {
    postMessage:
      postMessage ??
      ((message: unknown, targetOrigin: string) => {
        posts.push({ message, targetOrigin });
      }),
  } as unknown as Window;
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: fake,
  });
  return { iframe, window: fake, posts };
};

/**
 * An attached iframe to adopt, with an own `src` data property so the session's
 * writes are observed and never navigate anything.
 */
export const adoptedFrame = (
  postMessage?: (message: unknown, targetOrigin: string) => void
): FakeFrame => {
  const iframe = document.createElement('iframe');
  Object.defineProperty(iframe, 'src', {
    configurable: true,
    writable: true,
    value: '',
  });
  document.body.append(iframe);
  return fakeContentWindow(iframe, postMessage);
};

/** What a detached iframe reports: no `contentWindow`. */
export const detach = (iframe: HTMLIFrameElement): void => {
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: null,
  });
};

export const deliver = (
  data: unknown,
  source: Window | null,
  origin = ORIGIN
): void => {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
};

/** A message from `frame`'s window, on the session's origin. */
export const fromFrame = (frame: FakeFrame, data: unknown): void => {
  deliver(data, frame.window);
};

const live: AucoSession[] = [];

/** createSession, destroyed after the test so no listener outlives it. */
export const start = (options: SessionOptions): AucoSession => {
  const session = createSession(options);
  live.push(session);
  return session;
};

/** Options for a session that adopts `frame`, with both timers disabled. */
export const optionsFor = (
  frame: FakeFrame,
  extra: Record<string, unknown> = {}
): SessionOptions =>
  ({
    product: 'sign',
    origin: ORIGIN,
    iframe: frame.iframe,
    language: 'es',
    data: {},
    handshakeTimeoutMs: 0,
    tokenTimeoutMs: 0,
    ...extra,
  }) as SessionOptions;

export type Entry = {
  [K in keyof AucoSessionEventMap]: {
    type: K;
    detail: AucoSessionEventMap[K]['detail'];
  };
}[keyof AucoSessionEventMap];

const TYPES = [
  'ready',
  'close',
  'finish',
  'back',
  'pay',
  'notification',
  'unknown',
  'error',
  'statechange',
] as const;

/** Every session event in dispatch order. */
export const record = (session: AucoSession): Entry[] => {
  const log: Entry[] = [];
  for (const type of TYPES) {
    session.addEventListener(type, (event: CustomEvent) => {
      log.push({ type, detail: event.detail } as Entry);
    });
  }
  return log;
};

/** `statechange:<state>` for state changes, the event type otherwise. */
export const names = (log: readonly Entry[]): string[] =>
  log.map((entry) =>
    entry.type === 'statechange'
      ? `statechange:${entry.detail.state}`
      : entry.type
  );

export const errorCodes = (log: readonly Entry[]): string[] =>
  log.flatMap((entry) =>
    entry.type === 'error' ? [entry.detail.error.code] : []
  );

/**
 * Lets every pending promise chain run to the end: a macrotask runs only once
 * the microtask queue is empty. Only Date and the timeout pair are faked, so
 * setImmediate stays real.
 */
export const settle = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

export const useFakeClock = (): void => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
};

/** A promise and the functions that settle it. */
export const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

afterEach(() => {
  for (const session of live.splice(0)) session.destroy();
  vi.useRealTimers();
  document.body.replaceChildren();
});
