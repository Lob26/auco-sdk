import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  baseEvents,
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
  UX_OPTIONS,
  VALIDATION_ORIGIN,
} from './support';

// 1.0.9 behavior the 1.x suite cannot see: it compares with toStrictEqual
// (blind to key order), only feeds well-formed payloads, and never waits
// past a real-world timeout. Each case here would let a 1.x integration
// break while that suite stays green.

afterEach(() => {
  vi.useRealTimers();
  teardown();
  vi.restoreAllMocks();
});

const setPageURL = (url: string): void => {
  (
    window as unknown as { happyDOM: { setURL(url: string): void } }
  ).happyDOM.setURL(url);
};

describe('host.init key order', () => {
  // Configs are literals; the fixture is only the expected wire payload.
  it.each([
    {
      variant: 'sign',
      origin: SIGN_ORIGIN,
      pageURL: 'https://app.example.com/contratos/firmar',
      sdkData: {
        document: 'DOC0000000AA',
        signFlow: 'document',
        uxOptions: UX_OPTIONS,
      },
    },
    {
      variant: 'upload',
      origin: UPLOAD_ORIGIN,
      pageURL: 'https://app.example.com/contratos/nuevo',
      sdkData: {
        userAttributes: { email: 'admin@example.com' },
        uxOptions: UX_OPTIONS,
      },
    },
  ])(
    '$variant: serializes byte for byte like the host.init fixture',
    ({ variant, origin, pageURL, sdkData }) => {
      setPageURL(pageURL);
      const frame = mountIframe();
      start({
        sdkType: variant,
        env: 'PROD',
        iframeId: frame.iframe.id,
        language: 'es',
        keyPublic: KEY_PUBLIC,
        sdkData,
        events: baseEvents(),
      });

      sendReady(frame, origin);

      expect(JSON.stringify(frame.postMessage.mock.calls[0]?.[0])).toBe(
        JSON.stringify(fixtureData('host.init', variant))
      );
    }
  );
});

describe('onSDKClose(a, b, signProfile) takes the raw fields with ??', () => {
  const closeWith = async (fields: Record<string, unknown>) => {
    const frame = mountIframe();
    const events = baseEvents();
    start(signConfig(frame, { sdkType: 'validation', events }));
    sendFromFrame(frame, { type: 'SDK-CLOSE', ...fields }, VALIDATION_ORIGIN);
    await flush();
    return { frame, events };
  };

  it("status '' with no redirectTo is passed as ''", async () => {
    const { events } = await closeWith({ status: '' });

    expect(events.onSDKClose.mock.calls).toStrictEqual([['', '', []]]);
  });

  it("status '' is terminal: the session ends", async () => {
    const { frame, events } = await closeWith({ status: '' });

    sendReady(frame, VALIDATION_ORIGIN);

    expect(events.onSDKReady).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'a falsy non-string status is kept, not replaced by ""',
      fields: { status: 0 },
      args: ['', 0, []],
    },
    {
      name: 'a false similarity and status are kept',
      fields: { similarity: false, status: false },
      args: [false, false, []],
    },
    {
      name: 'a null redirectTo falls through to status',
      fields: { redirectTo: null, status: 'APPROVED' },
      args: ['', 'APPROVED', []],
    },
    {
      name: 'a null document falls through to similarity',
      fields: { document: null, similarity: 'APROBADO' },
      args: ['APROBADO', '', []],
    },
    {
      name: 'a non-string document and a non-array signProfile pass as sent',
      fields: { document: 42, signProfile: { id: 'AA' } },
      args: [42, '', { id: 'AA' }],
    },
    {
      name: 'a null signProfile becomes []',
      fields: { signProfile: null },
      args: ['', '', []],
    },
  ])('$name', async ({ fields, args }) => {
    const { events } = await closeWith(fields);

    expect(events.onSDKClose.mock.calls).toStrictEqual([args]);
  });
});

describe('DEV without a usable keyPublic loads the internal *-dev host, like 1.0.9', () => {
  it.each(
    [
      { keyPublic: '', sdkType: 'sign', origin: 'https://sign-dev.auco.ai' },
      { keyPublic: null, sdkType: 'sign', origin: 'https://sign-dev.auco.ai' },
      {
        keyPublic: '',
        sdkType: 'validation',
        origin: 'https://veriface-dev.auco.ai',
      },
      {
        keyPublic: null,
        sdkType: 'upload-v2',
        origin: 'https://uploadv2-dev.auco.ai',
      },
      // 1.0.9's DEV map sends fill to fill2-stage (audit 3.6).
      { keyPublic: '', sdkType: 'fill', origin: 'https://fill2-stage.auco.ai' },
    ].map((c) => ({ ...c, key: JSON.stringify(c.keyPublic) }))
  )(
    '$sdkType with keyPublic $key loads $origin',
    ({ keyPublic, sdkType, origin }) => {
      const frame = mountIframe();

      start(signConfig(frame, { env: 'DEV', keyPublic, sdkType }));

      expect(frame.iframe.src).toMatch(srcPattern(origin));
    }
  );
});

