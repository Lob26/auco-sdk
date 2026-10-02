import { describe, expect, it, vi } from 'vitest';
import type { AucoSession, SessionOutcome } from '../src/index';
import {
  adoptedFrame,
  deferred,
  errorCodes,
  type FakeFrame,
  fakeContentWindow,
  fromFrame,
  names,
  ORIGIN,
  optionsFor,
  record,
  settle,
  start,
  useFakeClock,
} from './support';

const readySession = (extra: Record<string, unknown> = {}) => {
  const frame = adoptedFrame();
  const session = start(optionsFor(frame, extra));
  fromFrame(frame, { ready: true });
  return { frame, session };
};

const outcome = async (session: AucoSession) => {
  let result: SessionOutcome | 'pending' | 'rejected' = 'pending';
  session.done.then(
    (value) => {
      result = value;
    },
    () => {
      result = 'rejected';
    }
  );
  await settle();
  return result;
};

describe('loading', () => {
  it('starts loading and points the iframe at origin with a cache-buster', () => {
    useFakeClock();
    vi.setSystemTime(new Date('2026-10-01T15:04:05.123Z'));
    const frame = adoptedFrame();
    const session = start(optionsFor(frame));
    expect(session.state).toBe('loading');
    expect(frame.iframe.src).toBe(`${ORIGIN}?id=2026-10-01T15-04-05.123Z`);
  });

  it('becomes ready on the first frame.ready', () => {
    const frame = adoptedFrame();
    const session = start(optionsFor(frame));
    const log = record(session);
    fromFrame(frame, { ready: true });
    expect(session.state).toBe('ready');
    expect(names(log)).toEqual(['statechange:ready', 'ready']);
  });

  it('emits ready again, without a statechange, on a second frame.ready', () => {
    const { frame, session } = readySession();
    const log = record(session);
    fromFrame(frame, { ready: true });
    expect(names(log)).toEqual(['ready']);
  });
});

describe('awaiting-token', () => {
  const tokenSession = () => {
    const pending: ReturnType<typeof deferred<string>>[] = [];
    const getToken = () => {
      const call = deferred<string>();
      pending.push(call);
      return call.promise;
    };
    const frame = adoptedFrame();
    const session = start(optionsFor(frame, { auth: { getToken } }));
    return { frame, session, pending };
  };

  it('moves ready → awaiting-token → ready around a getToken call', async () => {
    const { frame, session, pending } = tokenSession();
    const log = record(session);
    fromFrame(frame, { ready: true });
    fromFrame(frame, { type: 'token' });
    expect(session.state).toBe('awaiting-token');
    pending[0]?.resolve('tok');
    await settle();
    expect(session.state).toBe('ready');
    expect(names(log)).toEqual([
      'statechange:ready',
      'ready',
      'statechange:awaiting-token',
      'statechange:ready',
    ]);
  });

  it('stays awaiting-token until every concurrent getToken settles', async () => {
    const { frame, session, pending } = tokenSession();
    fromFrame(frame, { ready: true });
    fromFrame(frame, { type: 'token' });
    fromFrame(frame, { type: 'token' });
    pending[0]?.resolve('one');
    await settle();
    expect(session.state).toBe('awaiting-token');
    pending[1]?.resolve('two');
    await settle();
    expect(session.state).toBe('ready');
  });

  it('a token request while loading leaves the session loading', () => {
    const { frame, session } = tokenSession();
    fromFrame(frame, { type: 'token' });
    expect(session.state).toBe('loading');
  });

  it('a ready that arrives while getToken is pending lands in awaiting-token', () => {
    const { frame, session } = tokenSession();
    fromFrame(frame, { type: 'token' });
    fromFrame(frame, { ready: true });
    expect(session.state).toBe('awaiting-token');
  });
});

