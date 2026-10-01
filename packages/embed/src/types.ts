import type {
  Env,
  FrameClose,
  FrameMessage,
  Language,
  Product,
  ProductWithOrigin,
} from '@lob26/auco-protocol';
import type { AucoSessionError } from './errors';

/** How the frame gets its credentials. Both fields may be set. */
export interface SessionAuth {
  /**
   * Sent as `keyPublic` in every `host.init`, verbatim: `null` and `''` travel
   * as given. Also the fallback answer to a token request when `getToken` is
   * absent and the key is non-empty.
   */
  readonly publicKey?: string | null | undefined;
  /**
   * Answers each `frame.token-request`. `signal` aborts on `tokenTimeoutMs`
   * or `destroy()`; a late resolution is dropped.
   */
  readonly getToken?: ((signal: AbortSignal) => Promise<string>) | undefined;
}

interface BaseSessionOptions {
  readonly language: Language;
  /**
   * Product data (`sdkData`), spread at the root of `host.init`. `object`, not
   * a record type, so interfaces (1.x's `SDKUploadData`, an integrator's own)
   * are accepted without an index signature.
   */
  readonly data: object;
  readonly auth?: SessionAuth | undefined;
  /**
   * What `host.init` sends as `sdkParentURL`, read at each `ready`:
   * `location.origin` (default) or the full `location.href` (audit 2.1).
   */
  readonly parentUrl?: 'origin' | 'href' | undefined;
  /** Aborting it destroys the session. */
  readonly signal?: AbortSignal | undefined;
  /** Fails the session when no `ready` arrives in time. Default 30000; 0 disables. */
  readonly handshakeTimeoutMs?: number | undefined;
  /** Bounds each `getToken` call. Default 30000; 0 disables. */
  readonly tokenTimeoutMs?: number | undefined;
}

/** Where the frame lives: exactly one of `container` or `iframe`. */
export type SessionPlacement =
  | {
      /** The session creates its iframe inside it, and removes it on destroy. */
      readonly container: HTMLElement;
      readonly iframe?: never;
    }
  | {
      /** Adopted as is: only `src` is ever written, `about:blank` on destroy. */
      readonly iframe: HTMLIFrameElement;
      readonly container?: never;
    };

/**
 * What runs in the frame and where it is served from: exactly one of `env`
 * or `origin`. `list-validation` has no default origin, so it compiles only
 * with an explicit one.
 */
export type SessionOrigin =
  | {
      readonly product: ProductWithOrigin;
      /** Auco's public hosts; internal `*-dev` hosts need an explicit origin. */
      readonly env: Env;
      readonly origin?: never;
    }
  | {
      readonly product: Product;
      /**
       * A serialized origin, `scheme://host[:port]`, compared verbatim with
       * `event.origin`: no path, no trailing slash, lowercase host.
       */
      readonly origin: string;
      readonly env?: never;
    };

/** Options of {@link createSession}. */
export type SessionOptions = BaseSessionOptions &
  SessionPlacement &
  SessionOrigin;

/**
 * `loading` until the first `ready`; `awaiting-token` while a `getToken` call
 * is pending after it; `closed`, `failed` and `destroyed` are final.
 */
export type SessionState =
  | 'loading'
  | 'ready'
  | 'awaiting-token'
  | 'closed'
  | 'failed'
  | 'destroyed';

type MessageOf<K extends FrameMessage['kind']> = Extract<
  FrameMessage,
  { kind: K }
>;

/**
 * Detail of `close`, `finish` and `back`, after `ExtendableEvent`: promises
 * passed to `waitUntil` during dispatch hold the session open until they all
 * settle. If one rejects, `error` fires and a terminal message does not end
 * the session.
 */
export interface Extendable {
  /** Throws `InvalidStateError` once dispatch has returned. */
  waitUntil(promise: PromiseLike<unknown>): void;
}

/** How a session ended; `done` resolves with it. */
export type SessionOutcome =
  | { readonly reason: 'close'; readonly message: FrameClose }
  | { readonly reason: 'finish'; readonly message: MessageOf<'finish'> }
  | { readonly reason: 'back'; readonly message: MessageOf<'back'> }
  | { readonly reason: 'destroyed' };

/** Event types of {@link AucoSession} and the `detail` each carries. */
export interface AucoSessionEventMap {
  ready: CustomEvent<MessageOf<'ready'>>;
  /** Terminal unless `status` is `'PENDING'` (`detail.terminal`). */
  close: CustomEvent<FrameClose & Extendable>;
  finish: CustomEvent<MessageOf<'finish'> & Extendable>;
  back: CustomEvent<MessageOf<'back'> & Extendable>;
  pay: CustomEvent<MessageOf<'pay'>>;
  notification: CustomEvent<MessageOf<'notification'>>;
  /** A message from the frame that matches no known kind. */
  unknown: CustomEvent<MessageOf<'unknown'>>;
  error: CustomEvent<{ readonly error: AucoSessionError }>;
  statechange: CustomEvent<{ readonly state: SessionState }>;
}

type SessionListener<K extends keyof AucoSessionEventMap> = (
  this: AucoSession,
  event: AucoSessionEventMap[K]
) => unknown;

/**
 * One embedded Auco frame: owns its iframe's `src`, its `message` listener
 * and its lifecycle. Events are listed in {@link AucoSessionEventMap}.
 */
export interface AucoSession extends EventTarget {
  readonly iframe: HTMLIFrameElement;
  readonly origin: string;
  readonly product: Product;
  readonly state: SessionState;
  /**
   * Resolves when the session closes or is destroyed; rejects with the
   * {@link AucoSessionError} that made it `failed`. Never an unhandled
   * rejection when nobody awaits it.
   */
  readonly done: Promise<SessionOutcome>;
  /**
   * Stops listening, aborts pending `getToken` calls and releases the iframe
   * (a created one is removed, an adopted one gets `about:blank`). Idempotent;
   * after `close` it only releases the iframe.
   */
  destroy(): void;
  addEventListener<K extends keyof AucoSessionEventMap>(
    type: K,
    listener: SessionListener<K>,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener<K extends keyof AucoSessionEventMap>(
    type: K,
    listener: SessionListener<K>,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void;
}
