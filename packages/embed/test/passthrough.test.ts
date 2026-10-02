import { describe, expect, it } from 'vitest';
import { adoptedFrame, fromFrame, optionsFor, record, start } from './support';

const readySession = () => {
  const frame = adoptedFrame();
  const session = start(optionsFor(frame));
  fromFrame(frame, { ready: true });
  return { frame, session };
};

// pay, notification and anything unrecognized carry no lifecycle meaning: the
// session hands the parsed message to the integrator and stays where it was.
describe('pass-through frame messages', () => {
  const pay = { code: 'DOC0000000AA', epaycoKey: 'k' };
  const notification = { message: 'Mensaje', options: {} };
  const cases = [
    {
      type: 'pay',
      raw: { type: 'SDK-PAY', data: pay },
      detail: (raw: object) => ({ kind: 'pay', data: pay, raw }),
    },
    {
      type: 'notification',
      raw: { type: 'SDK-NOTIFICATION', data: notification },
      detail: (raw: object) => ({
        kind: 'notification',
        data: notification,
        raw,
      }),
    },
    {
      type: 'unknown',
      raw: { type: 'SDK-OTHER', document: 'DOC0000000AA' },
      detail: (raw: object) => ({ kind: 'unknown', raw }),
    },
  ];

  it.each(cases)(
    'emits $type with the parsed message as detail and nothing else',
    ({ type, raw, detail }) => {
      const { frame, session } = readySession();
      const log = record(session);
      fromFrame(frame, raw);
      expect(log).toEqual([{ type, detail: detail(raw) }]);
      expect(session.state).toBe('ready');
    }
  );

  it.each(cases)(
    'the $type detail carries the received data itself as raw',
    (entry) => {
      const { frame, session } = readySession();
      const log = record(session);
      fromFrame(frame, entry.raw);
      const detail = log[0]?.detail as { raw: unknown } | undefined;
      expect(detail?.raw).toBe(entry.raw);
    }
  );

  it('emits unknown for a message that is not an object', () => {
    const { frame, session } = readySession();
    const log = record(session);
    fromFrame(frame, 'SDK-PAY');
    expect(log).toEqual([
      { type: 'unknown', detail: { kind: 'unknown', raw: 'SDK-PAY' } },
    ]);
  });

  it('emits a pass-through message that arrives before ready', () => {
    const frame = adoptedFrame();
    const session = start(optionsFor(frame));
    const log = record(session);
    fromFrame(frame, { type: 'SDK-NOTIFICATION', data: notification });
    expect(log.map((entry) => entry.type)).toEqual(['notification']);
    expect(session.state).toBe('loading');
  });
});
