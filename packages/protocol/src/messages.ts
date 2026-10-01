import type { FlowType, Language } from './products';
import type { NotificationData, PayData } from './types';

/** An object-shaped `MessageEvent.data`, as received. */
export type RawFrameData = Readonly<Record<string, unknown>>;

/**
 * A frame → host message, discriminated by `kind`. Typed fields are checked:
 * a value of the wrong shape reads as `undefined`. `raw` keeps the data as
 * received, for callers that must reproduce 1.0.9 byte for byte.
 */
export type FrameMessage =
  | { readonly kind: 'ready'; readonly raw: RawFrameData }
  | { readonly kind: 'token-request'; readonly raw: RawFrameData }
  | {
      readonly kind: 'pay';
      readonly data: PayData | undefined;
      readonly raw: RawFrameData;
    }
  | {
      readonly kind: 'notification';
      readonly data: NotificationData | undefined;
      readonly raw: RawFrameData;
    }
  | FrameClose
  | { readonly kind: 'finish'; readonly raw: RawFrameData }
  | { readonly kind: 'back'; readonly raw: RawFrameData }
  | { readonly kind: 'unknown'; readonly raw: unknown };

/** All values of {@link FrameMessage}'s `kind`. */
export type FrameMessageKind = FrameMessage['kind'];

/**
 * `frame.close` (`SDK-CLOSE`) with its fields as received, not flattened
 * into 1.0.9's positional `onSDKClose(a, b, c)`. `terminal` is false only
 * for `status === 'PENDING'`, the one non-terminal close 1.0.9 knows.
 */
export interface FrameClose {
  readonly kind: 'close';
  readonly document: string | undefined;
  /** A number per 1.0.9's types, a string per the SDK docs (audit 6.5). */
  readonly similarity: number | string | undefined;
  readonly redirectTo: string | undefined;
  readonly status: string | undefined;
  /** Entries are not shape-checked; see `SignProfileEntry` for the documented one. */
  readonly signProfile: readonly unknown[] | undefined;
  readonly terminal: boolean;
  readonly raw: RawFrameData;
}

/**
 * Classifies a `MessageEvent.data` the way 1.0.9 dispatches it
 * (PROTOCOL.md §1.4): a truthy `ready` wins; a `type` string containing
 * `'token'` (case-sensitive substring) or a `type` array containing
 * `'token'` is a token request; `SDK-PAY`, `SDK-NOTIFICATION`, `SDK-CLOSE`,
 * `SDK-FINISH` and `SDK-BACK` match by exact equality. Unlike 1.0.9 it never
 * throws: non-object data, a `type` that is neither string nor array, a
 * getter or proxy that throws, and anything unmatched become
 * `kind: 'unknown'`. It does not check origin or
 * source; that is the caller's job.
 */
export function parseFrameMessage(data: unknown): FrameMessage {
  try {
    return classify(data);
  } catch {
    // Structured clone never yields getters or proxies, but a same-origin
    // window can post anything; a hostile shape is just an unknown message.
    return { kind: 'unknown', raw: data };
  }
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const isRecord = (value: unknown): value is RawFrameData =>
  typeof value === 'object' && value !== null;

const payData = (value: unknown): PayData | undefined =>
  isRecord(value) &&
  typeof value.code === 'string' &&
  typeof value.epaycoKey === 'string'
    ? (value as unknown as PayData)
    : undefined;

const notificationData = (value: unknown): NotificationData | undefined =>
  isRecord(value) && typeof value.message === 'string'
    ? (value as unknown as NotificationData)
    : undefined;

function classify(data: unknown): FrameMessage {
  if (!isRecord(data)) return { kind: 'unknown', raw: data };
  const raw = data;
  if (raw.ready) return { kind: 'ready', raw };

  const type = raw.type;
  // The frame's real token literal is unknown (PROTOCOL.md §4 q1), so the
  // 1.0.9 predicate is kept as is rather than narrowed to one value.
  if (
    (typeof type === 'string' || Array.isArray(type)) &&
    type.includes('token')
  ) {
    return { kind: 'token-request', raw };
  }
  switch (type) {
    case 'SDK-PAY':
      return { kind: 'pay', data: payData(raw.data), raw };
    case 'SDK-NOTIFICATION':
      return {
        kind: 'notification',
        data: notificationData(raw.data),
        raw,
      };
    case 'SDK-CLOSE':
      return {
        kind: 'close',
        document: str(raw.document),
        similarity:
          typeof raw.similarity === 'number'
            ? raw.similarity
            : str(raw.similarity),
        redirectTo: str(raw.redirectTo),
        status: str(raw.status),
        signProfile: Array.isArray(raw.signProfile)
          ? raw.signProfile
          : undefined,
        terminal: raw.status !== 'PENDING',
        raw,
      };
    case 'SDK-FINISH':
      return { kind: 'finish', raw };
    case 'SDK-BACK':
      return { kind: 'back', raw };
    default:
      return { kind: 'unknown', raw };
  }
}

/** Input of {@link buildHostInit}. */
export interface HostInitInput {
  readonly language: Language;
  /** Product data (`sdkData`), spread at the root of the message. */
  readonly data: object | undefined;
  /** Always sent as an own key, even when `undefined`. */
  readonly keyPublic: string | null | undefined;
  /** Sent as `sdkParentURL`. */
  readonly parentUrl: string;
  readonly flowType?: FlowType | undefined;
}

/**
 * `host.init`. Keys from `data` sit at the root, so a `data.language`
 * overrides `language`, while `keyPublic`, `sdkParentURL` and a set
 * `flowType` override `data`.
 */
export interface HostInitMessage {
  readonly [key: string]: unknown;
  readonly keyPublic: string | null | undefined;
  readonly sdkParentURL: string;
}

/**
 * The `host.init` object 1.0.9 posts in reply to `frame.ready`, key for key
 * and in the same order: `language`, the spread `data`, `keyPublic`,
 * `sdkParentURL`, then `flowType` when given.
 */
export function buildHostInit({
  language,
  data,
  keyPublic,
  parentUrl,
  flowType,
}: HostInitInput): HostInitMessage {
  return {
    language,
    ...data,
    keyPublic,
    sdkParentURL: parentUrl,
    ...(flowType === undefined ? undefined : { flowType }),
  };
}

/** `host.token`, the reply to `frame.token-request`. */
export interface HostTokenMessage {
  readonly type: 'token';
  readonly token: string;
}

/** Builds `host.token`: `{ type: 'token', token }`. */
export function buildHostToken(token: string): HostTokenMessage {
  return { type: 'token', token };
}
