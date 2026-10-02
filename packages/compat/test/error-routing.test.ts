import {
  AucoHandlerError,
  AucoProtocolError,
  AucoTokenError,
} from '@lob26/auco-embed';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AucoError } from '../src/index';
import {
  baseEvents,
  captureUnhandledRejections,
  detachContentWindow,
  type FakeFrame,
  fixtureData,
  flush,
  mountIframe,
  sendFromFrame,
  sendReady,
  signConfig,
  start,
  teardown,
} from './support';

// Every failure 1.0.9 let escape as an unhandled rejection reaches
// events.onSDKError as an AucoError subclass with a stable code; without
// onSDKError, and when onSDKError itself fails, it goes to console.error.
// Never to an unhandled rejection. AucoTokenError, AucoHandlerError and
// AucoProtocolError are not exported by compat; integrators tell them apart
// by `code` and `name`, so those are pinned along with the class.

const failure = new Error('integrador falló');

type ErrorClass = abstract new (...args: never[]) => AucoError;

interface Routed {
  error: AucoError;
  rejections: unknown[];
}

/** Starts a sign session with `events`, runs `act` and returns the one report. */
const routeOne = async (
  events: Record<string, unknown>,
  act: (frame: FakeFrame) => void
): Promise<Routed> => {
  const frame = mountIframe();
  const onSDKError = vi.fn();
  start(signConfig(frame, { events: { ...events, onSDKError } }));
  const rejections = await captureUnhandledRejections(() => act(frame));
  expect(onSDKError).toHaveBeenCalledTimes(1);
  return { error: onSDKError.mock.calls[0]?.[0] as AucoError, rejections };
};

/** Instance of exactly `Class` (not a subclass of it) and of compat's AucoError. */
const expectExactly = (error: unknown, Class: ErrorClass, code: string) => {
  expect(error).toBeInstanceOf(AucoError);
  expect((error as object).constructor).toBe(Class);
  expect(error).toHaveProperty('code', code);
  expect(error).toHaveProperty('name', Class.name);
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  teardown();
  vi.restoreAllMocks();
});

describe('each failure reaches onSDKError with its class and code', () => {
  it('a token request without onSDKToken is an AucoTokenError token-unavailable with the 1.x message', async () => {
    const { error, rejections } = await routeOne(baseEvents(), (frame) => {
      sendFromFrame(frame, fixtureData('frame.token-request'));
    });

    expectExactly(error, AucoTokenError, 'token-unavailable');
    expect(error.message).toBe(
      "Could not get token, SDK is asking for user token, but there isn't a onSDKToken function provided"
    );
    expect(rejections).toEqual([]);
  });

  it.each([
    { mode: 'rejects', onSDKToken: () => Promise.reject(failure) },
    {
      mode: 'throws',
      onSDKToken: () => {
        throw failure;
      },
    },
  ])(
    'an onSDKToken that $mode is an AucoTokenError token-failed caused by it',
    async ({ onSDKToken }) => {
      const { error, rejections } = await routeOne(
        { ...baseEvents(), onSDKToken: vi.fn(onSDKToken) },
        (frame) => {
          sendFromFrame(frame, fixtureData('frame.token-request'));
        }
      );

      expectExactly(error, AucoTokenError, 'token-failed');
      expect(error.cause).toBe(failure);
      expect(rejections).toEqual([]);
    }
  );

  it('a payment request without onSDKPay is a plain AucoError missing-handler with the 1.x message', async () => {
    const { error, rejections } = await routeOne(baseEvents(), (frame) => {
      sendFromFrame(frame, fixtureData('frame.pay'));
    });

    expectExactly(error, AucoError, 'missing-handler');
    expect(error.message).toBe(
      "SDK is asking for payment, but there isn't a onSDKPay function provided"
    );
    expect(rejections).toEqual([]);
  });

  const handlers = [
    { handler: 'onSDKReady', message: () => fixtureData('frame.ready') },
    { handler: 'onSDKPay', message: () => fixtureData('frame.pay') },
    {
      handler: 'onSDKNotification',
      message: () => fixtureData('frame.notification'),
    },
    {
      handler: 'onSDKClose',
      message: () => fixtureData('frame.close', 'sign'),
    },
    { handler: 'onSDKFinish', message: () => fixtureData('frame.finish') },
    { handler: 'onSDKBack', message: () => fixtureData('frame.back') },
  ];
  const modes = [
    {
      mode: 'throws',
      callback: () => {
        throw failure;
      },
    },
    { mode: 'rejects', callback: () => Promise.reject(failure) },
  ];

  it.each(handlers.flatMap((h) => modes.map((m) => ({ ...h, ...m }))))(
    'an $handler that $mode is an AucoHandlerError handler-rejected caused by it',
    async ({ handler, message, callback }) => {
      const { error, rejections } = await routeOne(
        { ...baseEvents(), [handler]: vi.fn(callback) },
        (frame) => {
          sendFromFrame(frame, message());
        }
      );

      expectExactly(error, AucoHandlerError, 'handler-rejected');
      expect(error.cause).toBe(failure);
      // The integrator reads this message: it has to say which callback.
      expect(error.message).toContain(handler);
      expect(rejections).toEqual([]);
    }
  );

  it('a host.init to a detached iframe is an AucoProtocolError frame-unreachable', async () => {
    const { error, rejections } = await routeOne(baseEvents(), (frame) => {
      detachContentWindow(frame);
      sendReady(frame);
    });

    expectExactly(error, AucoProtocolError, 'frame-unreachable');
    expect(rejections).toEqual([]);
  });

  it('a postMessage that throws is an AucoProtocolError post-failed caused by the throw', async () => {
    const cloneError = new DOMException(
      'could not be cloned',
      'DataCloneError'
    );
    const { error, rejections } = await routeOne(baseEvents(), (frame) => {
      frame.postMessage.mockImplementation(() => {
        throw cloneError;
      });
      sendReady(frame);
    });

    expectExactly(error, AucoProtocolError, 'post-failed');
    expect(error.cause).toBe(cloneError);
    expect(rejections).toEqual([]);
  });
});

