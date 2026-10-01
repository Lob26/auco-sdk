/**
 * Base of every error the SDK throws or reports. `code` is a stable,
 * machine-readable literal; each subclass narrows `C` to its own union, so
 * new layers add codes without editing this package.
 */
export class AucoError<C extends string = string> extends Error {
  override name = 'AucoError';
  readonly code: C;

  constructor(code: C, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

/** Codes of {@link AucoConfigError}. */
export type AucoConfigErrorCode =
  | 'unknown-product'
  | 'unknown-env'
  | 'no-default-origin';

/**
 * A configuration that can never work, detected before any iframe is
 * touched (for example a product without a default origin).
 */
export class AucoConfigError extends AucoError<AucoConfigErrorCode> {
  override name = 'AucoConfigError';
}
