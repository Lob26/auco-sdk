import { afterEach, describe, expect, it, vi } from 'vitest';
import { AucoConfigError, AucoOptionsError } from '../src/index';
import {
  baseEvents,
  CUSTOM_ORIGIN,
  deferred,
  type FakeFrame,
  fixtureData,
  flush,
  KEY_PUBLIC,
  mountIframe,
  SIGN_ORIGIN,
  sendFromFrame,
  sendReady,
  signConfig,
  srcPattern,
  start,
  TOKEN,
  teardown,
  UPLOAD_ORIGIN,
  VALIDATION_ORIGIN,
} from './support';

// Where compat deliberately differs from 1.0.9, pinned so a regression is
// loud. The 1.x suite only sees these as `legacyOnly` skips or `defect`
// passes; the exact errors and the session bookkeeping behind them live here.

afterEach(() => {
  teardown();
  vi.restoreAllMocks();
});

/**
 * Starts a live sign session on `frame`, so a refused restart can be shown
 * to leave it running: embed refuses the same configs too, but only after
 * releasing the previous session's iframe.
 */
const startLive = (frame: FakeFrame) => {
  const config = signConfig(frame);
  start(config);
  const src = frame.iframe.src;
  return { events: config.events as ReturnType<typeof baseEvents>, src };
};

/** What `start(config)` threw; fails the test if it did not throw. */
const refusal = (config: Record<string, unknown>): unknown => {
  try {
    start(config);
  } catch (error) {
    return error;
  }
  throw new Error('expected start to throw');
};

const expectRefusal = (
  error: unknown,
  Class: typeof AucoConfigError | typeof AucoOptionsError,
  code: string,
  message: string
) => {
  expect((error as object).constructor).toBe(Class);
  expect(error).toHaveProperty('code', code);
  expect(error).toHaveProperty('message', message);
};

const expectStillLive = (
  frame: FakeFrame,
  live: ReturnType<typeof startLive>
) => {
  expect(frame.iframe.src).toBe(live.src);
  sendReady(frame);
  expect(live.events.onSDKReady).toHaveBeenCalledTimes(1);
};

describe('origin refusals (audit 1.2)', () => {
  it('an unknown sdkType is refused even with a valid customOrigin', () => {
    const frame = mountIframe();

    const error = refusal(
      signConfig(frame, { sdkType: 'contrato', customOrigin: CUSTOM_ORIGIN })
    );

    expectRefusal(
      error,
      AucoConfigError,
      'unknown-product',
      'Could not start SDK, unknown sdkType: contrato'
    );
    expect(frame.iframe.src).toBe('');
  });

  it('an inherited key like toString is an unknown sdkType', () => {
    const frame = mountIframe();

    const error = refusal(signConfig(frame, { sdkType: 'toString' }));

    expectRefusal(
      error,
      AucoConfigError,
      'unknown-product',
      'Could not start SDK, unknown sdkType: toString'
    );
    expect(frame.iframe.src).toBe('');
  });

  it('a refused unknown sdkType leaves the iframe’s previous session running', () => {
    const frame = mountIframe();
    const live = startLive(frame);

    expect(() =>
      start(
        signConfig(frame, { sdkType: 'contrato', customOrigin: CUSTOM_ORIGIN })
      )
    ).toThrow('Could not start SDK, unknown sdkType: contrato');

    expectStillLive(frame, live);
  });

  it('list-validation without customOrigin is refused with no-default-origin', () => {
    const frame = mountIframe();

    const error = refusal(signConfig(frame, { sdkType: 'list-validation' }));

    expectRefusal(
      error,
      AucoConfigError,
      'no-default-origin',
      'Could not start SDK, sdkType list-validation has no default origin; set customOrigin'
    );
    expect(frame.iframe.src).toBe('');
  });

  const notOrigins = [
    'https://lista.example.com/',
    'https://lista.example.com/firmas',
    'https://lista.example.com?x=1',
    'HTTPS://Lista.example.com',
    'https://lista.example.com:443',
    'lista.example.com',
    'null',
  ];

  it.each(notOrigins)(
    'customOrigin %s is refused: it is not a serialized origin',
    (customOrigin) => {
      const frame = mountIframe();

      const error = refusal(signConfig(frame, { customOrigin }));

      expectRefusal(
        error,
        AucoOptionsError,
        'invalid-option',
        `Could not start SDK, customOrigin must be an origin like https://host[:port], received: ${customOrigin}`
      );
      expect(frame.iframe.src).toBe('');
    }
  );

  it('a refused customOrigin leaves the iframe’s previous session running', () => {
    const frame = mountIframe();
    const live = startLive(frame);

    expect(() =>
      start(signConfig(frame, { customOrigin: 'https://lista.example.com/' }))
    ).toThrow(/customOrigin must be an origin/);

    expectStillLive(frame, live);
  });

  it.each(['http://localhost:5174', 'https://lista.example.com:8443'])(
    'customOrigin %s is a serialized origin and loads',
    (customOrigin) => {
      const frame = mountIframe();

      start(signConfig(frame, { customOrigin }));

      expect(frame.iframe.src).toMatch(srcPattern(customOrigin));
    }
  );
});

