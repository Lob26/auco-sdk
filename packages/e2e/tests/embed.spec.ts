import {
  addFake,
  expect,
  FAKE,
  fixture,
  frameLog,
  HOST,
  hostLogFrom,
  openHost,
  PUBLIC_KEY,
  sdkData,
  sessionView,
  startSession,
  test,
  untilEvent,
} from './support';

// createSession from the BUILT embed dist, in Chromium, against the fake frame
// on another origin. The `faults` fixture fails any test that raised a
// pageerror or an unhandled rejection.

const SIGN = {
  product: 'sign',
  data: sdkData('host.init.sign'),
  publicKey: PUBLIC_KEY,
} as const;

/** The host.init fixture as this page must send it. */
const expectedInit = (key: string, sdkParentURL: string) => ({
  ...fixture(key),
  sdkParentURL,
});

test.describe('handshake', () => {
  test('answers ready with the host.init.sign fixture, sdkParentURL = origin', async ({
    page,
  }) => {
    await openHost(page, '/?case=origin#anchor');
    const { index, selector, frame } = await startSession(page, {
      slot: 'a',
      ...SIGN,
    });
    await untilEvent(page, index, 'ready');

    const [init, ...rest] = await frameLog(page, selector, frame);

    const expected = expectedInit('host.init.sign', HOST);
    expect(rest).toEqual([]);
    expect(init).toEqual({ origin: HOST, data: expected, fromParent: true });
    // Key order too: 1.0.9 builds the object in this order.
    expect(Object.keys(init?.data as object)).toEqual(Object.keys(expected));
    expect((await sessionView(page, index)).state).toBe('ready');
  });

  test("answers ready with the host.init.upload fixture, sdkParentURL = href with parentUrl 'href'", async ({
    page,
  }) => {
    await openHost(page, '/?case=href#anchor');
    const { index, selector, frame } = await startSession(page, {
      slot: 'a',
      product: 'upload',
      data: sdkData('host.init.upload'),
      publicKey: PUBLIC_KEY,
      parentUrl: 'href',
    });
    await untilEvent(page, index, 'ready');

    const [init, ...rest] = await frameLog(page, selector, frame);

    const expected = expectedInit('host.init.upload', page.url());
    expect(page.url()).toBe(`${HOST}/?case=href#anchor`);
    expect(rest).toEqual([]);
    expect(init?.data).toEqual(expected);
    expect(Object.keys(init?.data as object)).toEqual(Object.keys(expected));
  });
});

