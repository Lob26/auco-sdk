import { describe, expect, it } from 'vitest';
import {
  AucoError,
  AucoHandlerError,
  AucoHandshakeTimeout,
  AucoOptionsError,
  AucoProtocolError,
  AucoTokenError,
} from '../src/index';

// `name` is what logs and reportError print, and a minifier renames classes:
// each subclass must carry its own, not inherit AucoError's.
describe('session error classes', () => {
  const classes = [
    ['AucoOptionsError', AucoOptionsError],
    ['AucoHandshakeTimeout', AucoHandshakeTimeout],
    ['AucoTokenError', AucoTokenError],
    ['AucoProtocolError', AucoProtocolError],
    ['AucoHandlerError', AucoHandlerError],
  ] as const;

  const make = (Class: (typeof classes)[number][1], cause?: unknown) =>
    new (
      Class as new (
        code: string,
        message: string,
        options?: { cause?: unknown }
      ) => AucoError
    )('some-code', 'message', { cause });

  it.each(classes)('%s is named %s', (name, Class) => {
    expect(make(Class).name).toBe(name);
  });

  it.each(classes)('%s is an AucoError and an Error', (_, Class) => {
    const error = make(Class);
    expect(error).toBeInstanceOf(AucoError);
    expect(error).toBeInstanceOf(Error);
  });

  it.each(classes)('%s keeps its code and cause', (_, Class) => {
    const cause = new Error('root');
    const error = make(Class, cause);
    expect(error.code).toBe('some-code');
    expect(error.cause).toBe(cause);
  });
});
