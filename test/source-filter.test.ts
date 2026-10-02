/**
 * @jest-environment jsdom
 */
import { AucoSDK } from '../src';

const SIGN_ORIGIN = 'https://sign.auco.ai';

const mountIframe = (id: string) => {
  const iframe = document.createElement('iframe');
  iframe.id = id;
  document.body.appendChild(iframe);
  return iframe;
};

const startSign = (iframeId: string) => {
  const events = { onSDKReady: jest.fn(), onSDKClose: jest.fn() };
  const unsubscribe = AucoSDK({
    sdkType: 'sign',
    env: 'PROD',
    iframeId,
    language: 'es',
    events,
    sdkData: {
      document: 'DOC0000000AA',
      uxOptions: { primaryColor: '#021c30', alternateColor: '#a557f2' },
    },
  });
  return { events, unsubscribe };
};

const sendClose = (source: Window | null) => {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: SIGN_ORIGIN,
      data: { type: 'SDK-CLOSE', redirectTo: 'https://example.com/listo' },
      source,
    })
  );
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('messages are accepted only from the SDK iframe', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('handles a message from its own iframe', async () => {
    const own = mountIframe('own');
    const { events, unsubscribe } = startSign('own');

    sendClose(own.contentWindow);
    await flush();

    expect(events.onSDKClose).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('ignores a message from another iframe of the same origin', async () => {
    mountIframe('own');
    const other = mountIframe('other');
    const { events, unsubscribe } = startSign('own');

    sendClose(other.contentWindow);
    await flush();

    expect(events.onSDKClose).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps two SDK instances on the same origin apart', async () => {
    const first = mountIframe('first');
    mountIframe('second');
    const a = startSign('first');
    const b = startSign('second');

    sendClose(first.contentWindow);
    await flush();

    expect(a.events.onSDKClose).toHaveBeenCalledTimes(1);
    expect(b.events.onSDKClose).not.toHaveBeenCalled();
    a.unsubscribe();
    b.unsubscribe();
  });
});
