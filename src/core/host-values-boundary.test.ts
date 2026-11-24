import { describe, it, expect } from 'vitest';
import {
  arity,
  callMember,
  constantOf,
  fromShader,
  fromShaderIn,
  notCallable,
  toShader,
  type HostType,
  type MemberSpec,
} from './host-values.js';
import type { CpuValue } from './cpu-runtime.js';

const f32: HostType = { k: 'num', t: 'f32', s: 'f32' };
const vec2: HostType = { k: 'vec', n: 2, e: 'f32', s: 'vec2' };
const key: HostType = { k: 'key', m: ['r', 'g', 'b'], s: "'r' | 'g' | 'b'" };
const point: HostType = {
  k: 'struct',
  f: [
    ['x', f32],
    ['v', vec2],
  ],
  s: 'Point',
};
const points: HostType = { k: 'arr', n: 2, e: point, s: 'array<Point, 2>' };
const rec: HostType = { k: 'rec', m: ['r', 'g'], e: f32, s: 'Record<Key, f32>' };
const cpu = (v: unknown): CpuValue => v as CpuValue;

describe('the host-value boundary, each part on its own', () => {
  it('rounds an f32 argument as a buffer write rounds it', () => {
    expect(toShader('f', 'x', f32, 0.1)).toBe(Math.fround(0.1));
    expect(toShader('f', 'x', { k: 'num', t: 'f64', s: 'f64' }, 0.1)).toBe(0.1);
    const two: HostType = { k: 'arr', n: 1, e: f32, s: 'array<f32, 1>' };
    expect(toShader('f', 'x', two, [0.1])).toEqual([Math.fround(0.1)]);
  });

  it('a key is its index in id order, and a result is the member at that index', () => {
    expect(toShader('f', 'c', key, 'b')).toBe(2);
    expect(fromShader(key, cpu(1))).toBe('g');
    expect(() => toShader('f', 'c', key, 'x')).toThrow(
      new TypeError(
        `f(): parameter "c" ('r' | 'g' | 'b'): got the string "x", which is not one of 'r' | 'g' | 'b'.`,
      ),
    );
  });

  it('a Record is an array of its values in id order, and refuses a missing or an extra key', () => {
    expect(toShader('f', 'r', rec, { g: 2, r: 1 })).toEqual([1, 2]);
    expect(fromShader(rec, cpu([1, 2]))).toEqual({ r: 1, g: 2 });
    expect(() => toShader('f', 'r', rec, { r: 1 })).toThrow(
      new TypeError('f(): parameter "r" (Record<Key, f32>): at .g, the key is missing.'),
    );
    expect(() => toShader('f', 'r', rec, { r: 1, g: 2, b: 3 })).toThrow(
      new TypeError('f(): parameter "r" (Record<Key, f32>): at .b, the key is none of "r" | "g".'),
    );
  });

  it('refuses void, and names where inside a struct an argument went wrong', () => {
    expect(() => toShader('f', 'p', { k: 'void', s: 'void' }, 1)).toThrow(
      new TypeError('f(): parameter "p" (void): void takes no value.'),
    );
    expect(() => toShader('f', 'p', point, { x: 1, v: [1, 'y'] })).toThrow(
      new TypeError('f(): parameter "p" (Point): at .v[1], got the string "y".'),
    );
  });

  it('a result aliases no argument and nothing the module keeps, at every level', () => {
    const inner = { x: 1, v: [2, 3] };
    const held = cpu([inner, { x: 4, v: [5, 6] }]);
    const out = fromShader(points, held) as { x: number; v: number[] }[];
    expect(out).toEqual([inner, { x: 4, v: [5, 6] }]);
    expect(out).not.toBe(held);
    expect(out[0]).not.toBe(inner);
    expect(out[0]!.v).not.toBe(inner.v);
    out[0]!.v[0] = 99;
    expect(inner.v[0]).toBe(2);
    const given = [
      { x: 1, v: [2, 3] },
      { x: 4, v: [5, 6] },
    ];
    const taken = toShader('f', 'p', points, given) as unknown as { v: number[] }[];
    expect(taken[0]).not.toBe(given[0]);
    expect(taken[0]!.v).not.toBe(given[0]!.v);
  });

  it('a constant is a copy, frozen at every level', () => {
    const held = cpu([
      { x: 1, v: [2, 3] },
      { x: 4, v: [5, 6] },
    ]);
    const c = constantOf(points, held) as { x: number; v: number[] }[];
    expect(c).toEqual(held);
    expect(c).not.toBe(held);
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c[0])).toBe(true);
    expect(Object.isFrozen(c[0]!.v)).toBe(true);
    expect(Object.isFrozen(c[1]!.v)).toBe(true);
    expect(constantOf(f32, cpu(2))).toBe(2);
  });

  it('a struct whose class is named is an instance of it, built without its constructor, at every level', () => {
    let built = 0;
    class Pt {
      constructor() {
        built++;
      }
    }
    const classes = new Map<string, object>([['Point', Pt.prototype]]);
    const held = cpu([
      { x: 1, v: [2, 3] },
      { x: 4, v: [5, 6] },
    ]);
    const out = fromShaderIn(points, held, classes) as Pt[];
    expect(out).toHaveLength(2);
    for (const p of out) {
      expect(p).toBeInstanceOf(Pt);
      expect(Object.keys(p)).toEqual(['x', 'v']);
    }
    expect(built).toBe(0);
    const plain = fromShaderIn(points, held, new Map()) as object[];
    expect(Object.getPrototypeOf(plain[0])).toBe(Object.prototype);
    expect(fromShaderIn(vec2, cpu([1, 2]), classes)).toEqual([1, 2]);
  });

  it('arity says argument in the singular for one and the plural otherwise', () => {
    expect(() => arity('f', 1, 2)).toThrow(new TypeError('f() takes 1 argument; got 2.'));
    expect(() => arity('f', 0, 1)).toThrow(new TypeError('f() takes 0 arguments; got 1.'));
    expect(() => arity('f', 2, 2)).not.toThrow();
  });

  it('a value with no host face refuses a call with its reason', () => {
    expect(() => notCallable('g', 'it is generic')()).toThrow(
      new TypeError('g cannot be called from host code: it is generic'),
    );
  });
});

