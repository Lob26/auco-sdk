import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  baseEvents,
  captureUnhandledRejections,
  deferred,
  detachContentWindow,
  type FakeFrame,
  fixture,
  flush,
  ID_QUERY,
  KEY_PUBLIC,
  mountIframe,
  readProtocol,
  SDK_TYPES,
  type SdkType,
  sendFromFrame,
  setPageURL,
  start,
  teardown,
} from './support';

// Pins what auco-sdk-integration 1.0.9 does today, driven by
// packages/protocol/fixtures. Defects are pinned as they are; the correct
// behavior lives in known-defects.test.ts.
//
// A fixture is never both the input and the expected value of one test:
// host→frame fixtures are compared to what 1.0.9 builds from a literal config,
// and frame→host fixtures are sent in and their effect is compared to
// literals. Editing a fixture value therefore fails a test here.

const UX_OPTIONS = { primaryColor: '#021c30', alternateColor: '#a557f2' };
const SIGN_ORIGIN = 'https://sign.auco.ai';
const UPLOAD_ORIGIN = 'https://upload.auco.ai';
const VALIDATION_ORIGIN = 'https://veriface.auco.ai';
const CUSTOM_ORIGIN = 'https://lista.example.com';
const TOKEN = 'fake-session-token-0000';

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const srcPattern = (origin: string) =>
  new RegExp(`^${escapeRegExp(origin)}${ID_QUERY}$`);

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

const sendReady = (frame: FakeFrame, origin = SIGN_ORIGIN) => {
  sendFromFrame(origin, fixture('frame.ready').data, frame.window);
};

afterEach(() => {
  teardown();
  vi.restoreAllMocks();
});

/**
 * Origin table of PROTOCOL.md §1.1, parsed so the doc and the code cannot
 * drift apart: one row per sdkType, columns PROD | STAGE or DEV with key |
 * DEV without key.
 */
const originTable = new Map(
  [...readProtocol().matchAll(/^\| `([a-z0-9-]+)` \|(.+)\|\s*$/gm)]
    .filter((row) => (SDK_TYPES as readonly string[]).includes(row[1] ?? ''))
    .map((row) => {
      const cells = (row[2] ?? '').split('|').map((cell) => {
        const value = cell.trim().replace(/^`|`$/g, '');
        return value === "''" ? '' : value;
      });
      return [row[1] as SdkType, cells] as const;
    })
);

describe('iframe.src per sdkType × env (PROTOCOL.md §1.1)', () => {
  it('the origin table lists every sdkType with three columns', () => {
    expect([...originTable.keys()].sort()).toEqual([...SDK_TYPES].sort());
    for (const cells of originTable.values()) expect(cells).toHaveLength(3);
  });

  const scenarios = [
    { env: 'PROD', keyPublic: KEY_PUBLIC, column: 0 },
    { env: 'PROD', keyPublic: undefined, column: 0 },
    { env: 'STAGE', keyPublic: KEY_PUBLIC, column: 1 },
    { env: 'STAGE', keyPublic: undefined, column: 1 },
    { env: 'DEV', keyPublic: KEY_PUBLIC, column: 1 },
    { env: 'DEV', keyPublic: undefined, column: 2 },
  ] as const;

  const cases = SDK_TYPES.flatMap((sdkType) =>
    scenarios.map((s) => ({
      sdkType,
      ...s,
      key: s.keyPublic ? 'with keyPublic' : 'without keyPublic',
    }))
  );

  it.each(cases)(
    '$sdkType, $env $key',
    ({ sdkType, env, keyPublic, column }) => {
      const origin = originTable.get(sdkType)?.[column];
      expect(origin).toBeTypeOf('string');
      const frame = mountIframe('auco');
      start({
        sdkType,
        env,
        iframeId: 'auco',
        language: 'es',
        sdkData: { uxOptions: UX_OPTIONS },
        events: baseEvents(),
        ...(keyPublic ? { keyPublic } : {}),
      });
      expect(frame.iframe.src).toMatch(srcPattern(origin ?? '<missing>'));
    }
  );

  it('customOrigin wins over sdkType and env', () => {
    const frame = mountIframe('auco');
    start(signConfig(frame, { env: 'DEV', customOrigin: CUSTOM_ORIGIN }));
    expect(frame.iframe.src).toMatch(srcPattern(CUSTOM_ORIGIN));
  });

  // Rule 4 of §1.1 is "anything that is not DEV or STAGE", not "PROD".
  it.each(['prod', 'TEST', undefined])(
    'env %s falls through to the PROD map',
    (env) => {
      const frame = mountIframe('auco');
      start(signConfig(frame, { env }));
      expect(frame.iframe.src).toMatch(srcPattern(SIGN_ORIGIN));
    }
  );

  it('an unknown sdkType resolves to undefined and loads undefined?id=…', () => {
    const frame = mountIframe('auco');
    start(signConfig(frame, { sdkType: 'contrato' }));
    expect(frame.iframe.src).toMatch(srcPattern('undefined'));
  });

  it("customOrigin '' is ignored: the sdkType × env table decides", () => {
    const frame = mountIframe('auco');
    start(signConfig(frame, { customOrigin: '' }));
    expect(frame.iframe.src).toMatch(srcPattern(SIGN_ORIGIN));

    // ...and messages are filtered against that origin, not against ''.
    sendFromFrame('', fixture('frame.ready').data, frame.window);
    expect(frame.postMessage).not.toHaveBeenCalled();
    sendReady(frame);
    expect(frame.postMessage).toHaveBeenCalledTimes(1);
  });
});

