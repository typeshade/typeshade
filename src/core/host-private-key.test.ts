// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { constantOf, fromShader, fromShaderIn, toShader, type HostType } from './host-values.js';
import { missingField, shaderField } from './host-key.js';
import { fromCpu, Misfit, pack, readInto, toCpu, type Layout } from './host-entry.js';
import type { CpuValue } from './cpu-runtime.js';

const u32: HostType = { k: 'num', t: 'u32', s: 'u32' };
const COUNTER: HostType = {
  k: 'struct',
  s: 'Counter',
  f: [
    ['#n', u32],
    ['step', u32],
  ],
};
const LAYOUT: Layout = {
  k: 'o',
  sz: 8,
  f: [
    ['#n', 0, { k: 's', t: 'u32' }],
    ['step', 4, { k: 's', t: 'u32' }],
  ],
};

const NO_KEY =
  'the field is missing. "#n" is a private name, which an instance holds and a plain object does not. Build the value with new';

describe('the key of a private name', () => {
  it('is the field of the struct with its # taken off, and any other key is its own field', () => {
    expect(shaderField('#n')).toBe('n');
    expect(shaderField('step')).toBe('step');
    expect(shaderField('#')).toBe('');
  });

  it('words the missing field of a private name with the reason, and any other as before', () => {
    expect(missingField('#n')).toBe(NO_KEY);
    expect(missingField('step')).toBe('the field is missing');
  });
});

describe('the conversions of host-values.ts hold the key on the host side and the field on the shader side', () => {
  it('toShader reads the key and writes the field', () => {
    expect(toShader('f', 'c', COUNTER, { '#n': 3, step: 1 })).toEqual({ n: 3, step: 1 });
    expect(
      toShader('f', 'c', COUNTER, Object.assign(Object.create({ n: 99 }), { '#n': 3, step: 1 })),
    ).toEqual({
      n: 3,
      step: 1,
    });
  });

  it('toShader refuses a plain object of the fields, which lacks the key, with the reason', () => {
    expect(() => toShader('f', 'c', COUNTER, { n: 3, step: 1 })).toThrow(
      new TypeError(`f(): parameter "c" (Counter): at .#n, ${NO_KEY}.`),
    );
    class Counter {
      step = 1;
      get n(): number {
        return 3;
      }
    }
    expect(() => toShader('f', 'c', COUNTER, new Counter())).toThrow(
      new TypeError(`f(): parameter "c" (Counter): at .#n, ${NO_KEY}.`),
    );
    expect(() => toShader('f', 'c', COUNTER, { '#n': 3 })).toThrow(
      new TypeError('f(): parameter "c" (Counter): at .step, the field is missing.'),
    );
  });

  it('fromShader reads the field and writes the key', () => {
    expect(fromShader(COUNTER, { n: 3, step: 1 } as unknown as CpuValue)).toEqual({
      '#n': 3,
      step: 1,
    });
  });

  it('constantOf is a frozen object of the keys', () => {
    const c = constantOf(COUNTER, { n: 3, step: 1 } as unknown as CpuValue) as Record<
      string,
      number
    >;
    expect(c).toEqual({ '#n': 3, step: 1 });
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('fromShaderIn writes the key as an own property, and the accessor of the prototype keeps its name', () => {
    class Counter {
      get n(): number {
        return -1;
      }
    }
    const built = fromShaderIn(
      COUNTER,
      { n: 3, step: 1 } as unknown as CpuValue,
      new Map([['Counter', Counter.prototype]]),
    ) as Counter & Record<string, number>;
    expect(built).toBeInstanceOf(Counter);
    expect(Object.keys(built)).toEqual(['#n', 'step']);
    expect(built['#n']).toBe(3);
    expect(Object.getOwnPropertyNames(built)).not.toContain('n');
    expect(built.n).toBe(-1);
  });
});

describe('the conversions of host-entry.ts hold the key on the host side and the field on the CPU side', () => {
  it('pack reads the key', () => {
    const dv = new DataView(new ArrayBuffer(8));
    pack(dv, 0, LAYOUT, { '#n': 7, step: 2 }, '');
    expect([dv.getUint32(0, true), dv.getUint32(4, true)]).toEqual([7, 2]);
  });

  it('pack refuses a plain object of the fields, which lacks the key, with the reason', () => {
    const dv = new DataView(new ArrayBuffer(8));
    let refused: unknown;
    try {
      pack(dv, 0, LAYOUT, { n: 7, step: 2 }, '');
    } catch (e) {
      refused = e;
    }
    expect(refused).toBeInstanceOf(Misfit);
    expect(refused).toMatchObject({ path: '.#n', problem: NO_KEY });
  });

  it('readInto writes the key of the caller’s object in place, and no other', () => {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(0, 9, true);
    dv.setUint32(4, 4, true);
    const target = { '#n': 0, step: 0 };
    expect(readInto(dv, 0, LAYOUT, target)).toBe(target);
    expect(target).toEqual({ '#n': 9, step: 4 });
  });

  it('toCpu reads the key and writes the field', () => {
    expect(toCpu(LAYOUT, { '#n': 7, step: 2 }, false)).toEqual({ n: 7, step: 2 });
  });

  it('fromCpu reads the field and writes the key of the caller’s object in place', () => {
    const target = { '#n': 0, step: 0 };
    expect(fromCpu(LAYOUT, { n: 9, step: 4 } as unknown as CpuValue, target, false)).toBe(target);
    expect(target).toEqual({ '#n': 9, step: 4 });
  });

  it('a layout with no private name behaves as it did', () => {
    const plain: Layout = {
      k: 'o',
      sz: 8,
      f: [
        ['n', 0, { k: 's', t: 'u32' }],
        ['step', 4, { k: 's', t: 'u32' }],
      ],
    };
    const dv = new DataView(new ArrayBuffer(8));
    pack(dv, 0, plain, { n: 7, step: 2 }, '');
    expect(toCpu(plain, { n: 7, step: 2 }, false)).toEqual({ n: 7, step: 2 });
    const target = { n: 0, step: 0 };
    expect(readInto(dv, 0, plain, target)).toEqual({ n: 7, step: 2 });
    expect(() => pack(dv, 0, plain, { step: 2 }, '')).toThrowError(Misfit);
  });
});
