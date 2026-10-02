import { Window as HappyWindow } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import {
  adoptedFrame,
  deliver,
  detach,
  fakeContentWindow,
  fromFrame,
  names,
  ORIGIN,
  optionsFor,
  record,
  start,
} from './support';

// Audit 1.1: 1.0.9 only checked event.origin, so every same-origin window,
// including another Auco iframe on the page, drove the session.
describe('frame message filter', () => {
  it('ignores a message from the frame window on another origin', () => {
    const frame = adoptedFrame();
    const session = start(optionsFor(frame));
    const log = record(session);
    deliver({ ready: true }, frame.window, 'https://evil.example.com');
    expect(session.state).toBe('loading');
    expect(frame.posts).toEqual([]);
    expect(log).toEqual([]);
  });

  it('ignores a same-origin message from a window that is not the frame', () => {
    const frame = adoptedFrame();
    const session = start(optionsFor(frame));
    const log = record(session);
    const foreign = { postMessage() {} } as unknown as Window;
    deliver({ ready: true }, foreign, ORIGIN);
    deliver({ type: 'SDK-CLOSE' }, foreign, ORIGIN);
    expect(session.state).toBe('loading');
    expect(log).toEqual([]);
  });

  it('ignores a message with a null source even when the iframe has no contentWindow', () => {
    const frame = adoptedFrame();
    detach(frame.iframe);
    const session = start(optionsFor(frame));
    const log = record(session);
    deliver({ ready: true }, null, ORIGIN);
    expect(session.state).toBe('loading');
    expect(log).toEqual([]);
  });

  it('a ready from one session frame never reaches another on the same origin', () => {
    const a = adoptedFrame();
    const b = adoptedFrame();
    const sessionA = start(optionsFor(a));
    const sessionB = start(optionsFor(b));
    const logB = record(sessionB);
    fromFrame(a, { ready: true });
    expect(sessionA.state).toBe('ready');
    expect(a.posts).toHaveLength(1);
    expect(sessionB.state).toBe('loading');
    expect(b.posts).toEqual([]);
    expect(logB).toEqual([]);
  });

  it('a close from one session frame leaves the other open', () => {
    const a = adoptedFrame();
    const b = adoptedFrame();
    const sessionA = start(optionsFor(a));
    const sessionB = start(optionsFor(b));
    fromFrame(a, { ready: true });
    fromFrame(b, { ready: true });
    const logA = record(sessionA);
    fromFrame(b, { type: 'SDK-CLOSE' });
    expect(sessionB.state).toBe('closed');
    expect(sessionA.state).toBe('ready');
    expect(names(logA)).toEqual([]);
  });
});

describe('known defects', () => {
  // DEFECT (src/session.ts): the iframe is created with
  // container.ownerDocument, but the message listener is attached to the
  // module's global `window`, not container.ownerDocument.defaultView. A
  // container in another same-origin document (a popup, a same-origin child
  // frame) gets an iframe whose messages go to that document's window, so the
  // session never hears ready and can only time out.
  it.fails('a container in another document hears its frame', async () => {
    const popup = new HappyWindow({
      url: 'http://localhost:3000/popup',
      settings: { navigation: { disableChildFrameNavigation: true } },
    });
    try {
      const container = popup.document.createElement('div');
      popup.document.body.append(container);
      const session = start({
        product: 'sign',
        origin: ORIGIN,
        container: container as unknown as HTMLElement,
        language: 'es',
        data: {},
        handshakeTimeoutMs: 0,
      });
      const frame = fakeContentWindow(session.iframe);
      popup.dispatchEvent(
        new popup.MessageEvent('message', {
          data: { ready: true },
          origin: ORIGIN,
          source: frame.window as never,
        })
      );
      expect(session.state).toBe('ready');
    } finally {
      await popup.happyDOM.close();
    }
  });
});
