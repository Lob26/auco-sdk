import {
  AucoConfigError,
  AucoError,
  AucoHandlerError,
  AucoOptionsError,
  type AucoSession,
  AucoTokenError,
  createSession,
} from '@lob26/auco-embed';
import { isProduct, resolveLegacyOrigin } from '@lob26/auco-protocol';
import type { Config, TAucoSDK } from './types';

export {
  AucoConfigError,
  AucoError,
  AucoOptionsError,
} from '@lob26/auco-embed';
export type {
  Config,
  EnvType,
  Languages,
  SDKEvents,
  SDKs,
  SDKTypeObjectKeys,
  SDKUploadData,
  TAucoSDK,
} from './types';

// The 1.x callbacks as 1.0.9 invokes them: positional raw values, whatever
// the product. Method syntax is deliberate: its parameters are bivariant, so
// every variant of `Config['events']` is assignable without a cast.
interface FrameCallbacks {
  onSDKReady(): unknown;
  onSDKClose(first: unknown, second: unknown, signProfile: unknown): unknown;
  onSDKBack?(): unknown;
  onSDKFinish?(): unknown;
  onSDKToken?(): Promise<string>;
  onSDKPay?(data: unknown): unknown;
  onSDKNotification?(data: unknown): unknown;
  onSDKError?(error: AucoError): unknown;
}

// One live session per iframe: 1.0.9 stacked a listener per call (audit 1.6).
const sessions = new WeakMap<HTMLIFrameElement, AucoSession>();

// 1.0.9 awaited every callback, so a synchronous throw and a rejection are
// one failure here too.
const settle = (callback: () => unknown): Promise<unknown> =>
  new Promise((resolve) => {
    resolve(callback());
  });

/**
 * Embeds the Auco flow `params.sdkType` in the iframe `params.iframeId` and
 * bridges its messages to `params.events`, with the 1.x signature, start-time
 * checks and error messages. Returns a function that ends the session and
 * points the iframe at `about:blank`.
 *
 * Throws synchronously, before touching the iframe, on any 1.x start-time
 * fault, and with an {@link AucoConfigError} when `sdkType` is unknown or
 * has no default origin and no `customOrigin` (`list-validation`), where
 * 1.0.9 loaded a relative or `undefined` URL, and with an `AucoOptionsError`
 * when `customOrigin` is not a bare origin, which 1.0.9 loaded but whose
 * messages it could never match. Calling it again on the same
 * iframe ends the previous session first.
 *
 * Unlike 1.0.9, only messages from this iframe's window are handled, `finish`
 * and `back` end the session even without a handler, and no failure becomes
 * an unhandled rejection: each goes to `events.onSDKError`, or to
 * `console.error` without one.
 */
export const AucoSDK: TAucoSDK = (params) => {
  validateParameters(params);
  const session = startSession(params);
  return () => session.destroy();
};

// 1.0.9's parametersValidation, check for check and message for message.
const validateParameters = (params: Config): void => {
  if (!params.iframeId) {
    throw new Error('Could not start SDK, iframeId is missing');
  }
  if (!['es', 'en'].includes(params.language)) {
    throw new Error(
      "Could not start SDK, language is missing or invalid, available options are 'es' and 'en' "
    );
  }
  if (params.sdkType === 'upload' || params.sdkType === 'attachments') {
    const custom = params.sdkData.custom;
    if (custom) {
      if (typeof custom !== 'object' || Array.isArray(custom)) {
        throw new Error(
          'Could not start SDK, custom data must be an object, received: ' +
            (Array.isArray(custom) ? 'array' : typeof custom)
        );
      }
      if (!Object.keys(custom).length) {
        throw new Error(
          'Could not start SDK, custom data is empty, received: ' +
            JSON.stringify(custom)
        );
      }
    }
  }
};

const resolveFrameOrigin = ({
  sdkType,
  env,
  keyPublic,
  customOrigin,
}: Config): string => {
  if (!isProduct(sdkType)) {
    throw new AucoConfigError(
      'unknown-product',
      `Could not start SDK, unknown sdkType: ${String(sdkType)}`
    );
  }
  const origin = resolveLegacyOrigin({ sdkType, env, keyPublic, customOrigin });
  if (!origin) {
    throw new AucoConfigError(
      'no-default-origin',
      `Could not start SDK, sdkType ${sdkType} has no default origin; set customOrigin`
    );
  }
  // embed refuses this too, but only after a restart has already released
  // the previous session's iframe; here the previous session survives.
  if (!isSerializedOrigin(origin)) {
    throw new AucoOptionsError(
      'invalid-option',
      `Could not start SDK, customOrigin must be an origin like https://host[:port], received: ${origin}`
    );
  }
  return origin;
};

