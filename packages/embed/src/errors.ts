import { AucoError } from '@lob26/auco-protocol';

// Each class repeats `name` as an own field: a minifier renames classes, and
// `error.name` is what shows up in logs and in reportError output.

/**
 * An option of {@link createSession} that can never work (two placements, a
 * malformed `origin`, an unknown `language`, a negative timeout…). Thrown
 * synchronously, before the DOM is touched. Product and env faults are
 * {@link AucoConfigError}, from the origin resolver.
 */
export class AucoOptionsError extends AucoError<'invalid-option'> {
  override name = 'AucoOptionsError';
}

/** No `frame.ready` arrived within `handshakeTimeoutMs`; the session fails. */
export class AucoHandshakeTimeout extends AucoError<'handshake-timeout'> {
  override name = 'AucoHandshakeTimeout';
}

/** Codes of {@link AucoTokenError}. */
export type AucoTokenErrorCode =
  | 'token-unavailable'
  | 'token-failed'
  | 'token-timeout';

/**
 * A `frame.token-request` went unanswered: no `getToken` nor `publicKey`
 * (`token-unavailable`), `getToken` rejected (`token-failed`, the rejection
 * is the `cause`) or it outlived `tokenTimeoutMs` (`token-timeout`). The
 * frame is told nothing: its protocol has no error message (PROTOCOL.md §4
 * q2). The session stays open.
 */
export class AucoTokenError extends AucoError<AucoTokenErrorCode> {
  override name = 'AucoTokenError';
}

/** Codes of {@link AucoProtocolError}. */
export type AucoProtocolErrorCode = 'frame-unreachable' | 'post-failed';

/**
 * A message to the frame was not sent: the iframe has no `contentWindow`
 * (`frame-unreachable`, it was detached) or `postMessage` threw
 * (`post-failed`, typically a `DataCloneError` from a function in `data`).
 */
export class AucoProtocolError extends AucoError<AucoProtocolErrorCode> {
  override name = 'AucoProtocolError';
}

/**
 * A promise passed to a terminal event's `waitUntil` rejected; its reason is
 * the `cause`. The session stays open, as 1.0.9 keeps listening when a
 * handler rejects.
 */
export class AucoHandlerError extends AucoError<'handler-rejected'> {
  override name = 'AucoHandlerError';
}

/** Every error a session reports through its `error` event. */
export type AucoSessionError =
  | AucoHandshakeTimeout
  | AucoTokenError
  | AucoProtocolError
  | AucoHandlerError;