describe('the 1.x start-time messages come before the origin refusal', () => {
  const badOrigins = [
    { origin: 'an unknown sdkType', badOverrides: { sdkType: 'contrato' } },
    {
      origin: 'list-validation without customOrigin',
      badOverrides: { sdkType: 'list-validation' },
    },
    {
      origin: 'a customOrigin that is not an origin',
      badOverrides: { customOrigin: 'https://lista.example.com/' },
    },
  ];
  const checks = [
    {
      fault: 'iframe not found',
      overrides: { iframeId: 'otro' },
      error: 'Could not start SDK, Iframe with id: otro not found',
    },
    {
      fault: 'onSDKToken missing',
      overrides: { keyPublic: 'puk_corta' },
      error: 'Could not start SDK, onSDKToken is missing',
    },
    {
      fault: 'invalid keyPublic',
      overrides: {
        keyPublic: 'puk_corta',
        events: { ...baseEvents(), onSDKToken: vi.fn() },
      },
      error: 'Could not start SDK, invalid keyPublic',
    },
  ];

  it.each(
    checks.flatMap((check) => badOrigins.map((bad) => ({ ...check, ...bad })))
  )(
    '$fault with $origin throws the 1.x message',
    ({ overrides, error, badOverrides }) => {
      const frame = mountIframe();

      const thrown = refusal(
        signConfig(frame, { ...badOverrides, ...overrides })
      );

      expect((thrown as object).constructor).toBe(Error);
      expect(thrown).toHaveProperty('message', error);
      expect(frame.iframe.src).toBe('');
    }
  );
});

describe('one session per iframe (audit 1.6)', () => {
  it('a second AucoSDK on the same iframe ends the first one’s callbacks', () => {
    const frame = mountIframe();
    const first = signConfig(frame);
    const second = signConfig(frame);
    start(first);
    start(second);

    sendReady(frame);

    expect(
      (first.events as ReturnType<typeof baseEvents>).onSDKReady
    ).not.toHaveBeenCalled();
    expect(
      (second.events as ReturnType<typeof baseEvents>).onSDKReady
    ).toHaveBeenCalledTimes(1);
  });

  it('a second AucoSDK on the same iframe loads its own origin', () => {
    const frame = mountIframe();
    start(signConfig(frame));

    start(
      signConfig(frame, {
        sdkType: 'upload',
        sdkData: { uxOptions: {} },
      })
    );

    expect(frame.iframe.src).toMatch(srcPattern(UPLOAD_ORIGIN));
  });

  it('the first unsubscribe after a restart leaves the new session alone', () => {
    const frame = mountIframe();
    const unsubscribeFirst = start(signConfig(frame));
    const second = signConfig(frame);
    start(second);
    const src = frame.iframe.src;

    unsubscribeFirst();

    expect(frame.iframe.src).toBe(src);
    sendReady(frame);
    expect(
      (second.events as ReturnType<typeof baseEvents>).onSDKReady
    ).toHaveBeenCalledTimes(1);
  });

  it('a session on another iframe is not ended by a new one', () => {
    const a = mountIframe('firma-a');
    const b = mountIframe('firma-b');
    const first = signConfig(a);
    start(first);
    start(signConfig(b));

    sendReady(a);

    expect(
      (first.events as ReturnType<typeof baseEvents>).onSDKReady
    ).toHaveBeenCalledTimes(1);
  });
});

describe('unsubscribe', () => {
  it('points the iframe at about:blank', () => {
    const frame = mountIframe();
    const unsubscribe = start(signConfig(frame));

    unsubscribe();

    expect(frame.iframe.src).toBe('about:blank');
  });

  it('after a terminal close still points the iframe at about:blank', async () => {
    const frame = mountIframe();
    const unsubscribe = start(signConfig(frame));
    sendFromFrame(frame, fixtureData('frame.close', 'sign'));
    await flush();

    unsubscribe();

    expect(frame.iframe.src).toBe('about:blank');
  });

  it('a second call is a no-op', () => {
    const frame = mountIframe();
    const unsubscribe = start(signConfig(frame));
    unsubscribe();
    frame.iframe.src = 'https://otra.example.com/';

    unsubscribe();

    expect(frame.iframe.src).toBe('https://otra.example.com/');
  });
});

describe('a token that resolves after the session ended is dropped', () => {
  const startWithPendingToken = (frame: FakeFrame, origin = SIGN_ORIGIN) => {
    const token = deferred<string>();
    const onSDKError = vi.fn();
    const events = {
      ...baseEvents(),
      onSDKToken: vi.fn(() => token.promise),
      onSDKError,
    };
    const unsubscribe = start({
      ...signConfig(frame, { keyPublic: KEY_PUBLIC, events }),
      ...(origin === VALIDATION_ORIGIN ? { sdkType: 'validation' } : {}),
    });
    sendFromFrame(frame, fixtureData('frame.token-request'), origin);
    return { token, onSDKError, unsubscribe };
  };

  it('after a terminal close (1.0.9 still posted it)', async () => {
    const frame = mountIframe();
    const { token, onSDKError } = startWithPendingToken(frame);
    sendFromFrame(frame, fixtureData('frame.close', 'sign'));
    await flush();

    token.resolve(TOKEN);
    await flush();

    expect(frame.postMessage).not.toHaveBeenCalled();
    expect(onSDKError).not.toHaveBeenCalled();
  });

  it('after unsubscribe', async () => {
    const frame = mountIframe();
    const { token, onSDKError, unsubscribe } = startWithPendingToken(frame);
    unsubscribe();

    token.resolve(TOKEN);
    await flush();

    expect(frame.postMessage).not.toHaveBeenCalled();
    expect(onSDKError).not.toHaveBeenCalled();
  });

  it('but a PENDING close is not terminal, so the token is still posted', async () => {
    const frame = mountIframe();
    const { token } = startWithPendingToken(frame, VALIDATION_ORIGIN);
    sendFromFrame(
      frame,
      fixtureData('frame.close', 'validation-pending'),
      VALIDATION_ORIGIN
    );
    await flush();

    token.resolve(TOKEN);
    await flush();

    expect(frame.postMessage.mock.calls).toStrictEqual([
      [fixtureData('host.token'), VALIDATION_ORIGIN],
    ]);
  });
});
