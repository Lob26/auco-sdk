import { describe, expect, it, vi } from 'vitest';
import { AucoTokenError } from '../src/index';
import {
  adoptedFrame,
  deferred,
  type Entry,
  errorCodes,
  fromFrame,
  ORIGIN,
  optionsFor,
  record,
  settle,
  start,
  useFakeClock,
} from './support';

const KEY = 'puk_00000000000000000000000000000000';

/** A ready session whose frame has just asked for a token. */
const askToken = (auth: Record<string, unknown>, extra = {}) => {
  const frame = adoptedFrame();
  const session = start(optionsFor(frame, { auth, ...extra }));
  fromFrame(frame, { ready: true });
  const log = record(session);
  frame.posts.length = 0;
  fromFrame(frame, { type: 'token' });
  return { frame, session, log };
};

const tokenError = (log: Entry[]) => {
  const entry = log.find((e) => e.type === 'error');
  return entry?.type === 'error' ? entry.detail.error : undefined;
};

describe('token request with getToken', () => {
  it('posts host.token with the resolved token to the origin', async () => {
    const { frame } = askToken({
      getToken: async () => 'fake-session-token-0000',
    });
    await settle();
    expect(frame.posts).toEqual([
      {
        message: { type: 'token', token: 'fake-session-token-0000' },
        targetOrigin: ORIGIN,
      },
    ]);
  });

  it('passes getToken an AbortSignal that is not aborted', () => {
    const getToken = vi.fn((_: AbortSignal) => new Promise<string>(() => {}));
    askToken({ getToken });
    expect(getToken).toHaveBeenCalledOnce();
    const signal = getToken.mock.calls[0]?.[0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it('reports a rejection as token-failed, with the reason as cause, and posts nothing', async () => {
    const reason = new Error('backend down');
    const { frame, session, log } = askToken({
      getToken: () => Promise.reject(reason),
    });
    await settle();
    const error = tokenError(log);
    expect(error).toBeInstanceOf(AucoTokenError);
    expect(error?.code).toBe('token-failed');
    expect(error?.cause).toBe(reason);
    expect(frame.posts).toEqual([]);
    expect(session.state).toBe('ready');
  });

  it('reports a synchronous throw as token-failed', async () => {
    const { log } = askToken({
      getToken: () => {
        throw new Error('sync');
      },
    });
    await settle();
    expect(errorCodes(log)).toEqual(['token-failed']);
  });

  it('times out after tokenTimeoutMs, aborts the signal and posts nothing', async () => {
    useFakeClock();
    let signal: AbortSignal | undefined;
    const { frame, session, log } = askToken(
      {
        getToken: (s: AbortSignal) => {
          signal = s;
          return new Promise<string>(() => {});
        },
      },
      { tokenTimeoutMs: 500 }
    );
    vi.advanceTimersByTime(499);
    await settle();
    expect(errorCodes(log)).toEqual([]);
    vi.advanceTimersByTime(1);
    await settle();
    expect(tokenError(log)).toBeInstanceOf(AucoTokenError);
    expect(errorCodes(log)).toEqual(['token-timeout']);
    expect(signal?.aborted).toBe(true);
    expect(frame.posts).toEqual([]);
    expect(session.state).toBe('ready');
  });

  it('drops a token that resolves after the timeout', async () => {
    useFakeClock();
    const call = deferred<string>();
    const { frame } = askToken(
      { getToken: () => call.promise },
      { tokenTimeoutMs: 500 }
    );
    vi.advanceTimersByTime(500);
    await settle();
    call.resolve('late');
    await settle();
    expect(frame.posts).toEqual([]);
  });

  it('never times out with tokenTimeoutMs 0', async () => {
    useFakeClock();
    const { log } = askToken(
      { getToken: () => new Promise<string>(() => {}) },
      { tokenTimeoutMs: 0 }
    );
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2 ** 31 - 1);
    await settle();
    expect(errorCodes(log)).toEqual([]);
  });

  it('defaults tokenTimeoutMs to 30 s', async () => {
    useFakeClock();
    const { log } = askToken(
      { getToken: () => new Promise<string>(() => {}) },
      { tokenTimeoutMs: undefined }
    );
    vi.advanceTimersByTime(29_999);
    await settle();
    expect(errorCodes(log)).toEqual([]);
    vi.advanceTimersByTime(1);
    await settle();
    expect(errorCodes(log)).toEqual(['token-timeout']);
  });

  it('drops a token that resolves after destroy()', async () => {
    const call = deferred<string>();
    let signal: AbortSignal | undefined;
    const { frame, session, log } = askToken({
      getToken: (s: AbortSignal) => {
        signal = s;
        return call.promise;
      },
    });
    session.destroy();
    call.resolve('late');
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(frame.posts).toEqual([]);
    expect(errorCodes(log)).toEqual([]);
  });

  it('drops a token already resolved when destroy() runs before its delivery', async () => {
    const frame = adoptedFrame();
    const session = start(
      optionsFor(frame, { auth: { getToken: () => Promise.resolve('tok') } })
    );
    fromFrame(frame, { ready: true });
    frame.posts.length = 0;
    fromFrame(frame, { type: 'token' });
    // getToken has already resolved; destroy() lands in the microtasks between
    // that resolution and the host.token post, where the abort no longer wins.
    queueMicrotask(() => session.destroy());
    await settle();
    expect(session.state).toBe('destroyed');
    expect(frame.posts).toEqual([]);
  });
});

describe('token request without getToken', () => {
  it('answers with publicKey', () => {
    const { frame } = askToken({ publicKey: KEY });
    expect(frame.posts.map((p) => p.message)).toEqual([
      { type: 'token', token: KEY },
    ]);
  });

  it.each([
    ['no auth', undefined],
    ['an empty publicKey', ''],
    ['a null publicKey', null],
  ])('reports token-unavailable with %s and posts nothing', (_, publicKey) => {
    const { frame, log } = askToken(
      publicKey === undefined ? {} : { publicKey }
    );
    expect(tokenError(log)).toBeInstanceOf(AucoTokenError);
    expect(errorCodes(log)).toEqual(['token-unavailable']);
    expect(frame.posts).toEqual([]);
  });

  it('prefers getToken over publicKey', async () => {
    const { frame } = askToken({ publicKey: KEY, getToken: async () => 'tok' });
    await settle();
    expect(frame.posts.map((p) => p.message)).toEqual([
      { type: 'token', token: 'tok' },
    ]);
  });
});
