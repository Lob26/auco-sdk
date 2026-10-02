import {
  addFake,
  expect,
  FAKE,
  fixture,
  fixtures,
  HOST,
  hearing,
  hostLogFrom,
  hostMark,
  openHost,
  THIRD_ORIGIN,
  test,
} from './support';

// Every other spec is only as honest as the fake frame, so this one pins the
// fake to its contract (r2-fake-contract.json) from the browser, where the
// SDKs meet it. Each test names the fidelity property it holds.

test.beforeEach(async ({ page }) => {
  await openHost(page);
});

test.describe('outgoing messages', () => {
  test('announces itself with exactly one frame.ready fixture, verbatim', async ({
    page,
  }) => {
    const frame = await addFake(page, 'fake');

    const log = await hostLogFrom(page, frame, 'fake');

    expect(log).toEqual([
      { origin: FAKE, data: fixture('frame.ready'), from: 'fake' },
    ]);
  });

  test('targets the embedding origin explicitly', async ({ page }) => {
    const frame = await addFake(page, 'fake');

    expect(await frame.evaluate(() => window.fakeAuco.parentOrigin)).toBe(HOST);
  });

  test('a message aimed at a third origin never reaches the parent', async ({
    page,
  }) => {
    const misdirected = await addFake(
      page,
      'misdirected',
      `?scenario=&parent=${THIRD_ORIGIN}`
    );
    const witness = await addFake(page, 'witness', '?scenario=');
    const mark = await hostMark(page);

    await misdirected.evaluate(() =>
      window.fakeAuco.sendRaw({ probe: 'misdirected' })
    );
    // The witness's sentinel is posted after the misdirected message.
    await hostLogFrom(page, witness, 'witness', mark);

    expect(await misdirected.evaluate(() => window.fakeAuco.parentOrigin)).toBe(
      THIRD_ORIGIN
    );
    expect(
      await page.evaluate(
        (start) => window.harness.messages.slice(start).map((m) => m.from),
        mark
      )
    ).toEqual(['witness']);
  });

  test('scenario plays its fixtures in order, without an implicit ready', async ({
    page,
  }) => {
    const frame = await addFake(
      page,
      'fake',
      '?scenario=frame.notification,frame.close.sign,frame.pay'
    );

    const log = await hostLogFrom(page, frame, 'fake');

    expect(log.map((m) => m.data)).toEqual([
      fixture('frame.notification'),
      fixture('frame.close.sign'),
      fixture('frame.pay'),
    ]);
  });

  test('an empty scenario is a silent frame', async ({ page }) => {
    const frame = await addFake(page, 'fake', '?scenario=');

    expect(await hostLogFrom(page, frame, 'fake')).toEqual([]);
  });

  test('a scenario with an unknown key sends none of its steps', async ({
    page,
    faults,
  }) => {
    const frame = await addFake(
      page,
      'fake',
      '?scenario=frame.ready,frame.nope'
    );

    expect(await hostLogFrom(page, frame, 'fake')).toEqual([]);
    // The typo is reported by the frame itself, as an uncaught error there.
    await expect
      .poll(hearing(faults))
      .toEqual([
        expect.stringContaining(
          'pageerror: Error: fake-frame has no frame→host fixture "frame.nope"'
        ),
      ]);
  });

  test('sendRaw posts its argument as is, through structured clone', async ({
    page,
  }) => {
    const frame = await addFake(page, 'fake', '?scenario=');
    const mark = await hostMark(page);

    // Shapes JSON would change: an own undefined key, NaN, a Date, a Map.
    await frame.evaluate(() => {
      window.fakeAuco.sendRaw({
        missing: undefined,
        nan: Number.NaN,
        when: new Date(0),
        map: new Map([['k', 1]]),
      });
      window.fakeAuco.sendRaw(null);
    });
    await hostLogFrom(page, frame, 'fake', mark);

    const kept = await page.evaluate((start) => {
      const [first, second] = window.harness.messages.slice(start);
      const data = first?.data as Record<string, unknown>;
      return {
        missing: Object.hasOwn(data, 'missing') && data.missing === undefined,
        nan: Number.isNaN(data.nan),
        when: data.when instanceof Date && data.when.getTime() === 0,
        map: data.map instanceof Map && data.map.get('k') === 1,
        nullData: second?.data === null,
      };
    }, mark);
    expect(kept).toEqual({
      missing: true,
      nan: true,
      when: true,
      map: true,
      nullData: true,
    });
  });

  test('fixtures() lists exactly the frame→host fixtures', async ({ page }) => {
    const frame = await addFake(page, 'fake', '?scenario=');
    const frameToHost = [...fixtures]
      .filter(([, f]) => f.direction === 'frame-to-host')
      .map(([key]) => key)
      .sort();

    expect(await frame.evaluate(() => window.fakeAuco.fixtures())).toEqual(
      frameToHost
    );
  });

  for (const [id, variant] of [
    ['host.init', 'sign'],
    ['host.init', 'upload'],
    ['host.token', undefined],
  ] as const) {
    test(`refuses to send the host→frame fixture ${id}${variant ? `.${variant}` : ''}`, async ({
      page,
    }) => {
      const frame = await addFake(page, 'fake', '?scenario=');

      await expect(
        frame.evaluate(([i, v]) => window.fakeAuco.send(i, v), [
          id,
          variant,
        ] as const)
      ).rejects.toThrow('fake-frame has no frame→host fixture');
    });
  }

  test('a fixture with variants needs its variant', async ({ page }) => {
    const frame = await addFake(page, 'fake', '?scenario=');

    await expect(
      frame.evaluate(() => window.fakeAuco.send('frame.close'))
    ).rejects.toThrow('no frame→host fixture "frame.close"');
  });
});

