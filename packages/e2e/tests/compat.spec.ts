import type { Page } from '@playwright/test';
import {
  expect,
  FAKE,
  fakeIn,
  fixture,
  frameLog,
  hostLogFrom,
  openHost,
  PUBLIC_KEY,
  sdkData,
  test,
} from './support';

// AucoSDK(config) from the BUILT compat dist, the way a 1.x integration calls
// it: an iframe by id, customOrigin pointing at the fake frame.

interface CompatStart {
  readonly sdkType: 'sign' | 'upload' | 'validation';
  readonly sdkData: object;
}

/** Calls AucoSDK on `<iframe id="sdk">` and returns its fake frame. */
async function startCompat(page: Page, start: CompatStart) {
  await page.evaluate(
    ([s, origin, keyPublic]) => {
      const h = window.harness;
      h.iframe('sdk');
      const stop = h.AucoSDK({
        iframeId: 'sdk',
        language: 'es',
        env: 'PROD',
        customOrigin: origin,
        keyPublic,
        sdkType: s.sdkType,
        sdkData: s.sdkData,
        events: {
          onSDKReady: h.record('onSDKReady'),
          onSDKClose: h.record('onSDKClose'),
        },
      } as Parameters<typeof h.AucoSDK>[0]);
      h.stops.push(stop);
    },
    [start, FAKE, PUBLIC_KEY] as const
  );
  return fakeIn(page, '#sdk');
}

const callsOf = (page: Page, name: string) =>
  page.evaluate(
    (n) => window.harness.calls.filter((c) => c.name === n).map((c) => c.args),
    name
  );

test.beforeEach(async ({ page }) => {
  await openHost(page, '/?case=compat');
});

test('onSDKReady fires once and the frame gets host.init with sdkParentURL = href', async ({
  page,
}) => {
  const frame = await startCompat(page, {
    sdkType: 'sign',
    sdkData: sdkData('host.init.sign'),
  });

  await expect.poll(() => callsOf(page, 'onSDKReady')).toEqual([[]]);
  const log = await frameLog(page, '#sdk', frame);
  expect(log.map((m) => m.data)).toEqual([
    { ...fixture('host.init.sign'), sdkParentURL: page.url() },
  ]);
});

for (const [sdkType, close, args] of [
  [
    'upload',
    'upload',
    [
      'DOC0000000AA',
      '',
      (fixture('frame.close.upload') as { signProfile: unknown }).signProfile,
    ],
  ],
  ['sign', 'sign', ['', 'https://www.example.com/firma-terminada', []]],
  ['validation', 'validation', [91.5, 'APPROVED', []]],
] as const) {
  test(`onSDKClose gets 1.x's positional args for frame.close.${close}`, async ({
    page,
  }) => {
    const frame = await startCompat(page, {
      sdkType,
      sdkData: sdkType === 'validation' ? {} : sdkData(`host.init.${sdkType}`),
    });
    await expect.poll(() => callsOf(page, 'onSDKReady')).toHaveLength(1);

    await frame.evaluate((v) => window.fakeAuco.send('frame.close', v), close);

    await expect.poll(() => callsOf(page, 'onSDKClose')).toEqual([args]);
  });
}

test('the unsubscribe function points the iframe at about:blank', async ({
  page,
}) => {
  const frame = await startCompat(page, {
    sdkType: 'sign',
    sdkData: sdkData('host.init.sign'),
  });
  await expect.poll(() => callsOf(page, 'onSDKReady')).toHaveLength(1);

  await page.evaluate(() => window.harness.stops[0]?.());

  await expect(page.locator('iframe#sdk')).toHaveAttribute(
    'src',
    'about:blank'
  );
  await expect.poll(() => frame.url()).toBe('about:blank');
});

for (const [label, data] of [
  ['null', null],
  ["{ type: 'SDK-PAY' } with no onSDKPay", { type: 'SDK-PAY' }],
  ["{ type: 'token' } with no onSDKToken", { type: 'token' }],
  ["{ type: ['SDK-CLOSE'] }", { type: ['SDK-CLOSE'] }],
] as const) {
  test(`hostile frame data ${label} raises nothing and calls no callback`, async ({
    page,
  }) => {
    const frame = await startCompat(page, {
      sdkType: 'sign',
      sdkData: sdkData('host.init.sign'),
    });
    await expect.poll(() => callsOf(page, 'onSDKReady')).toHaveLength(1);

    await frame.evaluate((d) => window.fakeAuco.sendRaw(d), data);
    await hostLogFrom(page, frame, 'sdk');

    expect(await callsOf(page, 'onSDKClose')).toEqual([]);
    // Still bridged: a real close reaches onSDKClose.
    await frame.evaluate(() => window.fakeAuco.send('frame.close', 'sign'));
    await expect.poll(() => callsOf(page, 'onSDKClose')).toHaveLength(1);
  });
}