// Audit 1.6: every way to end goes through one end(), which removes the
// listener, clears the handshake, aborts tokens, moves to the terminal state
// once and settles done.
describe('terminal paths', () => {
  type Ended = {
    frame: FakeFrame;
    session: AucoSession;
    expected: string;
  };
  type Extra = Record<string, unknown>;
  const paths: [string, (extra?: Extra) => Promise<Ended> | Ended][] = [
    [
      'frame.close',
      (extra) => {
        const { frame, session } = readySession(extra);
        fromFrame(frame, { type: 'SDK-CLOSE' });
        return { frame, session, expected: 'closed' };
      },
    ],
    [
      'frame.finish',
      (extra) => {
        const { frame, session } = readySession(extra);
        fromFrame(frame, { type: 'SDK-FINISH' });
        return { frame, session, expected: 'closed' };
      },
    ],
    [
      'frame.back',
      (extra) => {
        const { frame, session } = readySession(extra);
        fromFrame(frame, { type: 'SDK-BACK' });
        return { frame, session, expected: 'closed' };
      },
    ],
    [
      'destroy()',
      (extra) => {
        const { frame, session } = readySession(extra);
        session.destroy();
        return { frame, session, expected: 'destroyed' };
      },
    ],
    [
      'signal abort',
      (extra) => {
        const controller = new AbortController();
        const { frame, session } = readySession({
          ...extra,
          signal: controller.signal,
        });
        controller.abort();
        return { frame, session, expected: 'destroyed' };
      },
    ],
    [
      'handshake timeout',
      (extra) => {
        useFakeClock();
        const frame = adoptedFrame();
        const session = start(
          optionsFor(frame, { ...extra, handshakeTimeoutMs: 10 })
        );
        vi.advanceTimersByTime(10);
        return { frame, session, expected: 'failed' };
      },
    ],
  ];

  // One of each kind parseFrameMessage tells apart. Without auth, a handled
  // token request would surface as a token-unavailable error.
  const everyKind = [
    { ready: true },
    { type: 'token' },
    { type: 'SDK-CLOSE' },
    { type: 'SDK-FINISH' },
    { type: 'SDK-BACK' },
    { type: 'SDK-PAY', data: { code: 'DOC0000000AA', epaycoKey: 'k' } },
    { type: 'SDK-NOTIFICATION', data: { message: 'x' } },
    { type: 'SDK-OTHER' },
  ];

  it.each(paths)('%s stops listening to the frame', async (_, end) => {
    const { frame, session, expected } = await end();
    const log = record(session);
    const posted = frame.posts.length;
    for (const data of everyKind) fromFrame(frame, data);
    await settle();
    expect(session.state).toBe(expected);
    expect(log).toEqual([]);
    expect(frame.posts).toHaveLength(posted);
  });

  it.each(paths)(
    '%s never calls getToken for a later token request',
    async (_, end) => {
      const getToken = vi.fn(() => 'tok');
      const { frame, session } = await end({ auth: { getToken } });
      const log = record(session);
      const posted = frame.posts.length;
      fromFrame(frame, { type: 'token' });
      await settle();
      expect(getToken).not.toHaveBeenCalled();
      expect(frame.posts).toHaveLength(posted);
      expect(log).toEqual([]);
    }
  );

  it.each(paths)('%s settles done', async (_, end) => {
    const { session, expected } = await end();
    const result = await outcome(session);
    if (expected === 'failed') expect(result).toBe('rejected');
    else expect(result).not.toBe('pending');
  });

  it.each(paths)(
    '%s is final: a later destroy() keeps the state',
    async (_, end) => {
      const { session, expected } = await end();
      const log = record(session);
      session.destroy();
      expect(session.state).toBe(expected);
      expect(log).toEqual([]);
    }
  );

  const tokenEnders: [
    string,
    (session: AucoSession, frame: FakeFrame, abort: () => void) => void,
  ][] = [
    ['frame.close', (_, frame) => fromFrame(frame, { type: 'SDK-CLOSE' })],
    ['frame.finish', (_, frame) => fromFrame(frame, { type: 'SDK-FINISH' })],
    ['frame.back', (_, frame) => fromFrame(frame, { type: 'SDK-BACK' })],
    ['destroy()', (session) => session.destroy()],
    ['signal abort', (_, __, abort) => abort()],
  ];

  it.each(tokenEnders)(
    '%s aborts a pending getToken without reporting it',
    async (_, end) => {
      let signal: AbortSignal | undefined;
      const getToken = (s: AbortSignal) => {
        signal = s;
        return new Promise<string>(() => {});
      };
      const controller = new AbortController();
      const { frame, session } = readySession({
        auth: { getToken },
        signal: controller.signal,
      });
      fromFrame(frame, { type: 'token' });
      const log = record(session);
      end(session, frame, () => controller.abort());
      await settle();
      expect(signal?.aborted).toBe(true);
      expect(errorCodes(log)).toEqual([]);
    }
  );

  it('a close resolves done with the close message', async () => {
    const { frame, session } = readySession();
    fromFrame(frame, { type: 'SDK-CLOSE', document: 'DOC0000000AA' });
    const result = await session.done;
    expect(result.reason).toBe('close');
    expect(result.reason === 'close' && result.message.document).toBe(
      'DOC0000000AA'
    );
  });

  it('destroy() resolves done with reason destroyed', async () => {
    const { session } = readySession();
    session.destroy();
    expect(await session.done).toEqual({ reason: 'destroyed' });
  });

  it('a PENDING close keeps the session open', () => {
    const { frame, session } = readySession();
    const log = record(session);
    fromFrame(frame, { type: 'SDK-CLOSE', status: 'PENDING' });
    expect(session.state).toBe('ready');
    expect(names(log)).toEqual(['close']);
  });

  it('emits exactly one terminal statechange', () => {
    const { frame, session } = readySession();
    const log = record(session);
    fromFrame(frame, { type: 'SDK-CLOSE' });
    fromFrame(frame, { type: 'SDK-FINISH' });
    session.destroy();
    expect(names(log)).toEqual(['close', 'statechange:closed']);
  });
});

