import type { FakeAuco, ReceivedMessage } from './contract';

// Stand-in for an Auco frame app (sign.auco.ai, …). It knows only what
// packages/protocol/PROTOCOL.md documents: it sends the frame→host fixtures
// verbatim and never answers host.init or host.token on its own, because how
// the real frame reacts to them is an open question (PROTOCOL.md §4, 8).

interface Fixture {
  readonly id: string;
  readonly variant: string | null;
  readonly direction: 'frame-to-host' | 'host-to-frame';
  readonly data: unknown;
}

const fixtureModules = import.meta.glob<Fixture>(
  '../../protocol/fixtures/*.json',
  { eager: true, import: 'default' }
);

const outbound = new Map<string, unknown>();
for (const fixture of Object.values(fixtureModules)) {
  if (fixture.direction !== 'frame-to-host') continue;
  const key =
    fixture.variant === null ? fixture.id : `${fixture.id}.${fixture.variant}`;
  outbound.set(key, fixture.data);
}

type Target =
  | { readonly origin: string; readonly reason: null }
  | { readonly origin: null; readonly reason: string };

function originOf(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

// The SDKs load `<origin>?id=<timestamp>` and cannot add a `parent` param, so
// without one the embedding origin is read from the browser. How the real
// frame picks its targetOrigin is not observable from the host; this is test
// plumbing, not protocol. '*' is never a fallback.
function resolveTarget(params: URLSearchParams): Target {
  if (window.parent === window) {
    return { origin: null, reason: 'not embedded: window.parent is itself' };
  }
  const param = params.get('parent');
  if (param !== null) {
    return originOf(param) === param
      ? { origin: param, reason: null }
      : {
          origin: null,
          reason: `parent=${param} is not a serialized origin`,
        };
  }
  const ancestor = location.ancestorOrigins?.[0];
  const origin =
    (ancestor && originOf(ancestor)) || originOf(document.referrer);
  return origin
    ? { origin, reason: null }
    : {
        origin: null,
        reason: 'no parent param, ancestorOrigins or referrer to target',
      };
}

const params = new URLSearchParams(location.search);
const target = resolveTarget(params);
const log: ReceivedMessage[] = [];
const status = document.getElementById('status');

function render(note: string): void {
  if (!status) return;
  const where = target.origin ?? `unusable (${target.reason})`;
  status.textContent = `parent: ${where}\nreceived: ${log.length}\nlast: ${note}`;
}

function post(data: unknown): void {
  if (target.origin === null) {
    throw new Error(`fake-frame cannot post: ${target.reason}`);
  }
  window.parent.postMessage(data, target.origin);
}

function fixtureData(key: string): unknown {
  if (!outbound.has(key)) {
    const known = [...outbound.keys()].sort().join(', ');
    throw new Error(
      `fake-frame has no frame→host fixture "${key}"; known: ${known}`
    );
  }
  return outbound.get(key);
}

window.addEventListener('message', (event) => {
  log.push({
    origin: event.origin,
    data: event.data,
    fromParent: event.source === window.parent,
  });
  render(`received from ${event.origin}`);
});

const api: FakeAuco = {
  parentOrigin: target.origin,
  unusableReason: target.reason,
  fixtures: () => [...outbound.keys()].sort(),
  send(fixtureId, variant) {
    const key = variant === undefined ? fixtureId : `${fixtureId}.${variant}`;
    post(fixtureData(key));
    render(`sent ${key}`);
  },
  sendRaw(data) {
    post(data);
    render('sent raw');
  },
  received: () => [...log],
  clear() {
    log.length = 0;
    render('cleared');
  },
  reload() {
    setTimeout(() => location.reload(), 0);
  },
};
window.fakeAuco = api;

// `scenario` lists fixture keys to send on load, in order. Absent, the frame
// announces itself with frame.ready, the message the host needs to start any
// product (PROTOCOL.md, frame.ready). `scenario=` (empty) sends nothing: a
// frame that never becomes ready.
const scenario = params.has('scenario')
  ? (params.get('scenario') ?? '').split(',').filter((step) => step !== '')
  : ['frame.ready'];
render('loaded');
// Resolve every step first: a typo must not leave a half-played scenario.
for (const step of scenario) fixtureData(step);
for (const step of scenario) api.send(step);
render(scenario.length ? `sent ${scenario.join(', ')}` : 'silent scenario');