describe('console.error is the fallback', () => {
  const startWithFailingReady = (events: Record<string, unknown>) => {
    const frame = mountIframe();
    start(
      signConfig(frame, {
        events: {
          ...events,
          onSDKReady: vi.fn(() => {
            throw failure;
          }),
        },
      })
    );
    return frame;
  };

  it('without onSDKError the error goes to console.error alone', async () => {
    const frame = startWithFailingReady(baseEvents());

    const rejections = await captureUnhandledRejections(() => {
      sendReady(frame);
    });

    expect(rejections).toEqual([]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [error, ...rest] = consoleError.mock.calls[0] ?? [];
    expectExactly(error, AucoHandlerError, 'handler-rejected');
    expect(rest).toEqual([]);
  });

  it.each([
    {
      mode: 'throws',
      onSDKError: (thrown: Error) => () => {
        throw thrown;
      },
    },
    {
      mode: 'rejects',
      onSDKError: (thrown: Error) => () => Promise.reject(thrown),
    },
  ])(
    'an onSDKError that $mode sends the error and its own failure to console.error',
    async ({ onSDKError }) => {
      const reporterFailure = new Error('onSDKError falló');
      const reporter = vi.fn<(error: AucoError) => unknown>(
        onSDKError(reporterFailure)
      );
      const frame = startWithFailingReady({
        ...baseEvents(),
        onSDKError: reporter,
      });

      const rejections = await captureUnhandledRejections(() => {
        sendReady(frame);
      });

      expect(rejections).toEqual([]);
      expect(reporter).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls).toEqual([
        [reporter.mock.calls[0]?.[0], reporterFailure],
      ]);
    }
  );

  it('with no events object at all a failure still reaches console.error', async () => {
    const frame = mountIframe();
    start(signConfig(frame, { events: undefined }));

    const rejections = await captureUnhandledRejections(() => {
      sendReady(frame);
    });

    expect(rejections).toEqual([]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expectExactly(
      consoleError.mock.calls[0]?.[0],
      AucoHandlerError,
      'handler-rejected'
    );
  });

  it('a reported failure does not end the session', async () => {
    const frame = startWithFailingReady(baseEvents());
    sendReady(frame);
    await flush();

    sendReady(frame);

    expect(frame.postMessage).toHaveBeenCalledTimes(2);
  });
});