describe('destroy()', () => {
  it('is idempotent', async () => {
    const { session } = readySession();
    const log = record(session);
    session.destroy();
    session.destroy();
    expect(session.state).toBe('destroyed');
    expect(names(log)).toEqual(['statechange:destroyed']);
    expect(await session.done).toEqual({ reason: 'destroyed' });
  });

  it('points an adopted iframe at about:blank and leaves it in place', () => {
    const { frame, session } = readySession();
    session.destroy();
    expect(frame.iframe.src).toBe('about:blank');
    expect(frame.iframe.isConnected).toBe(true);
  });

  it('removes an iframe it created', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const session = start({
      product: 'sign',
      origin: ORIGIN,
      container,
      language: 'es',
      data: {},
      handshakeTimeoutMs: 0,
    });
    const frame = fakeContentWindow(session.iframe);
    fromFrame(frame, { ready: true });
    session.destroy();
    expect(session.iframe.isConnected).toBe(false);
    expect(container.children).toHaveLength(0);
  });

  // A released iframe belongs to the integrator again, who may reuse it; a
  // repeated destroy() (a cleanup run twice) must not take it back.
  it('a second destroy() leaves a reused adopted iframe alone', () => {
    const { frame, session } = readySession();
    session.destroy();
    frame.iframe.src = 'https://reuse.example.com/';
    session.destroy();
    expect(frame.iframe.src).toBe('https://reuse.example.com/');
  });

  it('a second destroy() leaves a re-attached created iframe in place', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const session = start({
      product: 'sign',
      origin: ORIGIN,
      container,
      language: 'es',
      data: {},
      handshakeTimeoutMs: 0,
    });
    session.destroy();
    container.append(session.iframe);
    session.destroy();
    expect(session.iframe.isConnected).toBe(true);
  });

  it('a closed session keeps its iframe until destroy()', () => {
    const { frame } = readySession();
    const src = frame.iframe.src;
    fromFrame(frame, { type: 'SDK-CLOSE' });
    expect(frame.iframe.src).toBe(src);
  });

  it('after a close only releases the iframe', async () => {
    const { frame, session } = readySession();
    fromFrame(frame, { type: 'SDK-CLOSE', document: 'DOC0000000AA' });
    const log = record(session);
    session.destroy();
    expect(session.state).toBe('closed');
    expect(log).toEqual([]);
    expect(frame.iframe.src).toBe('about:blank');
    expect((await session.done).reason).toBe('close');
  });

  it('after a failure only releases the iframe', async () => {
    useFakeClock();
    const frame = adoptedFrame();
    const session = start(optionsFor(frame, { handshakeTimeoutMs: 10 }));
    vi.advanceTimersByTime(10);
    const log = record(session);
    session.destroy();
    expect(session.state).toBe('failed');
    expect(log).toEqual([]);
    expect(frame.iframe.src).toBe('about:blank');
    await expect(session.done).rejects.toMatchObject({
      code: 'handshake-timeout',
    });
  });
});

describe('handshake timer', () => {
  it('is cleared when the session is destroyed while loading', () => {
    useFakeClock();
    const frame = adoptedFrame();
    const session = start(optionsFor(frame, { handshakeTimeoutMs: 1000 }));
    session.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('signal', () => {
  it('aborted while loading destroys the session before any ready', async () => {
    const controller = new AbortController();
    const frame = adoptedFrame();
    const session = start(optionsFor(frame, { signal: controller.signal }));
    controller.abort();
    fromFrame(frame, { ready: true });
    expect(session.state).toBe('destroyed');
    expect(frame.posts).toEqual([]);
    expect(await session.done).toEqual({ reason: 'destroyed' });
  });

  it('aborted after ready destroys the session and releases the iframe', () => {
    const controller = new AbortController();
    const { frame, session } = readySession({ signal: controller.signal });
    controller.abort();
    expect(session.state).toBe('destroyed');
    expect(frame.iframe.src).toBe('about:blank');
  });

  it('aborted after a close releases the iframe and keeps closed', () => {
    const controller = new AbortController();
    const { frame, session } = readySession({ signal: controller.signal });
    fromFrame(frame, { type: 'SDK-BACK' });
    controller.abort();
    expect(session.state).toBe('closed');
    expect(frame.iframe.src).toBe('about:blank');
  });
});
