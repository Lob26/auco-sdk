import { describe, expect, it, vi } from 'vitest';
import {
  adoptedFrame,
  deferred,
  detach,
  errorCodes,
  fromFrame,
  names,
  optionsFor,
  record,
  settle,
  start,
  useFakeClock,
} from './support';

// Every emit runs integrator code, and integrator code may call destroy() from
// inside any listener. These pin the reentrant paths the wave-1 verifiers
// broke: once destroyed, nothing moves the session back or emits for it.
describe('destroy() from inside a listener', () => {
  const failingPosts = {
    'frame-unreachable': () => {
      const frame = adoptedFrame();
      return { frame, breakIt: () => detach(frame.iframe) };
    },
    'post-failed': () => {
      const frame = adoptedFrame(() => {
        throw new DOMException('could not be cloned', 'DataCloneError');
      });
      return { frame, breakIt: () => {} };
    },
  };

  it.each(Object.entries(failingPosts))(
    'in the error listener of a %s host.init ends destroyed, never ready',
    async (code, make) => {
      const { frame, breakIt } = make();
      const session = start(optionsFor(frame));
      const log = record(session);
      session.addEventListener('error', () => session.destroy());
      breakIt();
      fromFrame(frame, { ready: true });
      expect(session.state).toBe('destroyed');
      expect(names(log)).toEqual(['error', 'statechange:destroyed']);
      expect(errorCodes(log)).toEqual([code]);
      expect(await session.done).toEqual({ reason: 'destroyed' });
    }
  );

  it('in a statechange listener suppresses the ready event', () => {
    const frame = adoptedFrame();
    const session = start(optionsFor(frame));
    session.addEventListener('statechange', (event) => {
      if (event.detail.state === 'ready') session.destroy();
    });
    const log = record(session);
    fromFrame(frame, { ready: true });
    expect(session.state).toBe('destroyed');
    expect(names(log)).not.toContain('ready');
  });

  it('makes a waitUntil promise that settles later emit nothing', async () => {
    const frame = adoptedFrame();
    const session = start(optionsFor(frame));
    fromFrame(frame, { ready: true });
    const rejecting = deferred<void>();
    const resolving = deferred<void>();
    session.addEventListener('finish', (event) => {
      event.detail.waitUntil(rejecting.promise);
    });
    session.addEventListener('back', (event) => {
      event.detail.waitUntil(resolving.promise);
    });
    fromFrame(frame, { type: 'SDK-FINISH' });
    fromFrame(frame, { type: 'SDK-BACK' });
    session.destroy();
    const log = record(session);
    rejecting.reject(new Error('late'));
    resolving.resolve();
    await settle();
    expect(log).toEqual([]);
    expect(session.state).toBe('destroyed');
  });

  it('in the first error listener of two rejected waits emits one error', async () => {
    const frame = adoptedFrame();
    const session = start(optionsFor(frame));
    fromFrame(frame, { ready: true });
    session.addEventListener('finish', (event) => {
      event.detail.waitUntil(Promise.reject(new Error('one')));
      event.detail.waitUntil(Promise.reject(new Error('two')));
    });
    session.addEventListener('error', () => session.destroy());
    const log = record(session);
    fromFrame(frame, { type: 'SDK-FINISH' });
    await settle();
    expect(errorCodes(log)).toEqual(['handler-rejected']);
    expect(session.state).toBe('destroyed');
  });

  it('in a statechange listener settles the pending getToken and leaks no timer', async () => {
    useFakeClock();
    let signal: AbortSignal | undefined;
    const frame = adoptedFrame();
    const session = start(
      optionsFor(frame, {
        tokenTimeoutMs: 1000,
        auth: {
          getToken: (s: AbortSignal) => {
            signal = s;
            return new Promise<string>(() => {});
          },
        },
      })
    );
    fromFrame(frame, { ready: true });
    session.addEventListener('statechange', (event) => {
      if (event.detail.state === 'awaiting-token') session.destroy();
    });
    const log = record(session);
    fromFrame(frame, { type: 'token' });
    await settle();
    expect(session.state).toBe('destroyed');
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(errorCodes(log)).toEqual([]);
  });
});