describe('frame.ready → host.init', () => {
  // Configs are literals; the fixture is only the expected wire payload.
  it.each([
    {
      file: 'host.init.sign.json',
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
      file: 'host.init.upload.json',
      variant: 'upload',
      origin: UPLOAD_ORIGIN,
      pageURL: 'https://app.example.com/contratos/nuevo',
      sdkData: {
        userAttributes: { email: 'admin@example.com' },
        uxOptions: UX_OPTIONS,
      },
    },
  ])(
    '$variant: payload deep-equals $file',
    ({ variant, origin, pageURL, sdkData }) => {
      setPageURL(pageURL);
      const frame = mountIframe('auco');
      const events = baseEvents();
      start({
        sdkType: variant,
        env: 'PROD',
        iframeId: 'auco',
        language: 'es',
        keyPublic: KEY_PUBLIC,
        sdkData,
        events,
      });

      sendReady(frame, origin);

      expect(frame.postMessage.mock.calls).toStrictEqual([
        [fixture('host.init', variant).data, origin],
      ]);
      expect(events.onSDKReady).toHaveBeenCalledTimes(1);
    }
  );

  it.each([1, 'yes', {}])('any truthy ready (%j) is answered', (ready) => {
    const frame = mountIframe('auco');
    start(signConfig(frame));
    sendFromFrame(SIGN_ORIGIN, { ready }, frame.window);
    expect(frame.postMessage).toHaveBeenCalledTimes(1);
  });

  it('sends keyPublic as an own property even when it is undefined', () => {
    const frame = mountIframe('auco');
    start(signConfig(frame));
    sendReady(frame);
    const payload = frame.postMessage.mock.calls[0]?.[0] as object;
    expect(Object.hasOwn(payload, 'keyPublic')).toBe(true);
    expect(payload).toHaveProperty('keyPublic', undefined);
  });

  it('keyPublic null starts and travels as null (the default does not apply)', () => {
    const frame = mountIframe('auco');
    start(signConfig(frame, { keyPublic: null }));
    sendReady(frame);
    expect(frame.postMessage.mock.calls[0]?.[0]).toHaveProperty(
      'keyPublic',
      null
    );
  });

  it.each([
    {
      sdkType: 'sign',
      origin: SIGN_ORIGIN,
      expected: {
        language: 'en',
        keyPublic: undefined,
        sdkParentURL: 'https://app.example.com/pagina',
        flowType: 'desde-sdkData',
        uxOptions: UX_OPTIONS,
      },
    },
    {
      sdkType: 'upload',
      origin: UPLOAD_ORIGIN,
      expected: {
        language: 'en',
        keyPublic: undefined,
        sdkParentURL: 'https://app.example.com/pagina',
        flowType: 'upload',
        uxOptions: UX_OPTIONS,
      },
    },
  ])(
    '$sdkType: sdkData overrides language; keyPublic, sdkParentURL and flowType (if set) override sdkData',
    ({ sdkType, origin, expected }) => {
      setPageURL('https://app.example.com/pagina');
      const frame = mountIframe('auco');
      start({
        sdkType,
        env: 'PROD',
        iframeId: 'auco',
        language: 'es',
        sdkData: {
          uxOptions: UX_OPTIONS,
          language: 'en',
          keyPublic: 'desde-sdkData',
          sdkParentURL: 'desde-sdkData',
          flowType: 'desde-sdkData',
        },
        events: baseEvents(),
      });
      sendReady(frame, origin);
      expect(frame.postMessage.mock.calls).toStrictEqual([[expected, origin]]);
    }
  );

  it('reads sdkParentURL at each ready, not at start', () => {
    const frame = mountIframe('auco');
    setPageURL('https://app.example.com/antes');
    start(signConfig(frame));
    setPageURL('https://app.example.com/despues?q=1#frag');
    sendReady(frame);
    expect(frame.postMessage.mock.calls[0]?.[0]).toHaveProperty(
      'sdkParentURL',
      'https://app.example.com/despues?q=1#frag'
    );
  });

  it('re-sends host.init and re-calls onSDKReady on every ready', () => {
    const frame = mountIframe('auco');
    const config = signConfig(frame);
    start(config);
    sendReady(frame);
    sendReady(frame);
    expect(frame.postMessage).toHaveBeenCalledTimes(2);
    expect(config.events.onSDKReady).toHaveBeenCalledTimes(2);
  });

  it('with contentWindow null skips host.init silently and still awaits onSDKReady', async () => {
    const frame = mountIframe('auco');
    const config = signConfig(frame);
    start(config);
    detachContentWindow(frame);

    const rejections = await captureUnhandledRejections(() => {
      sendReady(frame);
    });

    expect(rejections).toEqual([]);
    expect(frame.postMessage).not.toHaveBeenCalled();
    expect(config.events.onSDKReady).toHaveBeenCalledTimes(1);
  });

  it.each(SDK_TYPES)(
    '%s: flowType is set only for upload-family types',
    (sdkType) => {
      const frame = mountIframe('auco');
      start({
        sdkType,
        env: 'PROD',
        customOrigin: CUSTOM_ORIGIN,
        iframeId: 'auco',
        language: 'en',
        sdkData: { uxOptions: UX_OPTIONS },
        events: baseEvents(),
      });
      sendReady(frame, CUSTOM_ORIGIN);
      const payload = frame.postMessage.mock.calls[0]?.[0] as object;
      const flowTypes = [
        'upload',
        'read',
        'attachments',
        'validation-attachments',
      ];
      if (flowTypes.includes(sdkType)) {
        expect(payload).toHaveProperty('flowType', sdkType);
      } else {
        expect(Object.hasOwn(payload, 'flowType')).toBe(false);
      }
    }
  );

  it('ignores a ready from any other origin', () => {
    const frame = mountIframe('auco');
    const config = signConfig(frame);
    start(config);
    sendReady(frame, 'https://otro.example.com');
    expect(frame.postMessage).not.toHaveBeenCalled();
    expect(config.events.onSDKReady).not.toHaveBeenCalled();
  });
});

