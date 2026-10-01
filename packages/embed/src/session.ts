import {
  AucoConfigError,
  buildHostInit,
  buildHostToken,
  type FrameMessage,
  flowTypeFor,
  isProduct,
  parseFrameMessage,
  resolveOrigin,
} from '@lob26/auco-protocol';
import {
  AucoHandlerError,
  AucoHandshakeTimeout,
  AucoOptionsError,
  AucoProtocolError,
  type AucoSessionError,
  AucoTokenError,
} from './errors';
import type {
  AucoSession,
  AucoSessionEventMap,
  SessionOptions,
  SessionOutcome,
  SessionState,
} from './types';

const TITLES = { es: 'Proceso de Auco', en: 'Auco process' };
// setTimeout clamps anything above 2^31 - 1 to an immediate fire.
const MAX_DELAY = 0x7fffffff;

const invalid = (option: string, expected: string) =>
  new AucoOptionsError('invalid-option', `${option} must be ${expected}`);

const delay = (name: string, ms: number | undefined): number => {
  const value = ms ?? 30_000;
  if (typeof value !== 'number' || !(value >= 0 && value <= MAX_DELAY)) {
    throw invalid(name, `0 or a delay in ms up to ${MAX_DELAY}`);
  }
  return value;
};

// event.origin is always serialized, so any other spelling would never match.
const isSerializedOrigin = (value: string): boolean => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
};

/**
 * Embeds an Auco frame and drives its `postMessage` protocol. Every option is
 * checked before the DOM is touched: a fault throws {@link AucoConfigError}
 * (product, env) or {@link AucoOptionsError}, and an already aborted `signal`
 * throws its reason. Then the `message` listener is attached and `src` is set
 * to `<origin>?id=<cache-buster>`.
 *
 * Only messages whose `origin` and `source` are this session's frame are
 * handled (audit 1.1). Each `ready` re-sends `host.init`. `close` (unless
 * `PENDING`), `finish` and `back` end the session once their `waitUntil`
 * promises settle; `destroy()`, the `signal` and the handshake timeout end it
 * through the same path.
 */
