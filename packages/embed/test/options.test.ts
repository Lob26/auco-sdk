import { describe, expect, it } from 'vitest';
import {
  AucoConfigError,
  AucoOptionsError,
  createSession,
  type SessionOptions,
} from '../src/index';
import { adoptedFrame, ORIGIN, start } from './support';

type Placement = 'container' | 'iframe';

/**
 * Mounts a container and an adopted iframe, so a test can check that a
 * rejected option left both exactly as they were.
 */
const placements = () => {
  const container = document.createElement('div');
  document.body.append(container);
  const frame = adoptedFrame();
  return {
    container,
    iframe: frame.iframe,
    untouched: () => {
      expect(container.childNodes).toHaveLength(0);
      expect(frame.iframe.src).toBe('');
      expect(frame.iframe.isConnected).toBe(true);
    },
  };
};

const attempt = (options: Record<string, unknown>): unknown => {
  try {
    createSession(options as unknown as SessionOptions);
  } catch (error) {
    return error;
  }
  throw new Error('createSession accepted the options');
};

const valid = { product: 'sign', origin: ORIGIN, language: 'es', data: {} };

describe('option validation, before the DOM is touched', () => {
  it('rejects both container and iframe', () => {
    const dom = placements();
    const error = attempt({
      ...valid,
      container: dom.container,
      iframe: dom.iframe,
    });
    expect(error).toBeInstanceOf(AucoOptionsError);
    dom.untouched();
  });

  it('rejects neither container nor iframe', () => {
    expect(attempt(valid)).toBeInstanceOf(AucoOptionsError);
  });

  const optionFaults: [string, Record<string, unknown>][] = [
    ['both env and origin', { env: 'production' }],
    ['neither env nor origin', { origin: undefined }],
    ['an origin with a trailing slash', { origin: `${ORIGIN}/` }],
    ['an origin with a path', { origin: `${ORIGIN}/sdk` }],
    ['an uppercase origin', { origin: 'HTTPS://SIGN.AUCO.AI' }],
    ['an origin that is not a URL', { origin: 'sign.auco.ai' }],
    ['language fr', { language: 'fr' }],
    ['parentUrl full', { parentUrl: 'full' }],
    ['a non-function getToken', { auth: { getToken: 'tok' } }],
    ['a negative handshakeTimeoutMs', { handshakeTimeoutMs: -1 }],
    ['a NaN handshakeTimeoutMs', { handshakeTimeoutMs: Number.NaN }],
    ['an infinite handshakeTimeoutMs', { handshakeTimeoutMs: Infinity }],
    ['a handshakeTimeoutMs over 2^31 - 1', { handshakeTimeoutMs: 2 ** 31 }],
    ['a numeric-string handshakeTimeoutMs', { handshakeTimeoutMs: '100' }],
    ['a negative tokenTimeoutMs', { tokenTimeoutMs: -1 }],
    ['a numeric-string tokenTimeoutMs', { tokenTimeoutMs: '100' }],
  ];

  describe.each(['container', 'iframe'] as Placement[])(
    'with a %s',
    (placement) => {
      it.each(optionFaults)('rejects %s as AucoOptionsError', (_, fault) => {
        const dom = placements();
        const error = attempt({
          ...valid,
          [placement]: dom[placement],
          ...fault,
        });
        expect(error).toBeInstanceOf(AucoOptionsError);
        expect((error as AucoOptionsError).code).toBe('invalid-option');
        dom.untouched();
      });

      it.each([
        ['an unknown product', { product: 'contract' }, 'unknown-product'],
        ['an unknown env', { origin: undefined, env: 'PROD' }, 'unknown-env'],
        [
          'list-validation with an env (a JS caller)',
          { product: 'list-validation', origin: undefined, env: 'production' },
          'no-default-origin',
        ],
      ])('rejects %s as AucoConfigError', (_, fault, code) => {
        const dom = placements();
        const error = attempt({
          ...valid,
          [placement]: dom[placement],
          ...fault,
        });
        expect(error).toBeInstanceOf(AucoConfigError);
        expect((error as AucoConfigError).code).toBe(code);
        dom.untouched();
      });

      it('throws the reason of an already aborted signal', () => {
        const dom = placements();
        const reason = new Error('aborted before start');
        const error = attempt({
          ...valid,
          [placement]: dom[placement],
          signal: AbortSignal.abort(reason),
        });
        expect(error).toBe(reason);
        dom.untouched();
      });
    }
  );

  it.each([0, 2 ** 31 - 1])(
    'accepts a handshakeTimeoutMs of %d',
    (handshakeTimeoutMs) => {
      const { iframe } = placements();
      expect(() =>
        start({ ...valid, iframe, handshakeTimeoutMs } as SessionOptions)
      ).not.toThrow();
    }
  );

  it('accepts list-validation with an explicit origin', () => {
    const { iframe } = placements();
    const session = start({
      product: 'list-validation',
      origin: 'https://lists.example.com',
      iframe,
      language: 'es',
      data: {},
    });
    expect(session.origin).toBe('https://lists.example.com');
  });

  it('resolves env sandbox to the stage origin', () => {
    const { iframe } = placements();
    const session = start({
      ...valid,
      origin: undefined,
      env: 'sandbox',
      iframe,
    } as SessionOptions);
    expect(session.origin).toBe('https://sign-stage.auco.ai');
    expect(iframe.src.startsWith('https://sign-stage.auco.ai?id=')).toBe(true);
  });
});

describe('created iframe', () => {
  const create = (language: 'es' | 'en') => {
    const container = document.createElement('div');
    document.body.append(container);
    const session = start({
      product: 'sign',
      origin: ORIGIN,
      container,
      language,
      data: {},
    });
    return { container, iframe: session.iframe };
  };

  it('is appended to the container', () => {
    const { container, iframe } = create('es');
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild).toBe(iframe);
  });

  it('allows camera, microphone and clipboard-write', () => {
    expect(create('es').iframe.getAttribute('allow')).toBe(
      'camera; microphone; clipboard-write'
    );
  });

  it('sends a strict-origin-when-cross-origin referrer', () => {
    expect(create('es').iframe.getAttribute('referrerpolicy')).toBe(
      'strict-origin-when-cross-origin'
    );
  });

  it.each([
    ['es', 'Proceso de Auco'],
    ['en', 'Auco process'],
  ] as const)('is titled in %s', (language, title) => {
    expect(create(language).iframe.title).toBe(title);
  });

  it('fills its container as a borderless block', () => {
    const { style } = create('es').iframe;
    expect([style.display, style.width, style.height, style.border]).toEqual([
      'block',
      '100%',
      '100%',
      '0px',
    ]);
  });

  it('loads the frame origin', () => {
    expect(create('es').iframe.getAttribute('src')).toMatch(
      /^https:\/\/sign\.auco\.ai\?id=/
    );
  });
});