describe('dispatch order (PROTOCOL.md §1.4)', () => {
  it('a ready that also carries a type is handled as ready only', async () => {
    const frame = mountIframe('auco');
    const onSDKToken = vi.fn(async () => TOKEN);
    const config = signConfig(frame, {
      events: { ...baseEvents(), onSDKToken },
    });
    start(config);

    sendFromFrame(
      SIGN_ORIGIN,
      { ready: true, type: 'SDK-CLOSE', redirectTo: 'https://x.example.com' },
      frame.window
    );
    sendFromFrame(SIGN_ORIGIN, { ready: true, type: 'token' }, frame.window);
    await flush();

    expect(config.events.onSDKReady).toHaveBeenCalledTimes(2);
    expect(config.events.onSDKClose).not.toHaveBeenCalled();
    expect(onSDKToken).not.toHaveBeenCalled();
    expect(frame.postMessage).toHaveBeenCalledTimes(2); // two host.init
  });

  it.each([
    { name: 'null', data: null },
    { name: 'undefined', data: undefined },
  ])(
    'event.data $name rejects with a TypeError at the ready check',
    async ({ data }) => {
      const frame = mountIframe('auco');
      const config = signConfig(frame);
      start(config);

      const rejections = await captureUnhandledRejections(() => {
        sendFromFrame(SIGN_ORIGIN, data, frame.window);
      });

      expect(rejections).toHaveLength(1);
      expect(rejections[0]).toBeInstanceOf(TypeError);
      expect((rejections[0] as Error).message).toMatch(/ready/);
      expect(frame.postMessage).not.toHaveBeenCalled();
      expect(config.events.onSDKReady).not.toHaveBeenCalled();
    }
  );

  it.each([
    { name: 'a number', type: 42 },
    { name: 'a boolean', type: true },
    { name: 'an object', type: { kind: 'SDK-CLOSE' } },
  ])(
    'a type that is $name rejects with a TypeError at the token predicate',
    async ({ type }) => {
      const frame = mountIframe('auco');
      const onSDKToken = vi.fn(async () => TOKEN);
      const config = signConfig(frame, {
        events: { ...baseEvents(), onSDKToken },
      });
      start(config);

      const rejections = await captureUnhandledRejections(() => {
        sendFromFrame(SIGN_ORIGIN, { type }, frame.window);
      });

      expect(rejections).toHaveLength(1);
      expect(rejections[0]).toBeInstanceOf(TypeError);
      expect((rejections[0] as Error).message).toMatch(/includes/);
      expect(onSDKToken).not.toHaveBeenCalled();
      expect(frame.postMessage).not.toHaveBeenCalled();
    }
  );

  it('a string type that matches no predicate is ignored silently', async () => {
    const frame = mountIframe('auco');
    const config = signConfig(frame);
    start(config);

    const rejections = await captureUnhandledRejections(() => {
      sendFromFrame(SIGN_ORIGIN, { type: 'SDK-DESCONOCIDO' }, frame.window);
      sendFromFrame(SIGN_ORIGIN, {}, frame.window);
    });

    expect(rejections).toEqual([]);
    expect(frame.postMessage).not.toHaveBeenCalled();
    expect(config.events.onSDKClose).not.toHaveBeenCalled();
  });
});

