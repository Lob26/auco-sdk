import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  baseEvents,
  captureUnhandledRejections,
  deferred,
  type FakeFrame,
  fixture,
  flush,
  KEY_PUBLIC,
  mountIframe,
  sendFromFrame,
  start,
  teardown,
} from './support';

// One `it.fails` per 🔴 finding of the 1.x audit that is observable at
// runtime: https://github.com/Lob26/auco-sdk/issues/1
// Each test asserts the CORRECT behavior, so it fails against 1.0.9 and
// `it.fails` turns that failure green. Phase 1 fixes the defect and flips the
// test to `it`; a fix that lands without the flip turns the suite red.
// Every test here fails on its own `expect`, never on a crash of the setup:
// a crash would keep `it.fails` green after the defect is fixed.

const SIGN_ORIGIN = 'https://sign.auco.ai';
const UX_OPTIONS = { primaryColor: '#021c30', alternateColor: '#a557f2' };

/**
 * Upper bound for how long the host may leave a token request unanswered.
 * The protocol sets none (PROTOCOL.md §4, question 2); any timeout under this
 * satisfies the test, and five minutes is past any sane token backend.
 */
const TOKEN_TIMEOUT_BOUND_MS = 5 * 60_000;

const signConfig = (
  frame: FakeFrame,
  overrides: Record<string, unknown> = {}
) => ({
  sdkType: 'sign',
  env: 'PROD',
  iframeId: frame.iframe.id,
  language: 'es',
  sdkData: { document: 'DOC0000000AA', uxOptions: UX_OPTIONS },
  events: baseEvents(),
  ...overrides,
});

/** Errors the JS runtime raises on its own: a crash, not a refusal. */
const RUNTIME_ERRORS = [TypeError, ReferenceError, RangeError, SyntaxError];

const startOutcome = (
  frame: FakeFrame,
  config: Record<string, unknown>
): { refused: unknown } | { src: string } => {
  try {
    start(config);
  } catch (error) {
    return { refused: error };
  }
  return { src: frame.iframe.src };
};

/**
 * What a failed token request must look like on the wire. 1.0.9 has no such
 * message and the protocol does not name one yet (PROTOCOL.md §4, question 2),
 * so this pins what any design has to satisfy: exactly one message to the
 * frame's origin, whose `type` names an error, and which carries no `token`.
 * A `host.token` with a bogus token (a Promise, `undefined`) does not pass.
 */
const expectTokenFailureReported = (frame: FakeFrame) => {
  expect(frame.postMessage.mock.calls).toEqual([
    [
      expect.objectContaining({ type: expect.stringMatching(/error/i) }),
      SIGN_ORIGIN,
    ],
  ]);
  expect(frame.postMessage.mock.calls[0]?.[0]).not.toHaveProperty('token');
};

afterEach(() => {
  vi.useRealTimers();
  teardown();
  vi.restoreAllMocks();
});

