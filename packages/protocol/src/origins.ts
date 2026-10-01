import { AucoConfigError } from './errors';
import { isProduct, type Product } from './products';

/** v2 environments: `production` is Auco's PROD map, `sandbox` its STAGE map. */
export type Env = 'production' | 'sandbox';

/** Products with a default origin; `list-validation` has none in 1.0.9. */
export type ProductWithOrigin = Exclude<Product, 'list-validation'>;

type Tier = '' | '-stage' | '-dev';

// Every 1.0.9 origin is `https://<host><tier>.auco.ai`, so one host per
// product reproduces all three of its maps. '' means "no default origin".
const HOSTS: Readonly<Record<Product, string>> = {
  upload: 'upload',
  'upload-v2': 'uploadv2',
  read: 'upload',
  attachments: 'upload',
  'validation-attachments': 'upload',
  validation: 'veriface',
  sign: 'sign',
  'list-validation': '',
  fill: 'fill2',
};

function originFor(product: Product, tier: Tier): string {
  const host = HOSTS[product];
  if (host === '') return '';
  // 1.0.9's internal DEV map sends fill to fill2-stage (audit 3.6); whether a
  // fill2-dev exists is an open question for Auco (PROTOCOL.md §4 q11).
  const suffix = product === 'fill' && tier === '-dev' ? '-stage' : tier;
  return `https://${host}${suffix}.auco.ai`;
}

/**
 * Default frame origin of `product` in `env`. Total: every input either
 * yields an `https://…auco.ai` origin or throws {@link AucoConfigError}
 * (`unknown-product`, `unknown-env`, or `no-default-origin` for
 * `list-validation`, which the type already rules out for TS callers). Auco's internal `*-dev` hosts are never returned; they
 * are reachable only through an explicit origin.
 */
export function resolveOrigin(product: ProductWithOrigin, env: Env): string {
  if (!isProduct(product)) {
    throw new AucoConfigError(
      'unknown-product',
      `Unknown Auco product: ${String(product)}`
    );
  }
  if (env !== 'production' && env !== 'sandbox') {
    throw new AucoConfigError(
      'unknown-env',
      `Unknown env: ${String(env)}; expected 'production' or 'sandbox'`
    );
  }
  const origin = originFor(product, env === 'production' ? '' : '-stage');
  if (origin === '') {
    throw new AucoConfigError(
      'no-default-origin',
      `${product} has no default origin; pass an explicit origin`
    );
  }
  return origin;
}

/** Input of {@link resolveLegacyOrigin}, as a 1.x `Config` carries it. */
export interface LegacyOriginInput {
  readonly sdkType: string;
  readonly env: string;
  readonly keyPublic?: string | null | undefined;
  readonly customOrigin?: string | null | undefined;
}

/**
 * 1.0.9's `resolveOrigin`, rule for rule (PROTOCOL.md §1.1): a non-empty
 * `customOrigin` wins; `DEV` without `keyPublic` uses the internal `*-dev`
 * map; `DEV` or `STAGE` uses `*-stage`; anything else is PROD. Returns `''`
 * for `list-validation` and `undefined` for an unknown `sdkType`, exactly as
 * 1.0.9 does; refusing those is the caller's decision.
 */
export function resolveLegacyOrigin({
  sdkType,
  env,
  keyPublic,
  customOrigin,
}: LegacyOriginInput): string | undefined {
  if (customOrigin) return customOrigin;
  // An own-key check, unlike 1.0.9's map lookup, so 'toString' and friends
  // resolve to undefined instead of an inherited function.
  if (!isProduct(sdkType)) return undefined;
  if (env === 'DEV' && !keyPublic) return originFor(sdkType, '-dev');
  if (env === 'DEV' || env === 'STAGE') return originFor(sdkType, '-stage');
  return originFor(sdkType, '');
}
