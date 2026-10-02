import { TAucoSDK, Config, SDKTypeObjectKeys, SDKs, EnvType } from './types';
function uuid() {
  const d = new Date();
  const s = d.toISOString().replaceAll(':', '-');
  return s;
}
export const AucoSDK: TAucoSDK = params => {
  parametersValidation(params);
  const messageFunc = setupEvents(params);
  const unsuscribe = () => {
    window.removeEventListener('message', messageFunc);
  };
  return unsuscribe;
};

const parametersValidation = (params: Config) => {
  if (!params.iframeId) {
    throw new Error('Could not start SDK, iframeId is missing');
  }
  if (!['es', 'en'].includes(params?.language)) {
    throw new Error(
      "Could not start SDK, language is missing or invalid, available options are 'es' and 'en' "
    );
  }
  if (params.sdkType === 'upload' || params.sdkType === 'attachments') {
    if (params.sdkData.custom) {
      if (
        typeof params.sdkData.custom !== 'object' ||
        Array.isArray(params.sdkData.custom)
      )
        throw new Error(
          'Could not start SDK, custom data must be an object, received: ' +
            (Array.isArray(params.sdkData.custom)
              ? 'array'
              : typeof params.sdkData.custom)
        );
      else if (!Object.keys(params.sdkData.custom).length)
        throw new Error(
          'Could not start SDK, custom data is empty, received: ' +
            JSON.stringify(params.sdkData.custom)
        );
    }
  }
};
const setupEvents = (params: Config) => {
  const {
    iframeId,
    events,
    language,
    sdkData,
    keyPublic = undefined,
    customOrigin,
    sdkType,
    env,
  } = params;

  const origin = resolveOrigin(sdkType, env, keyPublic, customOrigin);

  const iframe = document.getElementById(iframeId) as HTMLIFrameElement;

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

  async function onMessage(event: MessageEvent) {
    // The origin alone is not enough: two SDK iframes on the same origin (two
    // `sign`, or `upload` + `read` on upload.auco.ai) would hear each other.
    if (event.origin !== origin || event.source !== iframe.contentWindow)
      return;
    if (event.data.ready) {
      iframe!.contentWindow?.postMessage(
        {
          language,
          ...sdkData,
          keyPublic,
          sdkParentURL: window.location.href,
          ...getExtraConstants(sdkType),
        },
        origin
      );
      await events.onSDKReady();
      return;
    }
    if (event.data?.type?.includes('token')) {
      if (!events.onSDKToken) {
        throw new Error(
          "Could not get token, SDK is asking for user token, but there isn't a onSDKToken function provided"
        );
      }
      const token = await events.onSDKToken();
      iframe!.contentWindow?.postMessage({ type: 'token', token }, origin);
    }
    if (event.data?.type === 'SDK-PAY') {
      if (!events.onSDKPay) {
        throw new Error(
          "SDK is asking for payment, but there isn't a onSDKPay function provided"
        );
      }
      await events.onSDKPay(event.data.data);
    }
    if (event.data?.type === 'SDK-NOTIFICATION') {
      if (events.onSDKNotification) {
        await events.onSDKNotification(event.data.data);
      }
    }
    if (event.data?.type === 'SDK-CLOSE') {
      await events.onSDKClose(
        event.data?.document ?? event.data?.similarity ?? '',
        event.data?.redirectTo ?? event.data?.status ?? '',
        event.data?.signProfile ?? []
      );
      if (event.data?.status !== 'PENDING')
        window.removeEventListener('message', onMessage);
    }

    if (event.data?.type === 'SDK-FINISH') {
      if (events.onSDKFinish) {
        await events.onSDKFinish();
        window.removeEventListener('message', onMessage);
      }
    }

    if (event.data?.type === 'SDK-BACK') {
      if (events.onSDKBack) {
        await events.onSDKBack();
        window.removeEventListener('message', onMessage);
      }
    }
  }
  window.addEventListener('message', onMessage);
  iframe.src = origin + '?id=' + uuid();
  return onMessage;
};
const getSDKURL: SDKTypeObjectKeys = {
  'upload-v2': 'https://uploadv2.auco.ai',
  upload: 'https://upload.auco.ai',
  sign: 'https://sign.auco.ai',
  attachments: 'https://upload.auco.ai',
  read: 'https://upload.auco.ai',
  'validation-attachments': 'https://upload.auco.ai',
  validation: 'https://veriface.auco.ai',
  'list-validation': '',
  fill: 'https://fill2.auco.ai',
};

const getDevSDKURL: SDKTypeObjectKeys = {
  'upload-v2': 'https://uploadv2-stage.auco.ai',
  upload: 'https://upload-stage.auco.ai',
  sign: 'https://sign-stage.auco.ai',
  attachments: 'https://upload-stage.auco.ai',
  read: 'https://upload-stage.auco.ai',
  'validation-attachments': 'https://upload-stage.auco.ai',
  validation: 'https://veriface-stage.auco.ai',
  'list-validation': '',
  fill: 'https://fill2-stage.auco.ai',
};

const internalSDKDevURL: SDKTypeObjectKeys = {
  'upload-v2': 'https://uploadv2-dev.auco.ai',
  validation: 'https://veriface-dev.auco.ai',
  sign: 'https://sign-dev.auco.ai',
  upload: 'https://upload-dev.auco.ai',
  attachments: 'https://upload-dev.auco.ai',
  read: 'https://upload-dev.auco.ai',
  'validation-attachments': 'https://upload-dev.auco.ai',
  'list-validation': '',
  fill: 'https://fill2-stage.auco.ai',
};

const resolveOrigin = (
  sdkType: SDKs,
  env: EnvType,
  keyPublic?: string,
  customOrigin?: string
) => {
  if (customOrigin && customOrigin.length > 0) return customOrigin;
  /**
   * No keyPublic means the caller is an Auco app authenticating through
   * onSDKToken, and the dev environment is only reachable by those callers.
   * External consumers asking for DEV or STAGE land on stage instead.
   */
  if (env === 'DEV' && !keyPublic) return internalSDKDevURL[sdkType];
  if (env === 'DEV' || env === 'STAGE') return getDevSDKURL[sdkType];
  return getSDKURL[sdkType];
};

const flowTypesUploadSDK = {
  upload: 'upload',
  read: 'read',
  attachments: 'attachments',
  'validation-attachments': 'validation-attachments',
};
const getExtraConstants = (type: SDKs) => {
  let extraConstants = new Map();
  if (Object.keys(flowTypesUploadSDK).includes(type)) {
    extraConstants.set('flowType', type);
  }
  return Object.fromEntries(extraConstants);
};