describe('pay, notification and close callbacks get the raw frame values', () => {
  const deliver = async (handler: string, message: Record<string, unknown>) => {
    const frame = mountIframe();
    const callback = vi.fn();
    const onSDKError = vi.fn();
    start(
      signConfig(frame, {
        events: { ...baseEvents(), [handler]: callback, onSDKError },
      })
    );
    sendFromFrame(frame, message);
    await flush();
    expect(onSDKError).not.toHaveBeenCalled();
    return callback;
  };

  it.each([
    { name: 'a code that is not a string', data: { code: 1 } },
    { name: 'no epaycoKey', data: { code: 'DOC0000000AA' } },
    { name: 'a string', data: 'pago' },
    { name: 'null', data: null },
  ])('onSDKPay receives data.data with $name', async ({ data }) => {
    const onSDKPay = await deliver('onSDKPay', { type: 'SDK-PAY', data });

    expect(onSDKPay.mock.calls).toStrictEqual([[data]]);
  });

  it('onSDKPay receives the extra fields of a well-formed payment', async () => {
    const data = {
      code: 'DOC0000000AA',
      epaycoKey: 'epayco_fake_00000000',
      extra: { nested: [1] },
    };

    const onSDKPay = await deliver('onSDKPay', { type: 'SDK-PAY', data });

    expect(onSDKPay.mock.calls).toStrictEqual([[data]]);
  });

  // 1.0.9 handed over event.data.data itself, not a copy equal by value.
  it.each([
    { handler: 'onSDKPay', type: 'SDK-PAY' },
    { handler: 'onSDKNotification', type: 'SDK-NOTIFICATION' },
  ])(
    '$handler receives the very object the frame sent, not a copy',
    async ({ handler, type }) => {
      const data = { code: 'DOC0000000AA', nested: { level: [1] } };

      const callback = await deliver(handler, { type, data });

      expect(callback.mock.calls[0]?.[0]).toBe(data);
    }
  );

  it.each([
    { name: 'a message that is not a string', data: { message: 5 } },
    { name: 'no message', data: { options: { body: 'x' } } },
    { name: 'a number', data: 7 },
    { name: 'null', data: null },
  ])('onSDKNotification receives data.data with $name', async ({ data }) => {
    const onSDKNotification = await deliver('onSDKNotification', {
      type: 'SDK-NOTIFICATION',
      data,
    });

    expect(onSDKNotification.mock.calls).toStrictEqual([[data]]);
  });

  it('onSDKClose receives a signProfile whose entries are not shape-checked', async () => {
    const signProfile = [{ id: 1 }, 'firmante', null];

    const onSDKClose = await deliver('onSDKClose', {
      type: 'SDK-CLOSE',
      document: 'DOC0000000AA',
      signProfile,
    });

    expect(onSDKClose.mock.calls).toStrictEqual([
      ['DOC0000000AA', '', signProfile],
    ]);
    // 1.0.9 passed raw.signProfile itself (legacy/src/index.ts:117).
    expect(onSDKClose.mock.calls[0]?.[2]).toBe(signProfile);
  });
});

describe('no token or handshake timeout, like 1.0.9', () => {
  // The longest finite delay embed accepts; it refuses anything larger,
  // which setTimeout would clamp to an immediate fire. Waiting it out rules
  // out every finite timeout compat could pass, not just the shorter ones.
  const LONGEST_TIMEOUT_MS = 0x7fffffff;

  const startQuiet = (frame: FakeFrame, events: Record<string, unknown>) => {
    const onSDKError = vi.fn();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    start(signConfig(frame, { events: { ...events, onSDKError } }));
    return { onSDKError, consoleError };
  };

  it('a frame that sends ready after the longest finite timeout still gets host.init', async () => {
    vi.useFakeTimers();
    const frame = mountIframe();
    const events = baseEvents();
    const { onSDKError, consoleError } = startQuiet(frame, events);

    await vi.advanceTimersByTimeAsync(LONGEST_TIMEOUT_MS);
    sendReady(frame);

    expect(onSDKError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(frame.postMessage).toHaveBeenCalledTimes(1);
    expect(events.onSDKReady).toHaveBeenCalledTimes(1);
  });

  it('an onSDKToken that resolves after the longest finite timeout is still answered', async () => {
    vi.useFakeTimers();
    const frame = mountIframe();
    const token = deferred<string>();
    const { onSDKError, consoleError } = startQuiet(frame, {
      ...baseEvents(),
      onSDKToken: vi.fn(() => token.promise),
    });
    sendFromFrame(frame, fixtureData('frame.token-request'));

    await vi.advanceTimersByTimeAsync(LONGEST_TIMEOUT_MS);
    token.resolve(TOKEN);
    await vi.advanceTimersByTimeAsync(0);

    expect(onSDKError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(frame.postMessage.mock.calls).toStrictEqual([
      [fixtureData('host.token'), SIGN_ORIGIN],
    ]);
  });
});
