import { AucoSDK } from '@lob26/auco-compat';
import { type AucoSession, createSession } from '@lob26/auco-embed';

// Host-side harness, driven from the specs with page.evaluate. It records
// what the host window observes and never reacts to it, so the only code
// that talks to the frame is the SDK under test.

/** A `message` event the host window received, as it arrived. */
export interface HostMessage {
  readonly origin: string;
  readonly data: unknown;
  /** id of the iframe (or of its container) whose window sent it, else null. */
  readonly from: string | null;
}

export interface Fault {
  readonly kind: 'error' | 'unhandledrejection';
  readonly message: string;
}

export interface RecordedEvent {
  readonly type: string;
  /** JSON copy of `detail`; an `error` event keeps only name and code. */
  readonly detail: unknown;
}

export type Settlement =
  | { readonly outcome: unknown }
  | { readonly failure: { readonly name: string; readonly code: unknown } };

export interface SessionRecord {
  readonly session: AucoSession;
  readonly events: RecordedEvent[];
  settled: Settlement | null;
}

const SESSION_EVENTS = [
  'ready',
  'close',
  'finish',
  'back',
  'pay',
  'notification',
  'unknown',
  'error',
  'statechange',
] as const;

const faults: Fault[] = [];
const describe = (value: unknown): string =>
  value instanceof Error ? `${value.name}: ${value.message}` : String(value);
window.addEventListener('error', (event) => {
  faults.push({
    kind: 'error',
    message: describe(event.error ?? event.message),
  });
});
window.addEventListener('unhandledrejection', (event) => {
  faults.push({ kind: 'unhandledrejection', message: describe(event.reason) });
});

const slots = document.getElementById('slots') as HTMLElement;

const senderOf = (source: MessageEventSource | null): string | null => {
  for (const iframe of document.querySelectorAll('iframe')) {
    if (iframe.contentWindow !== null && iframe.contentWindow === source) {
      return iframe.id || iframe.parentElement?.id || null;
    }
  }
  return null;
};

const messages: HostMessage[] = [];
window.addEventListener('message', (event) => {
  messages.push({
    origin: event.origin,
    data: event.data,
    from: senderOf(event.source),
  });
});

const sessions: SessionRecord[] = [];

const copyDetail = (type: string, detail: unknown): unknown => {
  if (type === 'error') {
    const { error } = detail as { error: { name: string; code: unknown } };
    return { error: { name: error.name, code: error.code } };
  }
  return JSON.parse(JSON.stringify(detail ?? null));
};

/** One call of a compat callback, with a JSON copy of its arguments. */
export interface CallbackCall {
  readonly name: string;
  readonly args: unknown;
}

const calls: CallbackCall[] = [];

const harness = {
  createSession,
  AucoSDK,
  faults,
  messages,
  sessions,
  calls,
  /** Unsubscribe functions returned by AucoSDK, in call order. */
  stops: [] as (() => void)[],
  /** A callback that records each call in `calls` under `name`. */
  record(name: string): (...args: unknown[]) => void {
    return (...args) => {
      calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
    };
  },
  /** Records every event and the settlement of `done`; returns its index. */
  track(session: AucoSession): number {
    const record: SessionRecord = { session, events: [], settled: null };
    for (const type of SESSION_EVENTS) {
      session.addEventListener(type, (event: Event) => {
        const { detail } = event as CustomEvent<unknown>;
        record.events.push({ type, detail: copyDetail(type, detail) });
      });
    }
    session.done.then(
      (outcome) => {
        record.settled = { outcome: JSON.parse(JSON.stringify(outcome)) };
      },
      (error: { name: string; code: unknown }) => {
        record.settled = { failure: { name: error.name, code: error.code } };
      }
    );
    return sessions.push(record) - 1;
  },
  /** An empty container `<div id>` for a session to create its iframe in. */
  container(id: string): HTMLDivElement {
    const div = document.createElement('div');
    div.id = id;
    slots.append(div);
    return div;
  },
  /** An `<iframe id>` with no `src` and no `allow`, to adopt or to load. */
  iframe(id: string, src?: string): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.id = id;
    if (src !== undefined) iframe.src = src;
    slots.append(iframe);
    return iframe;
  },
  /** Posts `data` to the iframe found by `selector`, at `targetOrigin`. */
  postTo(selector: string, data: unknown, targetOrigin: string): void {
    const iframe = document.querySelector<HTMLIFrameElement>(selector);
    if (!iframe?.contentWindow) throw new Error(`no frame at ${selector}`);
    iframe.contentWindow.postMessage(data, targetOrigin);
  },
};

export type Harness = typeof harness;

declare global {
  interface Window {
    harness: Harness;
  }
}

window.harness = harness;
