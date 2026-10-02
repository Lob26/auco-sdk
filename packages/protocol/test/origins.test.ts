import { describe, expect, it } from 'vitest';
import {
  AucoConfigError,
  AucoError,
  type Env,
  PRODUCTS,
  type Product,
  type ProductWithOrigin,
  resolveLegacyOrigin,
  resolveOrigin,
} from '../src/index';

// PROTOCOL.md §1.1, column for column: PROD | STAGE, or DEV with keyPublic |
// DEV without keyPublic.
const TABLE: Record<Product, readonly [string, string, string]> = {
  upload: [
    'https://upload.auco.ai',
    'https://upload-stage.auco.ai',
    'https://upload-dev.auco.ai',
  ],
  'upload-v2': [
    'https://uploadv2.auco.ai',
    'https://uploadv2-stage.auco.ai',
    'https://uploadv2-dev.auco.ai',
  ],
  read: [
    'https://upload.auco.ai',
    'https://upload-stage.auco.ai',
    'https://upload-dev.auco.ai',
  ],
  attachments: [
    'https://upload.auco.ai',
    'https://upload-stage.auco.ai',
    'https://upload-dev.auco.ai',
  ],
  'validation-attachments': [
    'https://upload.auco.ai',
    'https://upload-stage.auco.ai',
    'https://upload-dev.auco.ai',
  ],
  validation: [
    'https://veriface.auco.ai',
    'https://veriface-stage.auco.ai',
    'https://veriface-dev.auco.ai',
  ],
  sign: [
    'https://sign.auco.ai',
    'https://sign-stage.auco.ai',
    'https://sign-dev.auco.ai',
  ],
  fill: [
    'https://fill2.auco.ai',
    'https://fill2-stage.auco.ai',
    'https://fill2-stage.auco.ai',
  ],
  'list-validation': ['', '', ''],
};

const KEY = 'puk_00000000000000000000000000000000';
const CUSTOM = 'https://frame.example.com';

const rows = PRODUCTS.map((product) => {
  const [prod, stage, dev] = TABLE[product];
  return { product, prod, stage, dev };
});

describe('resolveLegacyOrigin (PROTOCOL.md §1.1)', () => {
  it('covers the nine sdkTypes', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...PRODUCTS].sort());
  });

  describe.each(rows)('$product', ({ product, prod, stage, dev }) => {
    const resolve = (
      rest: Omit<Parameters<typeof resolveLegacyOrigin>[0], 'sdkType'>
    ) => resolveLegacyOrigin({ sdkType: product, ...rest });

    it('PROD uses the PROD map, with or without keyPublic', () => {
      expect(resolve({ env: 'PROD', keyPublic: KEY })).toBe(prod);
      expect(resolve({ env: 'PROD' })).toBe(prod);
    });

    it('an unknown env falls back to PROD', () => {
      expect(resolve({ env: 'production', keyPublic: KEY })).toBe(prod);
      expect(resolve({ env: '' })).toBe(prod);
    });

    // 1.0.9 compares env with ===: any other casing is an unknown env.
    it.each(['stage', 'Stage', 'dev', 'Dev', 'prod'])(
      'env %j is case-sensitive and falls back to PROD',
      (env) => {
        expect(resolve({ env })).toBe(prod);
      }
    );

    it('STAGE uses the stage map, with or without keyPublic', () => {
      expect(resolve({ env: 'STAGE', keyPublic: KEY })).toBe(stage);
      expect(resolve({ env: 'STAGE' })).toBe(stage);
    });

    it('DEV with keyPublic uses the stage map', () => {
      expect(resolve({ env: 'DEV', keyPublic: KEY })).toBe(stage);
    });

    it.each([undefined, '', null])(
      'DEV with keyPublic %j uses the internal dev map',
      (keyPublic) => {
        expect(resolve({ env: 'DEV', keyPublic })).toBe(dev);
      }
    );

    it.each(['PROD', 'STAGE', 'DEV'])('a customOrigin wins under %s', (env) => {
      expect(resolve({ env, customOrigin: CUSTOM })).toBe(CUSTOM);
    });

    it('an empty customOrigin does not win', () => {
      expect(resolve({ env: 'PROD', customOrigin: '' })).toBe(prod);
    });
  });

  // 1.0.9 returns customOrigin before it ever looks sdkType up.
  it.each(['nope', 'toString', '__proto__'])(
    'a customOrigin wins for an unknown sdkType %j',
    (sdkType) => {
      expect(
        resolveLegacyOrigin({ sdkType, env: 'PROD', customOrigin: CUSTOM })
      ).toBe(CUSTOM);
    }
  );

  it.each(['nope', 'toString', '__proto__', 'constructor'])(
    'an unknown sdkType %j resolves to undefined',
    (sdkType) => {
      expect(resolveLegacyOrigin({ sdkType, env: 'PROD' })).toBeUndefined();
    }
  );
});

const configError = (fn: () => unknown): AucoConfigError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AucoConfigError) return error;
    throw error;
  }
  throw new Error('expected an AucoConfigError, nothing was thrown');
};

describe('resolveOrigin', () => {
  const withOrigin = rows.filter(
    (row): row is typeof row & { product: ProductWithOrigin } =>
      row.product !== 'list-validation'
  );

  it.each(withOrigin)('$product: production is the PROD map', (row) => {
    expect(resolveOrigin(row.product, 'production')).toBe(row.prod);
  });

  it.each(withOrigin)('$product: sandbox is the STAGE map', (row) => {
    expect(resolveOrigin(row.product, 'sandbox')).toBe(row.stage);
  });

  it.each(
    withOrigin.flatMap((row) =>
      (['production', 'sandbox'] as const).map((env) => [row.product, env])
    ) as [ProductWithOrigin, Env][]
  )('%s in %s is never an internal -dev host', (product, env) => {
    expect(resolveOrigin(product, env)).toMatch(
      /^https:\/\/[a-z0-9]+(-stage)?\.auco\.ai$/
    );
  });

  it.each(['production', 'sandbox'] as const)(
    'list-validation in %s throws no-default-origin',
    (env) => {
      // @ts-expect-error list-validation has no default origin: TS callers cannot ask for one.
      const error = configError(() => resolveOrigin('list-validation', env));
      expect(error.code).toBe('no-default-origin');
    }
  );

  it.each(['nope', 'toString'])(
    'an unknown product %j throws unknown-product',
    (product) => {
      const error = configError(() =>
        resolveOrigin(product as ProductWithOrigin, 'production')
      );
      expect(error.code).toBe('unknown-product');
    }
  );

  it.each(['PROD', 'STAGE', 'DEV', 'development'])(
    'an unknown env %j throws unknown-env',
    (env) => {
      const error = configError(() => resolveOrigin('sign', env as Env));
      expect(error.code).toBe('unknown-env');
    }
  );

  it('throws an AucoConfigError that is an AucoError and an Error', () => {
    const error = configError(() => resolveOrigin('sign', 'PROD' as Env));
    expect(error).toBeInstanceOf(AucoError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AucoConfigError');
  });
});
