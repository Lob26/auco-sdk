// Payload shapes as 1.0.9's types.ts declares them. The frame is not bound by
// them and nothing validates them at runtime: they describe, they do not check.

/** `data` of `frame.pay` (`SDK-PAY`), passed through unvalidated. */
export interface PayData {
  code: string;
  epaycoKey: string;
  validation?: boolean;
  packageId?: string;
}

/**
 * `data` of `frame.notification` (`SDK-NOTIFICATION`), passed through
 * unvalidated. 1.0.9 types `options` as the DOM's `NotificationOptions`,
 * which looks accidental (audit 3.3); its real shape is unknown.
 */
export interface NotificationData {
  message: string;
  options: Record<string, unknown>;
}

/** One entry of `signProfile` in an `upload`/`upload-v2` `frame.close`. */
export interface SignProfileEntry {
  id: string;
  name: string;
  email: string;
  phone: string;
}