test.describe('incoming messages', () => {
  for (const [name, message] of [
    ['host.init', fixture('host.init.sign')],
    ['host.token', fixture('host.token')],
  ] as const) {
    test(`never answers ${name} on its own`, async ({ page }) => {
      const frame = await addFake(page, 'fake', '?scenario=');
      const mark = await hostMark(page);

      await page.evaluate(
        ([data, origin]) => window.harness.postTo('#fake', data, origin),
        [message, FAKE] as const
      );
      await expect
        .poll(() => frame.evaluate(() => window.fakeAuco.received().length))
        .toBe(1);

      expect(await hostLogFrom(page, frame, 'fake', mark)).toEqual([]);
    });
  }

  test('records the origin and the parent as the source', async ({ page }) => {
    const frame = await addFake(page, 'fake', '?scenario=');

    await page.evaluate(
      ([data, origin]) => window.harness.postTo('#fake', data, origin),
      [{ probe: 'from-parent' }, FAKE] as const
    );

    await expect
      .poll(() => frame.evaluate(() => window.fakeAuco.received()))
      .toEqual([
        { origin: HOST, data: { probe: 'from-parent' }, fromParent: true },
      ]);
  });

  test('records a message from a window that is not the parent', async ({
    page,
  }) => {
    const frame = await addFake(page, 'fake', '?scenario=');

    await frame.evaluate((origin) => {
      window.postMessage({ probe: 'from-itself' }, origin);
    }, FAKE);

    await expect
      .poll(() => frame.evaluate(() => window.fakeAuco.received()))
      .toEqual([
        { origin: FAKE, data: { probe: 'from-itself' }, fromParent: false },
      ]);
  });

  // Same origin as the parent, different window: fromParent must come from
  // event.source, not from comparing origins.
  test('records a host-origin window that is not the parent as not the parent', async ({
    page,
  }) => {
    const frame = await addFake(page, 'fake', '?scenario=');

    await page.evaluate((origin) => {
      const sibling = document.createElement('iframe');
      document.body.append(sibling);
      const target = document.querySelector<HTMLIFrameElement>('#fake');
      (sibling.contentWindow as Window & { eval(code: string): unknown }).eval(
        `parent.document.querySelector('#fake').contentWindow.postMessage({ probe: 'sibling' }, ${JSON.stringify(origin)})`
      );
      if (!target) throw new Error('#fake is missing');
    }, FAKE);

    await expect
      .poll(() => frame.evaluate(() => window.fakeAuco.received()))
      .toEqual([
        { origin: HOST, data: { probe: 'sibling' }, fromParent: false },
      ]);
  });

  test('clear() empties the log', async ({ page }) => {
    const frame = await addFake(page, 'fake', '?scenario=');
    await page.evaluate(
      ([origin]) => window.harness.postTo('#fake', { probe: 1 }, origin),
      [FAKE] as const
    );
    await expect
      .poll(() => frame.evaluate(() => window.fakeAuco.received().length))
      .toBe(1);

    await frame.evaluate(() => window.fakeAuco.clear());

    expect(await frame.evaluate(() => window.fakeAuco.received())).toEqual([]);
  });

  test('received() returns a copy the caller cannot corrupt', async ({
    page,
  }) => {
    const frame = await addFake(page, 'fake', '?scenario=');

    const length = await frame.evaluate(() => {
      window.fakeAuco.received().push({
        origin: 'forged',
        data: null,
        fromParent: true,
      });
      return window.fakeAuco.received().length;
    });

    expect(length).toBe(0);
  });
});