describe('known defects of 1.0.9 (Lob26/auco-sdk#1)', () => {
  it.fails('1.1 a frame does not reach the listener of another iframe of the same origin', async () => {
    const a = mountIframe('firma-a');
    const b = mountIframe('firma-b');
    start(signConfig(a));
    const configB = signConfig(b);
    start(configB);

    sendFromFrame(SIGN_ORIGIN, fixture('frame.close', 'sign').data, a.window);
    await flush();

    expect(configB.events.onSDKClose).not.toHaveBeenCalled();
  });

  it.fails.each([
    {
      name: 'list-validation without customOrigin',
      sdkType: 'list-validation',
    },
    { name: 'an unknown sdkType', sdkType: 'no-existe' },
  ])(
    '1.2 $name is refused at start with a deliberate error, or loads an absolute https URL',
    ({ sdkType }) => {
      const frame = mountIframe('auco');
      const outcome = startOutcome(
        frame,
        signConfig(frame, { sdkType, keyPublic: KEY_PUBLIC })
      );
      if ('refused' in outcome) {
        // A refusal names what is wrong; a runtime crash is not a refusal.
        const error = outcome.refused;
        expect(error).toBeInstanceOf(Error);
        for (const runtime of RUNTIME_ERRORS) {
          expect(error).not.toBeInstanceOf(runtime);
        }
        expect((error as Error).message).toMatch(/sdkType|customOrigin/);
        expect(frame.iframe.src).toBe('');
        return;
      }
      expect(outcome.src).toMatch(/^https:\/\//);
    }
  );

  it.fails.each([
    {
      name: 'a token request without onSDKToken',
      message: () => fixture('frame.token-request').data,
      events: () => baseEvents(),
    },
    {
      name: 'a payment request without onSDKPay',
      message: () => fixture('frame.pay').data,
      events: () => baseEvents(),
    },
    {
      name: 'an integrator handler that throws',
      message: () => fixture('frame.notification').data,
      events: () => ({
        ...baseEvents(),
        onSDKNotification: vi.fn(() => {
          throw new Error('integrador falló');
        }),
      }),
    },
  ])(
    '1.3 $name does not end in an unhandled rejection',
    async ({ message, events }) => {
      const frame = mountIframe('auco');
      start(signConfig(frame, { events: events() }));

      const rejections = await captureUnhandledRejections(() => {
        sendFromFrame(SIGN_ORIGIN, message(), frame.window);
      });

      expect(rejections).toEqual([]);
    }
  );

  it.fails('1.4 a rejected onSDKToken is reported to the frame', async () => {
    const frame = mountIframe('auco');
    const onSDKToken = vi.fn(() =>
      Promise.reject(new Error('token backend down'))
    );
    start(signConfig(frame, { events: { ...baseEvents(), onSDKToken } }));

    // The rejection is the defect's other half (1.3); captured so it is
    // asserted on here rather than failing the whole run.
    await captureUnhandledRejections(() => {
      sendFromFrame(
        SIGN_ORIGIN,
        fixture('frame.token-request').data,
        frame.window
      );
    });

    expect(onSDKToken).toHaveBeenCalledTimes(1);
    expectTokenFailureReported(frame);
  });

  it.fails('1.4 an onSDKToken that never settles times out and is reported to the frame', async () => {
    vi.useFakeTimers();
    const frame = mountIframe('auco');
    const onSDKToken = vi.fn(() => new Promise<string>(() => {}));
    start(signConfig(frame, { events: { ...baseEvents(), onSDKToken } }));

    sendFromFrame(
      SIGN_ORIGIN,
      fixture('frame.token-request').data,
      frame.window
    );
    await vi.advanceTimersByTimeAsync(TOKEN_TIMEOUT_BOUND_MS);

    expect(onSDKToken).toHaveBeenCalledTimes(1);
    expectTokenFailureReported(frame);
  });

  it.fails('1.4 concurrent token requests are each answered with their own correlation id', async () => {
    const frame = mountIframe('auco');
    const first = deferred<string>();
    const second = deferred<string>();
    const onSDKToken = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    start(signConfig(frame, { events: { ...baseEvents(), onSDKToken } }));

    // The frame's real request literal is unknown (PROTOCOL.md §4, question
    // 1); `id` stands for whatever correlation the fixed protocol adopts.
    sendFromFrame(SIGN_ORIGIN, { type: 'token', id: 'req-a' }, frame.window);
    sendFromFrame(SIGN_ORIGIN, { type: 'token', id: 'req-b' }, frame.window);
    second.resolve('token-b'); // resolves out of order
    await flush();
    first.resolve('token-a');
    await flush();

    const answers = frame.postMessage.mock.calls.map(
      ([answer]) => answer as Record<string, unknown>
    );
    expect(answers).toHaveLength(2);
    for (const [request, token] of [
      ['req-a', 'token-a'],
      ['req-b', 'token-b'],
    ] as const) {
      const answer = answers.find((a) => a.token === token);
      expect(Object.values(answer ?? {})).toContain(request);
    }
  });

  it.fails('1.6 unsubscribe stops the iframe', () => {
    const frame = mountIframe('auco');
    const unsubscribe = start(signConfig(frame));

    unsubscribe();

    expect(frame.iframe.src).not.toMatch(/^https:\/\/sign\.auco\.ai\?id=/);
  });

  it.fails.each([
    { message: 'frame.finish', handler: 'onSDKFinish' },
    { message: 'frame.back', handler: 'onSDKBack' },
  ])(
    '1.6 $message without $handler still ends the session',
    async ({ message }) => {
      const frame = mountIframe('auco');
      const config = signConfig(frame);
      start(config);

      sendFromFrame(SIGN_ORIGIN, fixture(message).data, frame.window);
      await flush();
      sendFromFrame(SIGN_ORIGIN, fixture('frame.ready').data, frame.window);

      expect(config.events.onSDKReady).not.toHaveBeenCalled();
    }
  );

  it.fails('1.6 starting twice on the same iframe does not stack listeners', () => {
    const frame = mountIframe('auco');
    start(signConfig(frame));
    start(signConfig(frame));

    sendFromFrame(SIGN_ORIGIN, fixture('frame.ready').data, frame.window);

    expect(frame.postMessage).toHaveBeenCalledTimes(1);
  });

  it.fails('6.2 DEV without keyPublic, as docs.auco.ai/sdk/signature shows, does not load an internal *-dev host', () => {
    const frame = mountIframe('auco');
    start(signConfig(frame, { env: 'DEV' }));

    expect(frame.iframe.src).not.toMatch(/^https:\/\/[a-z0-9]+-dev\.auco\.ai/);
  });
});
