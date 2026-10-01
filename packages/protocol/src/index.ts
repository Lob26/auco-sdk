export {
  AucoConfigError,
  type AucoConfigErrorCode,
  AucoError,
} from './errors';
export {
  buildHostInit,
  buildHostToken,
  type FrameClose,
  type FrameMessage,
  type FrameMessageKind,
  type HostInitInput,
  type HostInitMessage,
  type HostTokenMessage,
  parseFrameMessage,
  type RawFrameData,
} from './messages';
export {
  type Env,
  type LegacyOriginInput,
  type ProductWithOrigin,
  resolveLegacyOrigin,
  resolveOrigin,
} from './origins';
export {
  type FlowType,
  flowTypeFor,
  isProduct,
  type Language,
  PRODUCTS,
  type Product,
} from './products';
export type { NotificationData, PayData, SignProfileEntry } from './types';
