import { describe, expect, it } from 'vitest';
import { type FrameMessage, parseFrameMessage } from '../src/index';

const boom = () => {
  throw new Error('hostile');
};

const close = (fields: Record<string, unknown>) => {
  const message = parseFrameMessage({ type: 'SDK-CLOSE', ...fields });
  if (message.kind !== 'close') throw new Error(`parsed as ${message.kind}`);
  return message;
};

describe('parseFrameMessage on hostile input', () => {
  // A same-origin window can post anything, and 1.0.9's listener threw on
  // several of these (PROTOCOL.md §1.4); the parser classifies them instead.
  const hostile: [string, () => unknown][] = [
    ['null', () => null],
    ['undefined', () => undefined],
    ['a number', () => 0],
    ['a string', () => 'token'],
    ['a boolean', () => true],
    ['an array', () => ['token']],
    ['type as a number', () => ({ type: 5 })],
    ['type as an object', () => ({ type: {} })],
    ['type as a boolean', () => ({ type: true })],
    [
      'a getter on ready that throws',
      () => Object.defineProperty({}, 'ready', { get: boom }),
    ],
    [
      'a getter on type that throws',
      () => Object.defineProperty({}, 'type', { get: boom }),
    ],
    [
      'a getter on data that throws behind SDK-PAY',
      () => Object.defineProperty({ type: 'SDK-PAY' }, 'data', { get: boom }),
    ],
    ['a Proxy whose every trap throws', () => new Proxy({}, { get: boom })],
    [
      'a Proxy that throws past the type check',
      () =>
        new Proxy(
          { type: 'SDK-CLOSE' },
          {
            get: (target, key) =>
              key === 'type' || key === 'ready'
                ? Reflect.get(target, key)
                : boom(),
          }
        ),
    ],
  ];

  it.each(hostile)('%s is unknown and kept as raw', (_, make) => {
    const data = make();
    let message: FrameMessage | undefined;
    expect(() => {
      message = parseFrameMessage(data);
    }).not.toThrow();
    expect(message?.kind).toBe('unknown');
    expect(message?.raw).toBe(data);
  });
});

describe('parseFrameMessage dispatch (PROTOCOL.md §1.4)', () => {
  it.each([
    [{ ready: 1, type: 'SDK-CLOSE' }, 'ready'],
    [{ ready: 0, type: 'SDK-BACK' }, 'back'],
    [{ type: 'get-token' }, 'token-request'],
    [{ type: ['other', 'token'] }, 'token-request'],
    [{ type: 'Token' }, 'unknown'],
    [{ type: ['tokens'] }, 'unknown'],
    [{ type: 'sdk-pay' }, 'unknown'],
    [{ type: ['SDK-PAY'] }, 'unknown'],
    [{ type: 'SDK-FINISH' }, 'finish'],
  ] as const)('%j is %s', (data, kind) => {
    expect(parseFrameMessage(data).kind).toBe(kind);
  });
});

describe('frame.pay data', () => {
  const pay = (data: unknown) => {
    const raw = { type: 'SDK-PAY', data };
    const message = parseFrameMessage(raw);
    if (message.kind !== 'pay') throw new Error(`parsed as ${message.kind}`);
    expect(message.raw).toBe(raw);
    return message.data;
  };

  it('is the data object when code and epaycoKey are strings', () => {
    const data = { code: 'DOC0000000AA', epaycoKey: 'k' };
    expect(pay(data)).toBe(data);
  });

  it.each([
    ['no code', { epaycoKey: 'k' }],
    ['a numeric code', { code: 1, epaycoKey: 'k' }],
    ['no epaycoKey', { code: 'DOC0000000AA' }],
    ['a numeric epaycoKey', { code: 'DOC0000000AA', epaycoKey: 1 }],
    ['null', null],
    ['a string', 'DOC0000000AA'],
  ])('reads undefined with %s', (_, data) => {
    expect(pay(data)).toBeUndefined();
  });
});

describe('frame.notification data', () => {
  const notification = (data: unknown) => {
    const raw = { type: 'SDK-NOTIFICATION', data };
    const message = parseFrameMessage(raw);
    if (message.kind !== 'notification') {
      throw new Error(`parsed as ${message.kind}`);
    }
    expect(message.raw).toBe(raw);
    return message.data;
  };

  it('is the data object when message is a string', () => {
    const data = { message: 'Mensaje', options: {} };
    expect(notification(data)).toBe(data);
  });

  it.each([
    ['a numeric message', { message: 1 }],
    ['no message', { options: {} }],
    ['null', null],
  ])('reads undefined with %s', (_, data) => {
    expect(notification(data)).toBeUndefined();
  });
});

describe('frame.close fields', () => {
  it('reads string fields as received', () => {
    expect(
      close({
        document: 'DOC0000000AA',
        redirectTo: 'https://www.example.com/fin',
        status: 'APPROVED',
      })
    ).toMatchObject({
      document: 'DOC0000000AA',
      redirectTo: 'https://www.example.com/fin',
      status: 'APPROVED',
    });
  });

  it.each([
    ['document', 1],
    ['redirectTo', {}],
    ['status', ['APPROVED']],
  ])('reads %s undefined when it is not a string', (field, value) => {
    const raw = { [field]: value };
    const message = close(raw);
    expect(message[field as 'document']).toBeUndefined();
    expect(message.raw[field]).toBe(value);
  });

  it.each([91.5, '91.5'])('keeps similarity %j', (similarity) => {
    expect(close({ similarity }).similarity).toBe(similarity);
  });

  it.each([true, {}, null])(
    'reads similarity %j as undefined',
    (similarity) => {
      const message = close({ similarity });
      expect(message.similarity).toBeUndefined();
      expect(message.raw.similarity).toBe(similarity);
    }
  );

  it('keeps signProfile when it is an array', () => {
    const signProfile = [{ id: 'AA' }];
    expect(close({ signProfile }).signProfile).toBe(signProfile);
  });

  it.each([{ id: 'AA' }, 'AA'])(
    'reads signProfile %j as undefined',
    (signProfile) => {
      const message = close({ signProfile });
      expect(message.signProfile).toBeUndefined();
      expect(message.raw.signProfile).toBe(signProfile);
    }
  );

  it('is non-terminal only for status PENDING', () => {
    expect(close({ status: 'PENDING' }).terminal).toBe(false);
    expect(close({ status: 'pending' }).terminal).toBe(true);
    expect(close({ status: 'APPROVED' }).terminal).toBe(true);
    expect(close({}).terminal).toBe(true);
  });
});