describe('frame.token-request → host.token', () => {
  it('answers with the host.token fixture once onSDKToken resolves', async () => {
    const frame = mountIframe('auco');
    const onSDKToken = vi.fn(async () => TOKEN);
    start(signConfig(frame, { events: { ...baseEvents(), onSDKToken } }));

    sendFromFrame(
      SIGN_ORIGIN,
      fixture('frame.token-request').data,
      frame.window
    );
    await flush();

    expect(onSDKToken).toHaveBeenCalledTimes(1);
    expect(frame.postMessage.mock.calls).toStrictEqual([
      [fixture('host.token').data, SIGN_ORIGIN],
    ]);
  });

  // PROTOCOL.md: the predicate is a case-sensitive substring test, and an
  // array containing 'token' passes it too.
  it.each([
    { type: 'get-token' },
    { type: 'SDK-token-request' },
    { type: ['SDK-READY', 'token'] },
  ])(
    'type $type matches and is answered with type "token"',
    async ({ type }) => {
      const frame = mountIframe('auco');
      const onSDKToken = vi.fn(async () => TOKEN);
      start(signConfig(frame, { events: { ...baseEvents(), onSDKToken } }));

      sendFromFrame(SIGN_ORIGIN, { type }, frame.window);
      await flush();

      expect(onSDKToken).toHaveBeenCalledTimes(1);
      expect(frame.postMessage.mock.calls).toStrictEqual([
        [{ type: 'token', token: TOKEN }, SIGN_ORIGIN],
      ]);
    }
  );

  it.each(['SDK-TOKEN', 'Token'])('type %s does not match', async (type) => {
    const frame = mountIframe('auco');
    const onSDKToken = vi.fn(async () => TOKEN);
    start(signConfig(frame, { events: { ...baseEvents(), onSDKToken } }));

    const rejections = await captureUnhandledRejections(() => {
      sendFromFrame(SIGN_ORIGIN, { type }, frame.window);
    });

    expect(rejections).toEqual([]);
    expect(onSDKToken).not.toHaveBeenCalled();
    expect(frame.postMessage).not.toHaveBeenCalled();
  });

  it('without onSDKToken rejects inside the listener, not at start', async () => {
    const frame = mountIframe('auco');
    start(signConfig(frame));
    const rejections = await captureUnhandledRejections(() => {
      sendFromFrame(
        SIGN_ORIGIN,
        fixture('frame.token-request').data,
        frame.window
      );
    });
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toHaveProperty(
      'message',
      "Could not get token, SDK is asking for user token, but there isn't a onSDKToken function provided"
    );
    expect(frame.postMessage).not.toHaveBeenCalled();
  });

  it('with contentWindow null skips host.token silently after onSDKToken', async () => {
    const frame = mountIframe('auco');
    const onSDKToken = vi.fn(async () => TOKEN);
    start(signConfig(frame, { events: { ...baseEvents(), onSDKToken } }));
    detachContentWindow(frame);

    const rejections = await captureUnhandledRejections(() => {
      sendFromFrame(
        SIGN_ORIGIN,
        fixture('frame.token-request').data,
        frame.window
      );
    });

    expect(rejections).toEqual([]);
    expect(onSDKToken).toHaveBeenCalledTimes(1);
    expect(frame.postMessage).not.toHaveBeenCalled();
  });
});