const isSerializedOrigin = (value: string): boolean => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
};

const startSession = (params: Config): AucoSession => {
  const { iframeId, language, sdkData, keyPublic, sdkType } = params;
  const events: FrameCallbacks = params.events;

  const iframe = document.getElementById(iframeId) as HTMLIFrameElement | null;
  if (!iframe) {
    throw new Error(
      `Could not start SDK, Iframe with id: ${iframeId} not found`
    );
  }
  if (keyPublic && keyPublic.length !== 36 && !events.onSDKToken) {
    throw new Error('Could not start SDK, onSDKToken is missing');
  }
  if (keyPublic && keyPublic.length !== 36) {
    throw new Error('Could not start SDK, invalid keyPublic');
  }
  // After the 1.x checks, so a config 1.0.9 rejected still gets 1.0.9's message;
  // the origin refusal (audit 1.2) is new and comes last.
  const origin = resolveFrameOrigin(params);

  const report = (error: AucoError): void => {
    // `events` is required by the types, but a JS caller can leave it out.
    if (!events?.onSDKError) {
      console.error(error);
      return;
    }
    settle(() => events.onSDKError?.(error)).catch((failure: unknown) => {
      console.error(error, failure);
    });
  };
  const run = (name: string, callback: () => unknown): void => {
    settle(callback).catch((cause: unknown) => {
      report(
        cause instanceof AucoError
          ? cause
          : new AucoHandlerError('handler-rejected', `${name} failed`, {
              cause,
            })
      );
    });
  };

  // The previous session releases the iframe (src about:blank) before this
  // one points it at the frame again.
  sessions.get(iframe)?.destroy();
  const session = createSession({
    iframe,
    product: sdkType,
    origin,
    language,
    data: sdkData,
    auth: {
      publicKey: keyPublic,
      // Always given, even without onSDKToken: embed would otherwise answer
      // with publicKey as the token, which 1.0.9 never does.
      getToken: async () => {
        if (!events.onSDKToken) {
          throw new AucoTokenError(
            'token-unavailable',
            "Could not get token, SDK is asking for user token, but there isn't a onSDKToken function provided"
          );
        }
        return events.onSDKToken();
      },
    },
    parentUrl: 'href',
    // 1.x waits for the frame and the token backend indefinitely, so neither
    // times out. One deliberate difference: a token that resolves after a
    // terminal close is dropped (the session is over); 1.0.9 still posted it.
    handshakeTimeoutMs: 0,
    tokenTimeoutMs: 0,
  });
  sessions.set(iframe, session);

  session.addEventListener('error', ({ detail }) => {
    report(detail.error);
  });
  session.addEventListener('ready', () => {
    run('onSDKReady', () => events.onSDKReady());
  });
  // Callbacks get the raw payload, not the validated one: 1.0.9 forwards
  // whatever the frame sent.
  session.addEventListener('pay', ({ detail }) => {
    run('onSDKPay', () => {
      if (!events.onSDKPay) {
        throw new AucoError(
          'missing-handler',
          "SDK is asking for payment, but there isn't a onSDKPay function provided"
        );
      }
      return events.onSDKPay(detail.raw.data);
    });
  });
  session.addEventListener('notification', ({ detail }) => {
    run('onSDKNotification', () => events.onSDKNotification?.(detail.raw.data));
  });
  // A pending or rejected callback holds the session open, as 1.0.9 kept its
  // listener until the await settled, and never once it rejected.
  session.addEventListener('close', ({ detail }) => {
    const { raw } = detail;
    detail.waitUntil(
      settle(() =>
        events.onSDKClose(
          raw.document ?? raw.similarity ?? '',
          raw.redirectTo ?? raw.status ?? '',
          raw.signProfile ?? []
        )
      )
    );
  });
  session.addEventListener('finish', ({ detail }) => {
    detail.waitUntil(settle(() => events.onSDKFinish?.()));
  });
  session.addEventListener('back', ({ detail }) => {
    detail.waitUntil(settle(() => events.onSDKBack?.()));
  });
  return session;
};
