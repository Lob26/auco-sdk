import { readdirSync, readFileSync } from 'node:fs';
import type { ReceivedMessage } from '@lob26/auco-fake-frame';
import { test as base, expect, type Frame, type Page } from '@playwright/test';
import type { HostMessage } from '../pages/harness';

export { expect };

export const HOST = 'http://localhost:5173';
export const FAKE = 'http://localhost:5174';
/** No window lives here: a message targeted at it reaches nobody. */
export const THIRD_ORIGIN = 'http://localhost:5175';
export const PUBLIC_KEY = `puk_${'0'.repeat(32)}`;

export interface Fixture {
  readonly id: string;
  readonly variant: string | null;
  readonly direction: 'frame-to-host' | 'host-to-frame';
  readonly data: Record<string, unknown>;
}

const FIXTURES = new URL('../../protocol/fixtures/', import.meta.url);

/** Every fixture of packages/protocol, keyed `<id>` or `<id>.<variant>`. */
export const fixtures: ReadonlyMap<string, Fixture> = new Map(
  readdirSync(FIXTURES)
    .filter((name) => name.endsWith('.json'))
    .map((name): [string, Fixture] => {
      const fixture = JSON.parse(
        readFileSync(new URL(name, FIXTURES), 'utf8')
      ) as Fixture;
      const key =
        fixture.variant === null
          ? fixture.id
          : `${fixture.id}.${fixture.variant}`;
      return [key, fixture];
    })
);

export const fixture = (key: string): Record<string, unknown> => {
  const found = fixtures.get(key);
  if (!found) throw new Error(`no fixture ${key}`);
  return found.data;
};

/** The product data a `host.init` fixture spreads at its root. */
export const sdkData = (initKey: string): Record<string, unknown> => {
  const {
    language: _language,
    keyPublic: _keyPublic,
    sdkParentURL: _parent,
    flowType: _flowType,
    ...data
  } = fixture(initKey);
  return data;
};

export interface Faults {
  /** Returns and forgets every fault so far, for a test that causes some. */
  take(): Promise<{ pageErrors: string[]; hostFaults: string[] }>;
}

const hostFaults = async (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (window.harness?.faults ?? []).map((f) => `${f.kind}: ${f.message}`)
  );

/**
 * `faults` is automatic: every test ends asserting that the page raised no
 * `pageerror` and the host window saw no `error` or `unhandledrejection`,
 * except the ones the test consumed with `faults.take()`.
 */
export const test = base.extend<{ faults: Faults }>({
  faults: [
    async ({ page }, use) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => {
        pageErrors.push(`${error.name}: ${error.message}`);
      });
      await use({
        async take() {
          const host = await hostFaults(page);
          await page.evaluate(() => {
            window.harness?.faults.splice(0);
          });
          return { pageErrors: pageErrors.splice(0), hostFaults: host };
        },
      });
      expect(pageErrors, 'pageerror').toEqual([]);
      expect(await hostFaults(page), 'host window faults').toEqual([]);
    },
    { auto: true },
  ],
});

/**
 * A poll function returning every fault heard so far, sorted and prefixed
 * ('pageerror: ', 'error: ', 'unhandledrejection: '). It accumulates across
 * calls because pageerror arrives over CDP on its own schedule.
 */
export const hearing = (faults: Faults) => {
  const heard: string[] = [];
  return async (): Promise<string[]> => {
    const { pageErrors, hostFaults } = await faults.take();
    heard.push(...pageErrors.map((e) => `pageerror: ${e}`), ...hostFaults);
    return [...heard].sort();
  };
};

/** Opens the host page (on :5173, built SDK dist) and waits for the harness. */
export async function openHost(page: Page, path = '/'): Promise<void> {
  await page.goto(`${HOST}${path}`);
  await page.waitForFunction(() => window.harness !== undefined);
}

/** The fake frame loaded in the iframe at `selector`, once its API is up. */
export async function fakeIn(page: Page, selector: string): Promise<Frame> {
  const element = await page.locator(selector).elementHandle();
  const content = await element?.contentFrame();
  if (!content) throw new Error(`no frame at ${selector}`);
  await content.waitForFunction(() => window.fakeAuco !== undefined);
  return content;
}

/** Adds `<iframe id>` loading the fake frame with `query`; returns its frame. */
export async function addFake(
  page: Page,
  id: string,
  query = ''
): Promise<Frame> {
  await page.evaluate(
    ([frameId, src]) => {
      window.harness.iframe(frameId, src);
    },
    [id, `${FAKE}/${query}`] as const
  );
  return fakeIn(page, `#${id}`);
}