test.describe('lifecycle', () => {
  test('reload() navigates: a new document, an empty log, a new ready', async ({
    page,
  }) => {
    const frame = await addFake(page, 'fake');
    await page.evaluate(
      ([origin]) => window.harness.postTo('#fake', { probe: 1 }, origin),
      [FAKE] as const
    );
    await expect
      .poll(() => frame.evaluate(() => window.fakeAuco.received().length))
      .toBe(1);
    await frame.evaluate(() => {
      (window as unknown as { marker: number }).marker = 1;
      window.fakeAuco.reload();
    });

    const readies = () =>
      page.evaluate(
        (ready) =>
          window.harness.messages.filter(
            (m) =>
              m.from === 'fake' &&
              JSON.stringify(m.data) === JSON.stringify(ready)
          ).length,
        fixture('frame.ready')
      );
    await expect.poll(readies).toBe(2);
    await frame.waitForFunction(() => window.fakeAuco !== undefined);

    expect(
      await frame.evaluate(() => ({
        marker: (window as unknown as { marker?: number }).marker,
        received: window.fakeAuco.received(),
      }))
    ).toEqual({ marker: undefined, received: [] });
  });

  test('parent=* is refused: no target, and sending throws', async ({
    page,
  }) => {
    const frame = await addFake(page, 'fake', '?scenario=&parent=*');

    expect(
      await frame.evaluate(() => [
        window.fakeAuco.parentOrigin,
        window.fakeAuco.unusableReason,
      ])
    ).toEqual([null, 'parent=* is not a serialized origin']);
    await expect(
      frame.evaluate(() => window.fakeAuco.sendRaw({ probe: 1 }))
    ).rejects.toThrow('fake-frame cannot post');
  });

  test('under an opaque parent with no referrer it has no target, never *', async ({
    page,
  }) => {
    // A data: document has an opaque origin ('null' in ancestorOrigins) and
    // sends no referrer: the one case where only a '*' fallback could post.
    await page.evaluate((src) => {
      const outer = document.createElement('iframe');
      outer.src = `data:text/html,${encodeURIComponent(`<iframe src="${src}"></iframe>`)}`;
      document.body.append(outer);
    }, `${FAKE}/?scenario=`);
    await expect
      .poll(() => page.frames().some((f) => f.url().startsWith(FAKE)))
      .toBe(true);
    const frame = page.frames().find((f) => f.url().startsWith(FAKE));
    await frame?.waitForFunction(() => window.fakeAuco !== undefined);

    expect(
      await frame?.evaluate(() => [
        window.fakeAuco.parentOrigin,
        window.fakeAuco.unusableReason,
      ])
    ).toEqual([null, 'no parent param, ancestorOrigins or referrer to target']);
  });

  test('loaded top-level, it has no parent to target', async ({ page }) => {
    await page.goto(`${FAKE}/?scenario=`);
    await page.waitForFunction(() => window.fakeAuco !== undefined);

    expect(
      await page.evaluate(() => [
        window.fakeAuco.parentOrigin,
        window.fakeAuco.unusableReason,
      ])
    ).toEqual([null, 'not embedded: window.parent is itself']);
    await expect(
      page.evaluate(() => window.fakeAuco.sendRaw({ probe: 1 }))
    ).rejects.toThrow('fake-frame cannot post');
  });
});