test.describe('lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await openHost(page);
  });

  test('a token request is answered with the host.token fixture from getToken', async ({
    page,
  }) => {
    const { token } = fixture('host.token') as { token: string };
    const { index, selector, frame } = await startSession(page, {
      slot: 'a',
      ...SIGN,
      token,
    });
    await untilEvent(page, index, 'ready');

    await frame.evaluate(() => window.fakeAuco.send('frame.token-request'));
    await expect
      .poll(() => frame.evaluate(() => window.fakeAuco.received().length))
      .toBe(2);

    const log = await frameLog(page, selector, frame);
    expect(log.map((m) => m.data)).toEqual([
      expectedInit('host.init.sign', HOST),
      fixture('host.token'),
    ]);
  });

  test('close resolves done and removes the listener', async ({ page }) => {
    const { index, selector, frame } = await startSession(page, {
      slot: 'a',
      ...SIGN,
    });
    await untilEvent(page, index, 'ready');

    await frame.evaluate(() => window.fakeAuco.send('frame.close', 'sign'));
    await expect
      .poll(async () => (await sessionView(page, index)).settled)
      .toMatchObject({
        outcome: {
          reason: 'close',
          message: { raw: fixture('frame.close.sign') },
        },
      });
    expect((await sessionView(page, index)).state).toBe('closed');

    // A ready after the close reaches no listener: no host.init, no event.
    await frame.evaluate(() => {
      window.fakeAuco.clear();
      window.fakeAuco.send('frame.ready');
    });
    await hostLogFrom(page, frame, 'a');
    expect(await frameLog(page, selector, frame)).toEqual([]);
    expect(
      (await sessionView(page, index)).events.filter((e) => e === 'ready')
    ).toHaveLength(1);
  });

  test('a PENDING close is not terminal', async ({ page }) => {
    const { index, frame } = await startSession(page, {
      slot: 'a',
      product: 'validation',
      data: {},
      publicKey: PUBLIC_KEY,
    });
    await untilEvent(page, index, 'ready');

    await frame.evaluate(() =>
      window.fakeAuco.send('frame.close', 'validation-pending')
    );
    await untilEvent(page, index, 'close');

    const view = await sessionView(page, index);
    expect(view.state).toBe('ready');
    expect(view.settled).toBeNull();

    // The session still listens: the final close ends it.
    await frame.evaluate(() =>
      window.fakeAuco.send('frame.close', 'validation')
    );
    await expect
      .poll(async () => (await sessionView(page, index)).settled)
      .toMatchObject({
        outcome: { reason: 'close', message: { status: 'APPROVED' } },
      });
  });

  test('destroy removes an iframe the session created', async ({ page }) => {
    const { index } = await startSession(page, { slot: 'a', ...SIGN });
    await untilEvent(page, index, 'ready');

    await page.evaluate(
      (i) => window.harness.sessions[i]?.session.destroy(),
      index
    );

    await expect(page.locator('#a iframe')).toHaveCount(0);
    await expect(page.locator('#a')).toHaveCount(1);
    expect(await sessionView(page, index)).toMatchObject({
      state: 'destroyed',
      settled: { outcome: { reason: 'destroyed' } },
    });
  });

  test('destroy points an adopted iframe at about:blank and keeps it', async ({
    page,
  }) => {
    const { index, frame } = await startSession(page, {
      slot: 'a',
      adopt: true,
      ...SIGN,
    });
    await untilEvent(page, index, 'ready');

    await page.evaluate(
      (i) => window.harness.sessions[i]?.session.destroy(),
      index
    );

    await expect(page.locator('iframe#a')).toHaveAttribute(
      'src',
      'about:blank'
    );
    await expect.poll(() => frame.url()).toBe('about:blank');
    expect((await sessionView(page, index)).state).toBe('destroyed');
  });
});

test.describe('isolation (audit 1.1)', () => {
  test.beforeEach(async ({ page }) => {
    await openHost(page);
  });

  test('two sessions on the same frame origin never hear each other', async ({
    page,
  }) => {
    const a = await startSession(page, { slot: 'a', ...SIGN });
    const b = await startSession(page, { slot: 'b', ...SIGN });
    await untilEvent(page, a.index, 'ready');
    await untilEvent(page, b.index, 'ready');

    await a.frame.evaluate(() => window.fakeAuco.send('frame.close', 'sign'));
    await expect
      .poll(async () => (await sessionView(page, a.index)).state)
      .toBe('closed');

    const viewB = await sessionView(page, b.index);
    expect(viewB.state).toBe('ready');
    expect(viewB.settled).toBeNull();
    expect(viewB.events).not.toContain('close');
    // Each session answered only its own frame's ready.
    const init = expectedInit('host.init.sign', HOST);
    expect(
      (await frameLog(page, b.selector, b.frame)).map((m) => m.data)
    ).toEqual([init]);
    expect(viewB.events.filter((e) => e === 'ready')).toHaveLength(1);
  });

  test('a same-origin window that is not the iframe is ignored', async ({
    page,
  }) => {
    const { index, selector, frame } = await startSession(page, {
      slot: 'a',
      ...SIGN,
    });
    await untilEvent(page, index, 'ready');
    const stray = await addFake(page, 'stray', '?scenario=');

    await stray.evaluate(() => {
      window.fakeAuco.send('frame.ready');
      window.fakeAuco.send('frame.close', 'sign');
    });
    // Delivered to the host window, so every listener there has run.
    expect(
      (await hostLogFrom(page, stray, 'stray')).map((m) => m.origin)
    ).toEqual([FAKE, FAKE]);

    const view = await sessionView(page, index);
    expect(view.state).toBe('ready');
    expect(view.settled).toBeNull();
    expect(view.events).toEqual(['statechange', 'ready']);
    expect((await frameLog(page, selector, frame)).map((m) => m.data)).toEqual([
      expectedInit('host.init.sign', HOST),
    ]);
    expect(await stray.evaluate(() => window.fakeAuco.received())).toEqual([]);
  });

  test('the iframe navigated to another origin is ignored', async ({
    page,
  }) => {
    const { index, frame } = await startSession(page, { slot: 'a', ...SIGN });
    await untilEvent(page, index, 'ready');

    // Same window (event.source still matches), different origin.
    await frame.evaluate((url) => {
      location.href = url;
    }, `${HOST}/impostor.html`);
    await expect.poll(() => frame.url()).toBe(`${HOST}/impostor.html`);
    await frame.waitForLoadState();
    await frame.evaluate((close) => {
      window.parent.postMessage(close, '*');
    }, fixture('frame.close.sign'));
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.harness.messages.some(
            (m) => m.from === 'a' && m.origin === location.origin
          )
        )
      )
      .toBe(true);

    const view = await sessionView(page, index);
    expect(view.state).toBe('ready');
    expect(view.settled).toBeNull();
  });
});