export function createSession(options: SessionOptions): AucoSession {
  const { product, language, data, auth, parentUrl, signal } = options;
  if (!isProduct(product)) {
    throw new AucoConfigError(
      'unknown-product',
      `Unknown Auco product: ${String(product)}`
    );
  }
  if (!options.container === !options.iframe) {
    throw invalid('container / iframe', 'exactly one of the two');
  }
  if ((options.env === undefined) === (options.origin === undefined)) {
    throw invalid('env / origin', 'exactly one of the two');
  }
  // resolveOrigin also rejects list-validation at runtime, for JS callers.
  const origin =
    options.env === undefined
      ? options.origin
      : resolveOrigin(options.product, options.env);
  if (!isSerializedOrigin(origin)) {
    throw invalid('origin', 'a serialized origin like https://host[:port]');
  }
  if (language !== 'es' && language !== 'en') {
    throw invalid('language', "'es' or 'en'");
  }
  if (
    parentUrl !== undefined &&
    parentUrl !== 'origin' &&
    parentUrl !== 'href'
  ) {
    throw invalid('parentUrl', "'origin' or 'href'");
  }
  const getToken = auth?.getToken;
  if (getToken !== undefined && typeof getToken !== 'function') {
    throw invalid('auth.getToken', 'a function');
  }
  const handshakeMs = delay('handshakeTimeoutMs', options.handshakeTimeoutMs);
  const tokenMs = delay('tokenTimeoutMs', options.tokenTimeoutMs);
  signal?.throwIfAborted();

  let iframe = options.iframe;
  const created = !iframe;
  if (!iframe) {
    const container = options.container as HTMLElement;
    iframe = container.ownerDocument.createElement('iframe');
    iframe.setAttribute('allow', 'camera; microphone; clipboard-write');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    iframe.title = TITLES[language];
    // A default iframe is inline with a 2px border: without these it leaves a
    // baseline gap and overflows a container it is meant to fill.
    const style = iframe.style;
    style.display = 'block';
    style.width = style.height = '100%';
    style.border = '0';
    container.append(iframe);
  }
  const frame = iframe;

  let state: SessionState = 'loading';
  let ended = false;
  let released = false;
  // Kept after the iframe detaches (contentWindow turns null) so the source
  // check never degrades to `null === null`.
  let frameWindow = frame.contentWindow;
  const tokens = new Set<AbortController>();

  let resolveDone!: (outcome: SessionOutcome) => void;
  let rejectDone!: (error: AucoSessionError) => void;
  const done = new Promise<SessionOutcome>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // Nobody has to await `done`; a failed session must not surface as an
  // unhandled rejection.
  done.catch(() => {});

  const session = Object.assign(new EventTarget(), {
    iframe: frame,
    origin,
    product,
    state,
    done,
    destroy: () => end('destroyed', { reason: 'destroyed' }),
  }) as { state: SessionState } & AucoSession;

  const emit = <K extends keyof AucoSessionEventMap>(
    type: K,
    detail: AucoSessionEventMap[K]['detail']
  ) => {
    session.dispatchEvent(new CustomEvent(type, { detail }));
  };
  const fail = (error: AucoSessionError) => emit('error', { error });

  // Every emit runs integrator code that may call destroy(); once `ended`,
  // only end() itself may still move the state, and it does so exactly once.
  const setState = (next: SessionState) => {
    if (
      state === next ||
      (ended && next !== 'closed' && next !== 'failed' && next !== 'destroyed')
    )
      return;
    session.state = state = next;
    emit('statechange', { state });
  };

  const post = (message: object) => {
    const target = frame.contentWindow;
    if (!target) {
      fail(
        new AucoProtocolError(
          'frame-unreachable',
          'The iframe has no contentWindow; it is no longer attached'
        )
      );
      return;
    }
    try {
      target.postMessage(message, origin);
    } catch (cause) {
      fail(
        new AucoProtocolError('post-failed', 'postMessage to the frame threw', {
          cause,
        })
      );
    }
  };

  const onMessage = (event: MessageEvent) => {
    frameWindow = frame.contentWindow ?? frameWindow;
    if (
      event.origin !== origin ||
      !event.source ||
      event.source !== frameWindow
    ) {
      return;
    }
    const message = parseFrameMessage(event.data);
    switch (message.kind) {
      case 'ready':
        clearTimeout(handshake);
        post(
          buildHostInit({
            language,
            data,
            keyPublic: auth?.publicKey,
            parentUrl: parentUrl === 'href' ? location.href : location.origin,
            flowType: flowTypeFor(product),
          })
        );
        if (ended) return;
        setState(tokens.size ? 'awaiting-token' : 'ready');
        if (!ended) emit('ready', message);
        return;
      case 'token-request':
        requestToken();
        return;
      case 'close':
        extend(message, message.terminal);
        return;
      case 'finish':
      case 'back':
        extend(message, true);
        return;
      default:
        emit(message.kind, message);
    }
  };

  const extend = (
    message: Extract<FrameMessage, { kind: 'close' | 'finish' | 'back' }>,
    terminal: boolean
  ) => {
    const waits: PromiseLike<unknown>[] = [];
    let open = true;
    emit(message.kind, {
      ...message,
      waitUntil: (promise: PromiseLike<unknown>) => {
        if (!open) {
          throw new DOMException(
            'waitUntil must be called while the event is dispatched',
            'InvalidStateError'
          );
        }
        waits.push(promise);
      },
    });
    open = false;
    const outcome = { reason: message.kind, message } as SessionOutcome;
    if (!waits.length) {
      if (terminal) end('closed', outcome);
      return;
    }
    Promise.allSettled(waits).then((results) => {
      // destroy() during the wait wins: a late settle is a no-op.
      if (ended) return;
      let ok = true;
      for (const result of results) {
        // An error listener may have destroyed the session mid-loop.
        if (ended) return;
        if (result.status === 'rejected') {
          ok = false;
          fail(
            new AucoHandlerError(
              'handler-rejected',
              `A waitUntil promise of '${message.kind}' rejected`,
              { cause: result.reason }
            )
          );
        }
      }
      if (ok && terminal) end('closed', outcome);
    });
  };

  const requestToken = () => {
    if (!getToken) {
      const key = auth?.publicKey;
      if (key) post(buildHostToken(key));
      else {
        fail(
          new AucoTokenError(
            'token-unavailable',
            'The frame asked for a token, but auth has no getToken and no publicKey'
          )
        );
      }
      return;
    }
    const controller = new AbortController();
    const timer = tokenMs
      ? setTimeout(
          () =>
            controller.abort(
              new AucoTokenError(
                'token-timeout',
                `getToken did not settle within ${tokenMs} ms`
              )
            ),
          tokenMs
        )
      : undefined;
    tokens.add(controller);
    // Raced against the signal: a getToken that ignores it still loses.
    new Promise<string>((resolve, reject) => {
      controller.signal.addEventListener('abort', () =>
        reject(controller.signal.reason)
      );
      Promise.resolve(getToken(controller.signal)).then(resolve, reject);
    })
      .then(
        (token) => {
          if (!ended) post(buildHostToken(token));
        },
        (cause: unknown) => {
          if (ended) return;
          fail(
            cause instanceof AucoTokenError
              ? cause
              : new AucoTokenError('token-failed', 'getToken rejected', {
                  cause,
                })
          );
        }
      )
      .finally(() => {
        clearTimeout(timer);
        tokens.delete(controller);
        if (!tokens.size && state === 'awaiting-token') setState('ready');
      });
    // Last: a statechange listener may destroy(), and the abort listener above
    // must already exist so getToken's race settles instead of leaking.
    if (state === 'ready') setState('awaiting-token');
  };

  // The single terminal path (audit 1.6). A terminal state is final; destroy()
  // after one still releases the iframe.
  function end(next: 'closed' | 'destroyed', outcome: SessionOutcome): void;
  function end(next: 'failed', error: AucoSessionError): void;
  function end(
    next: 'closed' | 'failed' | 'destroyed',
    result: SessionOutcome | AucoSessionError
  ): void {
    if (!ended) {
      ended = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(handshake);
      for (const controller of tokens) controller.abort();
      setState(next);
      if (next === 'failed') {
        fail(result as AucoSessionError);
        rejectDone(result as AucoSessionError);
      } else {
        resolveDone(result as SessionOutcome);
      }
    }
    if (next === 'destroyed' && !released) {
      released = true;
      signal?.removeEventListener('abort', session.destroy);
      if (created) frame.remove();
      else frame.src = 'about:blank';
    }
  }

  const handshake = handshakeMs
    ? setTimeout(
        () =>
          end(
            'failed',
            new AucoHandshakeTimeout(
              'handshake-timeout',
              `No ready from ${origin} within ${handshakeMs} ms`
            )
          ),
        handshakeMs
      )
    : undefined;
  signal?.addEventListener('abort', session.destroy);
  window.addEventListener('message', onMessage);
  frame.src = `${origin}?id=${new Date().toISOString().replace(/:/g, '-')}`;
  return session;
}
