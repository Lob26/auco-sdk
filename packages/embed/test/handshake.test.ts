import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AucoHandshakeTimeout } from '../src/index';
import {
  adoptedFrame,
  errorCodes,
  fromFrame,
  names,
  ORIGIN,
  optionsFor,
  record,
  setPageUrl,
  settle,
  start,
  useFakeClock,
} from './support';

const hostInitFixture = (variant: string) =>
  (
    JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          `../../protocol/fixtures/host.init.${variant}.json`
        ),
        'utf8'
      )
    ) as { data: Record<string, unknown> }
  ).data;

const PAGE = 'https://app.example.com/contratos/nuevo?paso=2#firma';

afterEach(() => {
  setPageUrl('http://localhost:3000/');
});

describe('host.init', () => {
  it.each(['sign', 'upload'])(
    'reproduces host.init.%s byte for byte, posted to the origin',
    (variant) => {
      const expected = hostInitFixture(variant);
      const { language, keyPublic, sdkParentURL, flowType, ...data } = expected;
      setPageUrl(sdkParentURL as string);
      const frame = adoptedFrame();
      start(
        optionsFor(frame, {
          product: variant,
          language,
          data,
          auth: { publicKey: keyPublic },
          parentUrl: 'href',
        })
      );
      fromFrame(frame, { ready: true });
      expect(frame.posts).toHaveLength(1);
      expect(JSON.stringify(frame.posts[0]?.message)).toBe(
        JSON.stringify(expected)
      );
      expect(frame.posts[0]?.targetOrigin).toBe(ORIGIN);
    }
  );

  it('is re-sent on every frame.ready', () => {
    const frame = adoptedFrame();
    start(optionsFor(frame, { data: { document: 'DOC0000000AA' } }));
    fromFrame(frame, { ready: true });
    fromFrame(frame, { ready: true });
    expect(frame.posts).toHaveLength(2);
    expect(frame.posts[1]).toEqual(frame.posts[0]);
  });

  it('carries keyPublic as an own undefined key without auth', () => {
    const frame = adoptedFrame();
    start(optionsFor(frame));
    fromFrame(frame, { ready: true });
    const message = frame.posts[0]?.message as Record<string, unknown>;
    expect(Object.hasOwn(message, 'keyPublic')).toBe(true);
    expect(message.keyPublic).toBeUndefined();
  });

  it.each([null, ''])('sends publicKey %j verbatim', (publicKey) => {
    const frame = adoptedFrame();
    start(optionsFor(frame, { auth: { publicKey } }));
    fromFrame(frame, { ready: true });
    expect(frame.posts[0]?.message).toMatchObject({ keyPublic: publicKey });
  });

  it.each([
    [undefined, 'https://app.example.com'],
    ['origin', 'https://app.example.com'],
    ['href', PAGE],
  ])('parentUrl %s sends %s as sdkParentURL', (parentUrl, expected) => {
    setPageUrl(PAGE);
    const frame = adoptedFrame();
    start(optionsFor(frame, { parentUrl }));
    fromFrame(frame, { ready: true });
    expect(frame.posts[0]?.message).toMatchObject({ sdkParentURL: expected });
  });

  it.each([
    ['origin', 'https://app.example.com', 'https://other.example.com'],
    ['href', PAGE, 'https://other.example.com/despues'],
  ])(
    'parentUrl %s is read at each ready, not at creation',
    (parentUrl, first, second) => {
      setPageUrl(PAGE);
      const frame = adoptedFrame();
      start(optionsFor(frame, { parentUrl }));
      fromFrame(frame, { ready: true });
      setPageUrl('https://other.example.com/despues');
      fromFrame(frame, { ready: true });
      expect(
        frame.posts.map(
          (p) => (p.message as { sdkParentURL: string }).sdkParentURL
        )
      ).toEqual([first, second]);
    }
  );
});

describe('handshake timeout', () => {
  it('fails the session when no ready arrives in time', () => {
    useFakeClock();
    const frame = adoptedFrame();
    const session = start(optionsFor(frame, { handshakeTimeoutMs: 1000 }));
    const log = record(session);
    vi.advanceTimersByTime(999);
    expect(session.state).toBe('loading');
    vi.advanceTimersByTime(1);
    expect(session.state).toBe('failed');
    expect(names(log)).toEqual(['statechange:failed', 'error']);
    expect(errorCodes(log)).toEqual(['handshake-timeout']);
  });

  it('rejects done with the AucoHandshakeTimeout', async () => {
    useFakeClock();
    const frame = adoptedFrame();
    const session = start(optionsFor(frame, { handshakeTimeoutMs: 1000 }));
    vi.advanceTimersByTime(1000);
    const error = await session.done.then(
      () => undefined,
      (reason: unknown) => reason
    );
    expect(error).toBeInstanceOf(AucoHandshakeTimeout);
    expect(error).toMatchObject({ code: 'handshake-timeout' });
  });

  it('never surfaces done as an unhandled rejection', async () => {
    useFakeClock();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const frame = adoptedFrame();
      start(optionsFor(frame, { handshakeTimeoutMs: 1000 }));
      vi.advanceTimersByTime(1000);
      await settle();
      await settle();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('is cleared by a ready', () => {
    useFakeClock();
    const frame = adoptedFrame();
    const session = start(optionsFor(frame, { handshakeTimeoutMs: 1000 }));
    fromFrame(frame, { ready: true });
    vi.advanceTimersByTime(5000);
    expect(session.state).toBe('ready');
  });

  it('is disabled by 0', () => {
    useFakeClock();
    const frame = adoptedFrame();
    const session = start(optionsFor(frame, { handshakeTimeoutMs: 0 }));
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(2 ** 31 - 1);
    expect(session.state).toBe('loading');
  });

  it('defaults to 30 s', () => {
    useFakeClock();
    const frame = adoptedFrame();
    const session = start({
      ...optionsFor(frame),
      handshakeTimeoutMs: undefined,
    });
    vi.advanceTimersByTime(29_999);
    expect(session.state).toBe('loading');
    vi.advanceTimersByTime(1);
    expect(session.state).toBe('failed');
  });

  it('a ready after the failure posts nothing', () => {
    useFakeClock();
    const frame = adoptedFrame();
    const session = start(optionsFor(frame, { handshakeTimeoutMs: 10 }));
    vi.advanceTimersByTime(10);
    fromFrame(frame, { ready: true });
    expect(session.state).toBe('failed');
    expect(frame.posts).toEqual([]);
  });
});