let sentinels = 0;

/**
 * Messages the host received from `from` since `mark`, up to a sentinel the
 * frame posts last. A frame's posts arrive in order, so anything it sent
 * before the sentinel is in the result: an absence is real, not a race.
 */
export async function hostLogFrom(
  page: Page,
  frame: Frame,
  from: string,
  mark = 0
): Promise<HostMessage[]> {
  const sentinel = { sentinel: ++sentinels };
  await frame.evaluate((data) => window.fakeAuco.sendRaw(data), sentinel);
  await expect
    .poll(() =>
      page.evaluate(
        (n) =>
          window.harness.messages.some(
            (m) => (m.data as { sentinel?: number } | null)?.sentinel === n
          ),
        sentinel.sentinel
      )
    )
    .toBe(true);
  const log = await page.evaluate(
    ([sender, start]) =>
      window.harness.messages.slice(start).filter((m) => m.from === sender),
    [from, mark] as const
  );
  return log.slice(0, -1);
}

/** How many messages the host window has received so far. */
export const hostMark = (page: Page): Promise<number> =>
  page.evaluate(() => window.harness.messages.length);

/**
 * What the fake frame received, up to a sentinel the host page posts last
 * from its own window. Same ordering argument as {@link hostLogFrom}.
 */
export async function frameLog(
  page: Page,
  selector: string,
  frame: Frame
): Promise<ReceivedMessage[]> {
  const sentinel = { sentinel: ++sentinels };
  await page.evaluate(
    ([target, data, origin]) => window.harness.postTo(target, data, origin),
    [selector, sentinel, FAKE] as const
  );
  await expect
    .poll(() =>
      frame.evaluate(
        (n) =>
          window.fakeAuco
            .received()
            .some(
              (m) => (m.data as { sentinel?: number } | null)?.sentinel === n
            ),
        sentinel.sentinel
      )
    )
    .toBe(true);
  const log = await frame.evaluate(() => window.fakeAuco.received());
  return log.slice(0, -1);
}

export interface StartSession {
  /** id of the container (or of the adopted iframe). */
  readonly slot: string;
  readonly adopt?: boolean;
  readonly product: string;
  readonly data: object;
  readonly parentUrl?: 'origin' | 'href';
  readonly publicKey?: string;
  /** When set, `auth.getToken` resolves to it. */
  readonly token?: string;
}

export interface StartedSession {
  readonly index: number;
  /** Selector of the session's iframe element. */
  readonly selector: string;
  readonly frame: Frame;
}

/**
 * createSession from the built embed dist, against the fake frame's origin.
 * The handshake timeout is off: these specs drive the frame by hand.
 */
export async function startSession(
  page: Page,
  options: StartSession
): Promise<StartedSession> {
  const index = await page.evaluate(
    ([o, origin]) => {
      const h = window.harness;
      const placement = o.adopt
        ? { iframe: h.iframe(o.slot) }
        : { container: h.container(o.slot) };
      const token = o.token;
      const session = h.createSession({
        ...placement,
        product: o.product,
        origin,
        language: 'es',
        data: o.data,
        auth: {
          publicKey: o.publicKey,
          getToken: token === undefined ? undefined : async () => token,
        },
        ...(o.parentUrl === undefined ? {} : { parentUrl: o.parentUrl }),
        handshakeTimeoutMs: 0,
      } as Parameters<typeof h.createSession>[0]);
      return h.track(session);
    },
    [options, FAKE] as const
  );
  const selector = options.adopt
    ? `#${options.slot}`
    : `#${options.slot} iframe`;
  return { index, selector, frame: await fakeIn(page, selector) };
}

export interface SessionView {
  readonly state: string;
  readonly events: string[];
  readonly settled: unknown;
}

/** State, event types (in order) and settlement of tracked session `index`. */
export const sessionView = (page: Page, index: number): Promise<SessionView> =>
  page.evaluate((i) => {
    const record = window.harness.sessions[i];
    if (!record) throw new Error(`no session ${i}`);
    return {
      state: record.session.state,
      events: record.events.map((e) => e.type),
      settled: record.settled,
    };
  }, index);

/** Waits until session `index` has emitted `count` events of `type`. */
export async function untilEvent(
  page: Page,
  index: number,
  type: string,
  count = 1
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await sessionView(page, index)).events.filter((e) => e === type).length
    )
    .toBe(count);
}