describe('frame.pay and frame.notification', () => {
  const PAY_DATA = {
    code: 'DOC0000000AA',
    epaycoKey: 'epayco_fake_00000000',
    validation: false,
    packageId: 'PKG0000000AA',
  };
  const NOTIFICATION_DATA = { message: 'Mensaje de prueba', options: {} };

  it('frame.pay hands data.data to onSDKPay', async () => {
    const frame = mountIframe('auco');
    const onSDKPay = vi.fn();
    start(signConfig(frame, { events: { ...baseEvents(), onSDKPay } }));
    sendFromFrame(SIGN_ORIGIN, fixture('frame.pay').data, frame.window);
    await flush();
    expect(onSDKPay.mock.calls).toStrictEqual([[PAY_DATA]]);
    expect(frame.postMessage).not.toHaveBeenCalled();
  });

  it('frame.pay without onSDKPay rejects inside the listener', async () => {
    const frame = mountIframe('auco');
    start(signConfig(frame));
    const rejections = await captureUnhandledRejections(() => {
      sendFromFrame(SIGN_ORIGIN, fixture('frame.pay').data, frame.window);
    });
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toHaveProperty(
      'message',
      "SDK is asking for payment, but there isn't a onSDKPay function provided"
    );
  });

  it('frame.notification hands data.data to onSDKNotification', async () => {
    const frame = mountIframe('auco');
    const onSDKNotification = vi.fn();
    start(
      signConfig(frame, { events: { ...baseEvents(), onSDKNotification } })
    );
    sendFromFrame(
      SIGN_ORIGIN,
      fixture('frame.notification').data,
      frame.window
    );
    await flush();
    expect(onSDKNotification.mock.calls).toStrictEqual([[NOTIFICATION_DATA]]);
  });

  it('frame.notification without a handler is ignored silently', async () => {
    const frame = mountIframe('auco');
    const config = signConfig(frame);
    start(config);
    const rejections = await captureUnhandledRejections(() => {
      sendFromFrame(
        SIGN_ORIGIN,
        fixture('frame.notification').data,
        frame.window
      );
    });
    expect(rejections).toEqual([]);
    expect(config.events.onSDKClose).not.toHaveBeenCalled();
  });
});

