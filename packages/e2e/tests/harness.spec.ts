import { addFake, expect, hearing, openHost, test } from './support';

// Control for the `faults` guard every spec relies on: if it stopped hearing
// errors, "raises nothing" would pass vacuously everywhere.

test.beforeEach(async ({ page }) => {
  await openHost(page);
});

test('the guard hears an uncaught error on the host page', async ({
  page,
  faults,
}) => {
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('probe-throw');
    });
  });

  await expect
    .poll(hearing(faults))
    .toEqual(['error: Error: probe-throw', 'pageerror: Error: probe-throw']);
});

test('the guard hears an unhandled rejection on the host page', async ({
  page,
  faults,
}) => {
  await page.evaluate(() => {
    void Promise.reject(new Error('probe-rejection'));
  });

  await expect
    .poll(hearing(faults))
    .toEqual([
      'pageerror: Error: probe-rejection',
      'unhandledrejection: Error: probe-rejection',
    ]);
});

test('the guard hears an uncaught error inside the frame', async ({
  page,
  faults,
}) => {
  const frame = await addFake(page, 'fake', '?scenario=');

  await frame.evaluate(() => {
    setTimeout(() => {
      throw new Error('probe-frame-throw');
    });
  });

  await expect
    .poll(hearing(faults))
    .toEqual(['pageerror: Error: probe-frame-throw']);
});
