import { describe, expect, it } from 'vitest';
import { AucoHandlerError, type AucoSession } from '../src/index';
import {
  adoptedFrame,
  deferred,
  type Entry,
  fromFrame,
  optionsFor,
  record,
  settle,
  start,
} from './support';

const ready = () => {
  const frame = adoptedFrame();
  const session = start(optionsFor(frame));
  fromFrame(frame, { ready: true });
  return { frame, session, log: record(session) };
};

/** Every listener of `type` passes these promises to waitUntil. */
const holdWith = (
  session: AucoSession,
  type: 'close' | 'finish' | 'back',
  ...promises: Promise<unknown>[]
) => {
  session.addEventListener(type, (event) => {
    for (const promise of promises) event.detail.waitUntil(promise);
  });
};

const errorEntry = (log: Entry[]) => {
  const entry = log.find((e) => e.type === 'error');
  return entry?.type === 'error' ? entry.detail.error : undefined;
};

const TERMINAL: ['close' | 'finish' | 'back', string][] = [
  ['close', 'SDK-CLOSE'],
  ['finish', 'SDK-FINISH'],
  ['back', 'SDK-BACK'],
];

describe('waitUntil', () => {
  it.each(TERMINAL)(
    'holds a %s open until its promise settles',
    async (type, wire) => {
      const { frame, session } = ready();
      const hold = deferred<void>();
      holdWith(session, type, hold.promise);
      fromFrame(frame, { type: wire });
      await settle();
      expect(session.state).toBe('ready');
      hold.resolve();
      await settle();
      expect(session.state).toBe('closed');
      expect((await session.done).reason).toBe(type);
    }
  );

  it('closes only once every promise settles', async () => {
    const { frame, session } = ready();
    const first = deferred<void>();
    const second = deferred<void>();
    holdWith(session, 'finish', first.promise, second.promise);
    fromFrame(frame, { type: 'SDK-FINISH' });
    first.resolve();
    await settle();
    expect(session.state).toBe('ready');
    second.resolve();
    await settle();
    expect(session.state).toBe('closed');
  });

  it('a rejection reports AucoHandlerError and keeps the session open', async () => {
    const { frame, session, log } = ready();
    const reason = new Error('save failed');
    holdWith(session, 'close', Promise.reject(reason));
    fromFrame(frame, { type: 'SDK-CLOSE' });
    await settle();
    const error = errorEntry(log);
    expect(error).toBeInstanceOf(AucoHandlerError);
    expect(error?.code).toBe('handler-rejected');
    expect(error?.cause).toBe(reason);
    expect(session.state).toBe('ready');
  });

  it('after a rejected wait, a later close still ends the session', async () => {
    const { frame, session } = ready();
    let first = true;
    session.addEventListener('close', (event) => {
      if (first) event.detail.waitUntil(Promise.reject(new Error('x')));
      first = false;
    });
    fromFrame(frame, { type: 'SDK-CLOSE', document: 'DOC0000000AA' });
    await settle();
    fromFrame(frame, { type: 'SDK-CLOSE', document: 'DOC0000000BB' });
    const done = await session.done;
    expect(done.reason === 'close' && done.message.document).toBe(
      'DOC0000000BB'
    );
  });

  it('a held PENDING close never ends the session', async () => {
    const { frame, session } = ready();
    holdWith(session, 'close', Promise.resolve());
    fromFrame(frame, { type: 'SDK-CLOSE', status: 'PENDING' });
    await settle();
    expect(session.state).toBe('ready');
  });

  it('throws InvalidStateError once dispatch has returned', () => {
    const { frame, session } = ready();
    let late: ((promise: PromiseLike<unknown>) => void) | undefined;
    session.addEventListener('close', (event) => {
      late = event.detail.waitUntil;
    });
    fromFrame(frame, { type: 'SDK-CLOSE', status: 'PENDING' });
    expect(() => late?.(Promise.resolve())).toThrow(
      expect.objectContaining({ name: 'InvalidStateError' })
    );
  });

  it('a waitUntil after dispatch does not hold the session', () => {
    const { frame, session } = ready();
    let late: ((promise: PromiseLike<unknown>) => void) | undefined;
    session.addEventListener('finish', (event) => {
      late = event.detail.waitUntil;
    });
    fromFrame(frame, { type: 'SDK-FINISH' });
    expect(session.state).toBe('closed');
    expect(() => late?.(new Promise(() => {}))).toThrow(DOMException);
  });
});