describe('frame.close → onSDKClose(a, b, signProfile)', () => {
  const startProduct = (
    frame: FakeFrame,
    sdkType: string,
    events: Record<string, unknown>
  ) =>
    start({
      sdkType,
      env: 'PROD',
      iframeId: frame.iframe.id,
      language: 'es',
      sdkData: { uxOptions: UX_OPTIONS },
      events,
    });

  // Expected arguments are literals, so a changed fixture value fails here.
  it.each([
    {
      variant: 'upload',
      sdkType: 'upload',
      origin: UPLOAD_ORIGIN,
      args: [
        'DOC0000000AA',
        '',
        [
          {
            id: 'AA',
            name: 'Firmante De Prueba',
            email: 'firmante@example.com',
            phone: '+570000000000',
          },
        ],
      ],
      listenerRemoved: true,
    },
    {
      variant: 'sign',
      sdkType: 'sign',
      origin: SIGN_ORIGIN,
      args: ['', 'https://www.example.com/firma-terminada', []],
      listenerRemoved: true,
    },
    {
      variant: 'validation',
      sdkType: 'validation',
      origin: VALIDATION_ORIGIN,
      args: [91.5, 'APPROVED', []],
      listenerRemoved: true,
    },
    {
      variant: 'validation-pending',
      sdkType: 'validation',
      origin: VALIDATION_ORIGIN,
      args: ['', 'PENDING', []],
      listenerRemoved: false,
    },
  ])(
    // `$variant.json` would read as the property path variant.json.
    'frame.close variant $variant → args, listener removed: $listenerRemoved',
    async ({ variant, sdkType, origin, args, listenerRemoved }) => {
      const frame = mountIframe('auco');
      const events = baseEvents();
      startProduct(frame, sdkType, events);

      sendFromFrame(origin, fixture('frame.close', variant).data, frame.window);
      await flush();
      expect(events.onSDKClose.mock.calls).toStrictEqual([args]);

      // Is the listener still attached? A second message answers it.
      sendReady(frame, origin);
      expect(events.onSDKReady).toHaveBeenCalledTimes(listenerRemoved ? 0 : 1);
    }
  );

  it('falls back with ??, not ||: 0 and an empty string are kept', async () => {
    const frame = mountIframe('auco');
    const events = baseEvents();
    startProduct(frame, 'validation', events);
    sendFromFrame(
      VALIDATION_ORIGIN,
      { type: 'SDK-CLOSE', similarity: 0, redirectTo: '', status: 'APPROVED' },
      frame.window
    );
    await flush();
    expect(events.onSDKClose.mock.calls).toStrictEqual([[0, '', []]]);
  });

  it('an empty document beats similarity, and a falsy signProfile is passed through', async () => {
    const frame = mountIframe('auco');
    const events = baseEvents();
    startProduct(frame, 'validation', events);
    sendFromFrame(
      VALIDATION_ORIGIN,
      {
        type: 'SDK-CLOSE',
        document: '',
        similarity: 5,
        redirectTo: 'R',
        signProfile: '',
      },
      frame.window
    );
    await flush();
    expect(events.onSDKClose.mock.calls).toStrictEqual([['', 'R', '']]);
  });

  // §3 frame.close: 'PENDING' is the only non-terminal status, compared
  // exactly. Any other value, including AucoFace API states, ends the session.
  it.each(['INPROGRESS', 'pending', 'Pending'])(
    'status %s removes the listener',
    async (status) => {
      const frame = mountIframe('auco');
      const events = baseEvents();
      startProduct(frame, 'validation', events);
      sendFromFrame(
        VALIDATION_ORIGIN,
        { type: 'SDK-CLOSE', status },
        frame.window
      );
      await flush();
      sendReady(frame, VALIDATION_ORIGIN);
      expect(events.onSDKReady).not.toHaveBeenCalled();
    }
  );

  it('removes the listener only after onSDKClose settles', async () => {
    const frame = mountIframe('auco');
    const closing = deferred();
    const events = {
      ...baseEvents(),
      onSDKClose: vi.fn(() => closing.promise),
    };
    start(signConfig(frame, { events }));

    sendFromFrame(
      SIGN_ORIGIN,
      fixture('frame.close', 'sign').data,
      frame.window
    );
    await flush();
    sendReady(frame);
    expect(events.onSDKReady).toHaveBeenCalledTimes(1); // still attached

    closing.resolve();
    await flush();
    sendReady(frame);
    expect(events.onSDKReady).toHaveBeenCalledTimes(1); // now removed
  });

  it('keeps the listener when onSDKClose rejects, and the rejection is unhandled', async () => {
    const frame = mountIframe('auco');
    const failure = new Error('integrador falló');
    const events = {
      ...baseEvents(),
      onSDKClose: vi.fn(() => Promise.reject(failure)),
    };
    start(signConfig(frame, { events }));

    const rejections = await captureUnhandledRejections(() => {
      sendFromFrame(
        SIGN_ORIGIN,
        fixture('frame.close', 'sign').data,
        frame.window
      );
    });
    expect(rejections).toEqual([failure]);

    sendReady(frame);
    expect(events.onSDKReady).toHaveBeenCalledTimes(1);
  });
});