// What a frame (or anything on its origin, through it) can post that matches
// no message, or matches one with garbage fields. structured clone limits the
// set: getters and proxies cannot cross postMessage, so they stay unit-only.
const HOSTILE: readonly (readonly [string, unknown])[] = [
  ['null', null],
  ['undefined', undefined],
  ['a number', 5],
  ["the string 'SDK-TOKEN'", 'SDK-TOKEN'],
  ['an empty array', []],
  ['{ type: 5 }', { type: 5 }],
  ['{ type: 7 }', { type: 7 }],
  ['{ type: null }', { type: null }],
  ['{ type: {} }', { type: {} }],
  ["{ type: ['SDK-CLOSE'] }", { type: ['SDK-CLOSE'] }],
  ['{ ready: 0 }', { ready: 0 }],
  ["{ type: 'SDK-PAY' } without data", { type: 'SDK-PAY' }],
  [
    "{ type: 'SDK-NOTIFICATION', data: null }",
    { type: 'SDK-NOTIFICATION', data: null },
  ],
  ["{ type: 'token' } with no getToken and no key", { type: 'token' }],
];

test.describe('hostile frame input', () => {
  for (const [label, data] of HOSTILE) {
    test(`${label} leaves the session open and raises nothing`, async ({
      page,
    }) => {
      await openHost(page);
      const { index, frame } = await startSession(page, {
        slot: 'a',
        product: 'sign',
        data: SIGN.data,
      });
      await untilEvent(page, index, 'ready');

      await frame.evaluate((d) => window.fakeAuco.sendRaw(d), data);
      await hostLogFrom(page, frame, 'a');

      const view = await sessionView(page, index);
      expect(view.state).toBe('ready');
      expect(view.settled).toBeNull();
      // Still listening: a real close ends it.
      await frame.evaluate(() => window.fakeAuco.send('frame.close', 'sign'));
      await expect
        .poll(async () => (await sessionView(page, index)).state)
        .toBe('closed');
    });
  }
});

test.describe('permissions', () => {
  test.beforeEach(async ({ page }) => {
    await openHost(page);
  });

  const allowsCamera = () =>
    (
      document as unknown as {
        featurePolicy: { allowsFeature(feature: string): boolean };
      }
    ).featurePolicy.allowsFeature('camera');

  test('the iframe the session creates grants the frame camera', async ({
    page,
  }) => {
    const { frame } = await startSession(page, { slot: 'a', ...SIGN });

    expect(await frame.evaluate(allowsCamera)).toBe(true);
  });

  test('control: a cross-origin iframe without allow has no camera', async ({
    page,
  }) => {
    const frame = await addFake(page, 'plain', '?scenario=');

    expect(await frame.evaluate(allowsCamera)).toBe(false);
  });
});
