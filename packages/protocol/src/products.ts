/** The nine `sdkType` values of 1.0.9, in the order `types.ts` declares them. */
export const PRODUCTS = [
  'upload',
  'upload-v2',
  'read',
  'attachments',
  'validation-attachments',
  'validation',
  'sign',
  'list-validation',
  'fill',
] as const;

export type Product = (typeof PRODUCTS)[number];

const FLOW_TYPES = [
  'upload',
  'read',
  'attachments',
  'validation-attachments',
] as const;

/** Products whose `host.init` carries a `flowType` equal to the product. */
export type FlowType = (typeof FLOW_TYPES)[number];

/** UI language accepted by every frame. */
export type Language = 'es' | 'en';

function isOneOf<T extends string>(
  list: readonly T[],
  value: unknown
): value is T {
  return (list as readonly unknown[]).includes(value);
}

/** True when `value` is one of {@link PRODUCTS}; safe on any input. */
export function isProduct(value: unknown): value is Product {
  return isOneOf(PRODUCTS, value);
}

/**
 * The `flowType` 1.0.9 appends to `host.init`: the product itself for
 * `upload`, `read`, `attachments` and `validation-attachments`, otherwise
 * `undefined` (notably `upload-v2`, which carries none).
 */
export function flowTypeFor(product: Product): FlowType | undefined {
  return isOneOf(FLOW_TYPES, product) ? product : undefined;
}