describe('teardown', () => {
  const terminal = [
    { message: 'frame.finish', handler: 'onSDKFinish' },
    { message: 'frame.back', handler: 'onSDKBack' },
  ] as const;

  it.each([
    ...terminal.map((t) => ({ ...t, given: true })),
    ...terminal.map((t) => ({ ...t, given: false })),
  ])(
    '$message with $handler given=$given removes the listener only if given',
    async ({ message, handler, given }) => {
      const frame = mountIframe('auco');
      const callback = vi.fn();
      const events = {
        ...baseEvents(),
        ...(given ? { [handler]: callback } : {}),
      };
      start(signConfig(frame, { events }));

      sendFromFrame(SIGN_ORIGIN, fixture(message).data, frame.window);
      await flush();
      expect(callback).toHaveBeenCalledTimes(given ? 1 : 0);

      sendReady(frame);
      expect(events.onSDKReady).toHaveBeenCalledTimes(given ? 0 : 1);
    }
  );

  it.each(terminal)(
    '$message: the listener stays while $handler is pending; a frame.close after it settles is lost',
    async ({ message, handler }) => {
      const frame = mountIframe('auco');
      const pending = deferred();
      const events = {
        ...baseEvents(),
        [handler]: vi.fn(() => pending.promise),
      };
      start(signConfig(frame, { events }));

      sendFromFrame(SIGN_ORIGIN, fixture(message).data, frame.window);
      await flush();
      sendReady(frame);
      expect(events.onSDKReady).toHaveBeenCalledTimes(1);

      pending.resolve();
      await flush();
      sendFromFrame(
        SIGN_ORIGIN,
        fixture('frame.close', 'sign').data,
        frame.window
      );
      await flush();
      expect(events.onSDKClose).not.toHaveBeenCalled();
    }
  );

  it.each(terminal)(
    '$message: frame.close during a pending $handler is dispatched',
    async ({ message, handler }) => {
      const frame = mountIframe('auco');
      const pending = deferred();
      const events = {
        ...baseEvents(),
        [handler]: vi.fn(() => pending.promise),
      };
      start(signConfig(frame, { events }));

      sendFromFrame(SIGN_ORIGIN, fixture(message).data, frame.window);
      await flush();
      sendFromFrame(
        SIGN_ORIGIN,
        fixture('frame.close', 'sign').data,
        frame.window
      );
      await flush();
      expect(events.onSDKClose).toHaveBeenCalledTimes(1);
      pending.resolve();
      await flush();
    }
  );

  it.each(terminal)(
    '$message: a rejecting $handler leaves the listener attached',
    async ({ message, handler }) => {
      const frame = mountIframe('auco');
      const failure = new Error('integrador falló');
      const events = {
        ...baseEvents(),
        [handler]: vi.fn(() => Promise.reject(failure)),
      };
      start(signConfig(frame, { events }));

      const rejections = await captureUnhandledRejections(() => {
        sendFromFrame(SIGN_ORIGIN, fixture(message).data, frame.window);
      });
      expect(rejections).toEqual([failure]);

      sendReady(frame);
      expect(events.onSDKReady).toHaveBeenCalledTimes(1);
    }
  );

  it('unsubscribe removes the listener and leaves iframe.src as it was', () => {
    const frame = mountIframe('auco');
    const config = signConfig(frame);
    const unsubscribe = start(config);
    const srcBefore = frame.iframe.src;

    unsubscribe();
    sendReady(frame);

    expect(config.events.onSDKReady).not.toHaveBeenCalled();
    expect(frame.iframe.src).toBe(srcBefore);
    expect(frame.iframe.src).toMatch(srcPattern(SIGN_ORIGIN));
  });
});

