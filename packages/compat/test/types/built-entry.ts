// Type assertions for the published entry. `tsc -p test/types` resolves
// `@lob26/auco-compat` without the `source` condition, so it checks
// dist/index.d.mts (built-entry.test.ts runs it after the build); the
// package's own typecheck resolves the same import to src, so both agree.
import type {
  AucoConfigError,
  AucoError,
  AucoOptionsError,
  Config,
  SDKEvents,
} from '@lob26/auco-compat';
import { expectTypeOf } from 'vitest';

type OnSDKError = NonNullable<SDKEvents['onSDKError']>;
type ListValidationEvents = Extract<
  Config,
  { sdkType: 'list-validation' }
>['events'];

expectTypeOf<Parameters<OnSDKError>>().toEqualTypeOf<[error: AucoError]>();
expectTypeOf<
  Parameters<NonNullable<ListValidationEvents['onSDKError']>>
>().toEqualTypeOf<[error: AucoError]>();
expectTypeOf<AucoConfigError>().toExtend<AucoError>();
expectTypeOf<AucoOptionsError>().toExtend<AucoError>();
expectTypeOf<AucoError['code']>().toEqualTypeOf<string>();
// 1.x list-validation requires every 1.x callback, but onSDKError is new: a
// 1.x integration that never heard of it must still compile.
expectTypeOf<
  Omit<ListValidationEvents, 'onSDKError'>
>().toExtend<ListValidationEvents>();
// ...and it does require the 1.x ones, as 1.x did (Required<SDKEvents>).
expectTypeOf<
  Omit<ListValidationEvents, 'onSDKPay'>
>().not.toExtend<ListValidationEvents>();

// Every other product keeps 1.x's optionality: only onSDKReady and
// onSDKClose are required, so a 1.x integration with just those compiles.
type EventsOf<T extends Config['sdkType']> = Extract<
  Config,
  { sdkType: T }
>['events'];
// Plain assignability, not expectTypeOf: toExtend compares optional members
// too strictly to express "the others may be left out".
declare const minimal: { onSDKReady(): void; onSDKClose(): void };
export const minimal0: EventsOf<'sign'> = minimal;
export const minimal1: EventsOf<'upload'> = minimal;
export const minimal2: EventsOf<'upload-v2'> = minimal;
export const minimal3: EventsOf<'read'> = minimal;
export const minimal4: EventsOf<'attachments'> = minimal;
export const minimal5: EventsOf<'validation-attachments'> = minimal;
export const minimal6: EventsOf<'validation'> = minimal;
export const minimal7: EventsOf<'fill'> = minimal;
