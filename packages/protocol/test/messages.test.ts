import { describe, expect, it } from 'vitest';
import {
  buildHostInit,
  buildHostToken,
  type FlowType,
  flowTypeFor,
  type Language,
  PRODUCTS,
  type Product,
  parseFrameMessage,
} from '../src/index';
import { fixture, fixtures } from './fixtures';

const frameFixtures = fixtures.filter((f) => f.id.startsWith('frame.'));
const hostInitFixtures = fixtures.filter((f) => f.id === 'host.init');

describe('fixtures', () => {
  it('include every frame and host.init fixture this suite replays', () => {
    expect(frameFixtures.length).toBeGreaterThanOrEqual(10);
    expect(hostInitFixtures.map((f) => f.variant)).toEqual(['sign', 'upload']);
  });

  it.each(frameFixtures)('$file parses to the kind of its id', (f) => {
    const message = parseFrameMessage(f.data);
    expect(message.kind).toBe(f.id.slice('frame.'.length));
    expect(message.raw).toBe(f.data);
  });
});

describe('buildHostInit', () => {
  // host.init fixtures are the message 1.0.9 posts: language, the spread
  // sdkData, keyPublic, sdkParentURL, then flowType. toStrictEqual ignores key
  // order, the serialized form does not.
  it.each(hostInitFixtures)('reproduces $file key for key, in order', (f) => {
    const { language, keyPublic, sdkParentURL, flowType, ...data } = f.data;
    const built = buildHostInit({
      language: language as Language,
      data,
      keyPublic: keyPublic as string,
      parentUrl: sdkParentURL as string,
      flowType: flowTypeFor(f.variant as Product),
    });
    expect(flowType).toBe(flowTypeFor(f.variant as Product));
    expect(JSON.stringify(built)).toBe(JSON.stringify(f.data));
  });

  it('keeps keyPublic as an own key when it is undefined', () => {
    const built = buildHostInit({
      language: 'en',
      data: { document: 'DOC0000000AA' },
      keyPublic: undefined,
      parentUrl: 'https://app.example.com',
    });
    expect(Object.hasOwn(built, 'keyPublic')).toBe(true);
    expect(built.keyPublic).toBeUndefined();
    expect(Object.keys(built)).toEqual([
      'language',
      'document',
      'keyPublic',
      'sdkParentURL',
    ]);
  });

  it('sends keyPublic null verbatim', () => {
    const built = buildHostInit({
      language: 'es',
      data: undefined,
      keyPublic: null,
      parentUrl: 'https://app.example.com',
    });
    expect(built.keyPublic).toBeNull();
  });

  it('omits flowType when none is given', () => {
    const built = buildHostInit({
      language: 'es',
      data: {},
      keyPublic: 'puk_00000000000000000000000000000000',
      parentUrl: 'https://app.example.com',
    });
    expect(Object.hasOwn(built, 'flowType')).toBe(false);
  });

  it('lets data override language but not keyPublic, sdkParentURL or flowType', () => {
    const built = buildHostInit({
      language: 'es',
      data: {
        language: 'en',
        keyPublic: 'from-data',
        sdkParentURL: 'from-data',
        flowType: 'from-data',
      },
      keyPublic: 'puk_00000000000000000000000000000000',
      parentUrl: 'https://app.example.com',
      flowType: 'read',
    });
    expect(built).toStrictEqual({
      language: 'en',
      keyPublic: 'puk_00000000000000000000000000000000',
      sdkParentURL: 'https://app.example.com',
      flowType: 'read',
    });
  });
});

describe('buildHostToken', () => {
  it('reproduces host.token key for key, in order', () => {
    const f = fixture('host.token');
    expect(JSON.stringify(buildHostToken(f.data.token as string))).toBe(
      JSON.stringify(f.data)
    );
  });
});

describe('flowTypeFor', () => {
  const expected: Record<Product, FlowType | undefined> = {
    upload: 'upload',
    'upload-v2': undefined,
    read: 'read',
    attachments: 'attachments',
    'validation-attachments': 'validation-attachments',
    validation: undefined,
    sign: undefined,
    'list-validation': undefined,
    fill: undefined,
  };

  it.each(PRODUCTS)('%s', (product) => {
    expect(flowTypeFor(product)).toBe(expected[product]);
  });
});