describe('start-time validation', () => {
  const upload = (frame: FakeFrame, sdkData: Record<string, unknown>) => ({
    sdkType: 'upload',
    env: 'PROD',
    iframeId: frame.iframe.id,
    language: 'es',
    sdkData: { uxOptions: UX_OPTIONS, ...sdkData },
    events: baseEvents(),
  });

  it.each([
    {
      name: 'missing iframeId',
      config: (f: FakeFrame) => signConfig(f, { iframeId: '' }),
      error: 'Could not start SDK, iframeId is missing',
    },
    {
      name: 'language outside es/en',
      config: (f: FakeFrame) => signConfig(f, { language: 'pt' }),
      error:
        "Could not start SDK, language is missing or invalid, available options are 'es' and 'en' ",
    },
    {
      name: 'iframe not in the document',
      config: (f: FakeFrame) => signConfig(f, { iframeId: 'otro' }),
      error: 'Could not start SDK, Iframe with id: otro not found',
    },
    {
      name: 'keyPublic of wrong length without onSDKToken',
      config: (f: FakeFrame) => signConfig(f, { keyPublic: 'puk_corta' }),
      error: 'Could not start SDK, onSDKToken is missing',
    },
    {
      name: 'keyPublic of wrong length with onSDKToken',
      config: (f: FakeFrame) =>
        signConfig(f, {
          keyPublic: 'puk_corta',
          events: { ...baseEvents(), onSDKToken: vi.fn() },
        }),
      error: 'Could not start SDK, invalid keyPublic',
    },
    {
      name: 'upload custom as array',
      config: (f: FakeFrame) => upload(f, { custom: ['a'] }),
      error:
        'Could not start SDK, custom data must be an object, received: array',
    },
    {
      name: 'upload custom as string',
      config: (f: FakeFrame) => upload(f, { custom: 'a' }),
      error:
        'Could not start SDK, custom data must be an object, received: string',
    },
    {
      name: 'upload custom as empty object',
      config: (f: FakeFrame) => upload(f, { custom: {} }),
      error: 'Could not start SDK, custom data is empty, received: {}',
    },
    {
      name: 'attachments custom as array',
      config: (f: FakeFrame) => ({
        ...upload(f, { custom: [1] }),
        sdkType: 'attachments',
      }),
      error:
        'Could not start SDK, custom data must be an object, received: array',
    },
  ])('$name throws synchronously and loads nothing', ({ config, error }) => {
    const frame = mountIframe('auco');
    expect(() => start(config(frame))).toThrow(new Error(error));
    expect(frame.iframe.src).toBe('');
  });

  // PROTOCOL.md §1.2: these throw too, but as a TypeError from reading a
  // property of undefined, not with a message of the SDK's own.
  it.each([
    {
      name: 'upload without sdkData',
      config: (f: FakeFrame) => ({ ...upload(f, {}), sdkData: undefined }),
      property: 'custom',
    },
    {
      name: 'attachments without sdkData',
      config: (f: FakeFrame) => ({
        ...upload(f, {}),
        sdkType: 'attachments',
        sdkData: undefined,
      }),
      property: 'custom',
    },
    {
      name: 'keyPublic of wrong length without events',
      config: (f: FakeFrame) =>
        signConfig(f, { keyPublic: 'puk_corta', events: undefined }),
      property: 'onSDKToken',
    },
  ])(
    '$name throws a TypeError synchronously and loads nothing',
    ({ config, property }) => {
      const frame = mountIframe('auco');
      expect(() => start(config(frame))).toThrow(TypeError);
      expect(() => start(config(frame))).toThrow(property);
      expect(frame.iframe.src).toBe('');
    }
  );

  it.each(['upload-v2', 'read', 'validation-attachments', 'sign', 'fill'])(
    '%s does not validate custom',
    (sdkType) => {
      const frame = mountIframe('auco');
      start({ ...upload(frame, { custom: [] }), sdkType });
      expect(frame.iframe.src).not.toBe('');
    }
  );

  it.each(['', 0, false])(
    'upload does not validate a falsy custom (%o)',
    (custom) => {
      const frame = mountIframe('auco');
      start(upload(frame, { custom }));
      expect(frame.iframe.src).toMatch(srcPattern(UPLOAD_ORIGIN));
    }
  );

  it("keyPublic '' is falsy and skips both key checks", () => {
    const frame = mountIframe('auco');
    start(signConfig(frame, { keyPublic: '' }));
    expect(frame.iframe.src).toMatch(srcPattern(SIGN_ORIGIN));
  });
});

describe('list-validation through customOrigin', () => {
  const listValidation = (frame: FakeFrame) => ({
    sdkType: 'list-validation',
    env: 'PROD',
    customOrigin: CUSTOM_ORIGIN,
    iframeId: frame.iframe.id,
    language: 'es',
    keyPublic: KEY_PUBLIC,
    sdkData: { uxOptions: UX_OPTIONS, showPrices: true },
    events: {
      onSDKReady: vi.fn(),
      onSDKClose: vi.fn(),
      onSDKBack: vi.fn(),
      onSDKFinish: vi.fn(),
      onSDKToken: vi.fn(async () => TOKEN),
      onSDKPay: vi.fn(),
      onSDKNotification: vi.fn(),
    },
  });

  it('loads customOrigin', () => {
    const frame = mountIframe('auco');
    start(listValidation(frame));
    expect(frame.iframe.src).toMatch(srcPattern(CUSTOM_ORIGIN));
  });

  it('host.init carries showPrices and no flowType', () => {
    setPageURL('https://app.example.com/listas');
    const frame = mountIframe('auco');
    start(listValidation(frame));
    sendReady(frame, CUSTOM_ORIGIN);
    expect(frame.postMessage.mock.calls).toStrictEqual([
      [
        {
          language: 'es',
          uxOptions: UX_OPTIONS,
          showPrices: true,
          keyPublic: KEY_PUBLIC,
          sdkParentURL: 'https://app.example.com/listas',
        },
        CUSTOM_ORIGIN,
      ],
    ]);
  });

  it('frame.pay dispatches to the required onSDKPay', async () => {
    const frame = mountIframe('auco');
    const config = listValidation(frame);
    start(config);
    sendFromFrame(CUSTOM_ORIGIN, fixture('frame.pay').data, frame.window);
    await flush();
    expect(config.events.onSDKPay.mock.calls).toStrictEqual([
      [
        {
          code: 'DOC0000000AA',
          epaycoKey: 'epayco_fake_00000000',
          validation: false,
          packageId: 'PKG0000000AA',
        },
      ],
    ]);
  });
});
