import { describe, expect, it } from 'vitest';
import { f32T } from '../ir/index.js';
import { lit, ref, entryModule } from '../testing/ir-shorthand.js';
import { moduleOf, steppedResult } from '../testing/stepped-run.js';
import { startDebugSession } from './session.js';

const SOURCE = `"use typeshade";
function reverseBits(x: u32): u32 { return x + 1; }
function firstLeadingBit(x: i32): i32 { return x + 100; }
function transpose(m: mat2x2): f32 { return m[1].y + 1000.; }
function atomicAdd(a: f32, b: f32): f32 { return a + b + 10000.; }
export function viaReverse(x: u32): u32 { return reverseBits(x); }
export function viaLeading(x: i32): i32 { return firstLeadingBit(x); }
export function viaTranspose(m: mat2x2): f32 { return transpose(m); }
export function viaAtomic(a: f32): f32 { return atomicAdd(a, 1.); }
`;

describe('a stepped call that the front end resolved to a declared function', () => {
  it('runs the declared body before any builtin of the same name (Rule 9.5)', () => {
    expect(steppedResult(SOURCE, 'viaReverse', [5])).toBe(6);
    expect(steppedResult(SOURCE, 'viaLeading', [5])).toBe(105);
    expect(steppedResult(SOURCE, 'viaTranspose', [[1, 2, 3, 4]])).toBe(1004);
    expect(steppedResult(SOURCE, 'viaAtomic', [2])).toBe(10003);
  });
});

const NESTED = `"use typeshade";
export function f(a: f32): f32 {
  let r = 0.;
  for (let i = 0; i < 2; i++) {
    const inLoop = vec3(1., 2., 3.);
    r += inLoop.x;
  }
  switch (i32(a)) {
    case 1: {
      const inCase = vec4(1., 2., 3., 4.);
      r += inCase.x;
      break;
    }
    default: {
      r += 5.;
    }
  }
  return r;
}
`;

describe('the declared type of every name a frame can hold', () => {
  it('reaches a local of a for body and of a switch clause before either runs', () => {
    const s = startDebugSession(moduleOf(NESTED), 'f', [1]);
    const types = s.pause!.frames[0]!.localTypes;
    expect(types.get('inLoop')).toEqual({ kind: 'vec', n: 3, elem: 'f32' });
    expect(types.get('inCase')).toEqual({ kind: 'vec', n: 4, elem: 'f32' });
    expect(types.get('i')).toEqual({ kind: 'scalar', scalar: 'i32' });
  });
});

describe('an assignment to a name a local shadows', () => {
  it('writes the local, not the module variable of that name', () => {
    const m = {
      ...entryModule([
        { s: 'var', name: 'g', type: f32T, init: lit(5) },
        { s: 'assign', target: ref('g'), expr: lit(7) },
        { s: 'return', expr: ref('g') },
      ]),
      vars: [{ name: 'g', space: 'private' as const, type: f32T, init: lit(1) }],
    };
    const session = startDebugSession(m, 'fs', [0]);
    session.continue();
    expect(session.result).toBe(7);
  });
});

const COUNTED = `"use typeshade";
declare const bins: storage<array<atomic<u32>>, "read_write">;
function pick(): u32 { return 1; }
@compute([1, 1, 1]) export function c(gid: builtin<"global_invocation_id">): void {
  atomicAdd(bins[pick()], 1);
}
`;

describe('an atomic operation on an element', () => {
  it('evaluates the index once', () => {
    const bins: number[] = [0, 0];
    const s = startDebugSession(moduleOf(COUNTED), 'c', [[0, 0, 0]], { bindings: { bins } });
    const names: string[] = [];
    while (s.pause) {
      names.push(s.pause.frames[0]!.fnName);
      s.stepIn();
    }
    expect(names.filter((n) => n === 'pick')).toHaveLength(1);
    expect(bins).toEqual([0, 1]);
  });
});

describe('a kernel function whose reduction loop runs no iteration', () => {
  it('leaves the reduced variable as it was', () => {
    const source = `"use typeshade";
export function total(xs: array<f32>): f32 {
  let s = 10.;
  for (const x of xs) {
    s += x;
  }
  return s;
}
`;
    expect(steppedResult(source, 'total', [[]])).toBe(10);
    expect(steppedResult(source, 'total', [[1, 2]])).toBe(13);
  });
});