describe('callMember', () => {
  const calls: string[] = [];
  const cpuTier = (inout: CpuValue[]) => ({
    F: {
      $initPrivates: () => cpu(void calls.push('init')),
      bump: (...a: CpuValue[]) => {
        calls.push(`bump ${JSON.stringify(a)}`);
        return cpu({ x: (a[0] as unknown as { x: number }).x + (a[1] as unknown as number) });
      },
    },
    $: { inout: { values: inout } },
  });
  const self: Record<string, unknown> = { x: 1 };
  const counter: HostType = { k: 'struct', f: [['x', f32]], s: 'Counter' };

  it('checks the instance, starts the privates over, runs the function, and writes the fields back', () => {
    calls.length = 0;
    const spec: MemberSpec = {
      n: 'Counter.bump',
      fn: 'bump',
      p: [['d', f32]],
      o: counter,
      w: 1,
      s: 1,
    };
    const back = cpu({ x: 5 });
    const r = callMember(cpuTier([back]), new Map(), spec, self, [4]);
    expect(r).toBe(self);
    expect(self['x']).toBe(5);
    expect(calls).toEqual(['init', 'bump [{"x":1},4]']);
  });

  it('refuses a wrong count first, and names this when the instance is wrong', () => {
    calls.length = 0;
    const spec: MemberSpec = { n: 'Counter.bump', fn: 'bump', p: [['d', f32]], o: counter };
    expect(() => callMember(cpuTier([]), new Map(), spec, self, [])).toThrow(
      new TypeError('Counter.bump() takes 1 argument; got 0.'),
    );
    expect(() => callMember(cpuTier([]), new Map(), spec, {}, [1])).toThrow(
      new TypeError('Counter.bump(): parameter "this" (Counter): at .x, the field is missing.'),
    );
    expect(calls).toEqual([]);
  });

  it('a constructor with no function writes the zero struct into the instance and returns nothing', () => {
    const target: Record<string, unknown> = {};
    const spec: MemberSpec = { n: 'new Counter', p: [], o: counter, c: 1, z: cpu({ x: 0 }) };
    expect(callMember(cpuTier([]), new Map(), spec, target, [])).toBeUndefined();
    expect(target).toEqual({ x: 0 });
  });

  it('a member that changes nothing returns its result as a host value', () => {
    const spec: MemberSpec = {
      n: 'Counter.bump',
      fn: 'bump',
      p: [['d', f32]],
      o: counter,
      r: counter,
    };
    const before = { x: 7 };
    const r = callMember(cpuTier([]), new Map(), spec, before, [1]);
    expect(r).toEqual({ x: 8 });
    expect(before.x).toBe(7);
  });
});
