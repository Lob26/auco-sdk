import { describe, expect, it } from 'vitest';
import { AucoConfigError, AucoError } from '../src/index';

describe('AucoError', () => {
  it('keeps its code and message', () => {
    const error = new AucoError('some-code', 'message');
    expect(error.code).toBe('some-code');
    expect(error.message).toBe('message');
  });

  // Layers above wrap a rejection or a DataCloneError as the cause; dropping
  // it loses the only trace of what actually failed.
  it.each([
    ['AucoError', AucoError],
    ['AucoConfigError', AucoConfigError],
  ] as const)('%s keeps the cause it is given', (_, Class) => {
    const cause = new Error('root');
    const error = new Class('unknown-env', 'message', { cause });
    expect(error.cause).toBe(cause);
  });

  it('has no cause when none is given', () => {
    expect('cause' in new AucoError('some-code', 'message')).toBe(false);
  });

  it.each([
    ['AucoError', AucoError],
    ['AucoConfigError', AucoConfigError],
  ] as const)('%s is named %s', (name, Class) => {
    expect(new Class('unknown-env', 'message').name).toBe(name);
  });
});
