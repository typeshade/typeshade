import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { dispatchCompute } from '../debug/dispatch.js';
import { runGlModel } from '../testing/gl-model.js';
import type { CpuValue } from '../cpu-runtime.js';
import { f32T, type ModuleDecl, type Stmt } from '../ir/index.js';
import { lowerMemoryWords, referenced } from './memory-words.js';
import { splitPhases } from './phase-split.js';
import { autoVars } from './opt/index.js';

type Bindings = Record<string, CpuValue>;

const moduleOf = (src: string): ModuleDecl => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module;
};

const planOf = (src: string, entry: string) =>
  lowerMemoryWords(splitPhases(autoVars(moduleOf(src)), entry));

function both(src: string, entry: string, make: () => Bindings) {
  const m = moduleOf(src);
  const oracle = make();
  dispatchCompute(m, entry, 1, oracle, { precision: 'f32' });
  const model = make();
  runGlModel(m, entry, 1, model);
  return { oracle, model };
}

describe('memory words: what the pass leaves of a module', () => {
  const twoEntries = `"use typeshade";
declare const mine: storage<array<f32>, "read_write">;
declare const theirs: storage<array<f32>, "read_write">;
declare const unused: storage<array<f32>, "read_write">;
function neverCalled(i: u32): void { unused[i] = 1.; }
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  mine[gid.x] = 2.;
}
@compute([4, 1, 1]) export function other(gid: builtin<"global_invocation_id">): void {
  theirs[gid.x] = 3.;
}
`;

  it('gives a root only to memory the entry reaches', () => {
    const plan = planOf(twoEntries, 'main');
    expect(plan.roots.map((r) => r.name)).toEqual(['mine']);
  });

  it('keeps no function the entry does not call', () => {
    const plan = planOf(twoEntries, 'main');
    expect(plan.module.funcs.map((f) => f.name)).not.toContain('neverCalled');
  });

  it('gives a root to a binding that only an atomic cut names', () => {
    const src = `"use typeshade";
declare const counter: storage<atomic<u32>, "read_write">;
declare const out: storage<array<u32>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  out[gid.x] = atomicAdd(counter, 1);
}
`;
    const plan = planOf(src, 'main');
    expect(plan.roots.map((r) => r.name)).toContain('counter');
    const counter = plan.roots.findIndex((r) => r.name === 'counter');
    expect([...plan.requests.values()].map((q) => q.root)).toEqual([counter]);
  });

  it('does not name a binding that a local of the function hides', () => {
    const src = `"use typeshade";
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  const offsets = array<f32, 4>(1., 2., 3., 4.);
  const samples = offsets.map((o) => xs[gid.x] * o);
  out[gid.x] = samples.reduce((a, s) => a + s, 0.);
}
`;
    const helper = splitPhases(autoVars(moduleOf(src)), 'main').module.funcs.find((f) =>
      f.name.startsWith('array_map'),
    )!;
    expect(JSON.stringify(helper.body)).toContain('"name":"out"');
    expect([...referenced([helper])]).toEqual(['xs']);
  });

  it('lowers no memory access in a helper whose local has the name of a binding', () => {
    const src = `"use typeshade";
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  const offsets = array<f32, 4>(1., 2., 3., 4.);
  const samples = offsets.map((o) => xs[gid.x] * o);
  out[gid.x] = samples.reduce((a, s) => a + s, 0.);
}
`;
    const plan = planOf(src, 'main');
    const helpers = plan.module.funcs.filter((f) => f.name !== 'main');
    expect(helpers.length).toBeGreaterThan(0);
    for (const h of helpers) {
      expect(JSON.stringify(h.body)).not.toContain('"_phStore"');
    }
  });

  it('does not lower the length of a local that has the name of a runtime-sized binding', () => {
    const src = `"use typeshade";
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
function len(): u32 { return xs.length; }
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  out[gid.x] = f32(xs.length) + f32(len());
}
`;
    const m = moduleOf(src);
    const localXs: Stmt = {
      s: 'var',
      name: 'xs',
      type: { kind: 'array', elem: f32T, size: 4 },
    };
    const patched: ModuleDecl = {
      ...m,
      funcs: m.funcs.map((f) => (f.name === 'len' ? { ...f, body: [localXs, ...f.body] } : f)),
    };
    const plan = lowerMemoryWords(splitPhases(autoVars(patched), 'main'));
    const len = plan.module.funcs.find((f) => f.name === 'len')!;
    expect(plan.roots.map((r) => r.name)).toContain('xs');
    expect(JSON.stringify(len.body)).toContain('"fn":"arrayLength"');
    expect(JSON.stringify(len.body)).not.toContain('_phx_len_xs');
    const main = plan.module.funcs.find((f) => f.name === 'main')!;
    expect(JSON.stringify(main.body)).toContain('_phx_len_xs');
  });

  it('declares the length of a runtime-sized array that the entry reads', () => {
    const src = `"use typeshade";
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  out[gid.x] = f32(xs.length);
}
`;
    const plan = planOf(src, 'main');
    expect(plan.module.vars?.map((v) => v.name)).toContain('_phx_len_xs');
    expect(JSON.stringify(plan.module.funcs)).not.toContain('"arrayLength"');
  });
});

describe('memory words: the extent of a root', () => {
  const extents = (decl: string, use: string, name: string) => {
    const src = `"use typeshade";
class Tail { n: u32; vals: array<f32>; }
${decl}
declare const out: storage<array<f32>, "read_write">;
@compute([1, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  out[gid.x] = ${use};
}
`;
    const root = planOf(src, 'main').roots.find((r) => r.name === name)!;
    return { fixed: root.fixed, stride: root.stride };
  };

  it('takes the stride of a vec3 element as four words', () => {
    const r = extents('declare const vs: storage<array<vec3f>>;', 'vs[gid.x].x', 'vs');
    expect(r).toEqual({ fixed: 0, stride: 4 });
  });

  it('takes the whole size of a fixed array as its fixed words', () => {
    const r = extents('declare const fs: storage<array<f32, 8>>;', 'fs[gid.x]', 'fs');
    expect(r).toEqual({ fixed: 8, stride: 0 });
  });

  it('takes the words before a trailing runtime array as fixed, and its element as stride', () => {
    const r = extents('declare const t: storage<Tail>;', 't.vals[gid.x]', 't');
    expect(r).toEqual({ fixed: 1, stride: 1 });
  });
});

describe('memory words: a lowered entry leaves the memory the oracle leaves', () => {
  it('reads a swizzle of a memory vector lane by lane', () => {
    const src = `"use typeshade";
declare const vs: storage<array<vec3f>, "read_write">;
declare const out: storage<array<vec2f>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  out[gid.x] = vs[gid.x].zx;
}
`;
    const r = both(src, 'main', () => ({
      vs: Array.from({ length: 4 }, (_, i) => [i, i + 10, i + 20]) as unknown as CpuValue,
      out: Array.from({ length: 4 }, () => [0, 0]) as unknown as CpuValue,
    }));
    expect(r.model).toEqual(r.oracle);
    expect(r.model.out).toEqual([
      [20, 0],
      [21, 1],
      [22, 2],
      [23, 3],
    ]);
  });

  it('reads a swizzle of a memory f64 vector lane by lane', () => {
    const src = `"use typeshade";
declare const vs: storage<array<vec3f64>, "read_write">;
declare const out: storage<array<vec2f64>, "read_write">;
@compute([2, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  out[gid.x] = vs[gid.x].zx;
}
`;
    const r = both(src, 'main', () => ({
      vs: Array.from({ length: 2 }, (_, i) => [i + 0.5, i + 10.5, i + 20.5]) as unknown as CpuValue,
      out: Array.from({ length: 2 }, () => [0, 0]) as unknown as CpuValue,
    }));
    expect(r.model).toEqual(r.oracle);
    expect(r.model.out).toEqual([
      [20.5, 0.5],
      [21.5, 1.5],
    ]);
  });

  it('stores an f64 as the nearest f32 and the residual of the stored bits', () => {
    const src = `"use typeshade";
declare const ds: storage<array<f64>, "read_write">;
declare const out: storage<array<f32>, "read_write">;
@compute([1, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  ds[gid.x] = f64(1.) + f64(0.000000007450580596923828125);
  storageBarrier();
  out[gid.x] = f32((ds[gid.x] - f64(1.)) * f64(134217728.));
}
`;
    const r = both(src, 'main', () => ({ ds: [0], out: [0] }));
    expect(r.model).toEqual(r.oracle);
    expect(r.model.out).toEqual([1]);
  });

  it('copies in and out a memory place passed to an inout parameter', () => {
    const src = `"use typeshade";
class P { x: f32; y: f32; }
declare const ps: storage<array<P>, "read_write">;
function bump(p: P): void { p.x += 1.; }
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  bump(ps[gid.x]);
}
`;
    const r = both(src, 'main', () => ({
      ps: Array.from({ length: 4 }, (_, i) => ({ x: i, y: -i })) as unknown as CpuValue,
    }));
    expect(r.model).toEqual(r.oracle);
    expect(r.model.ps).toEqual(Array.from({ length: 4 }, (_, i) => ({ x: i + 1, y: -i })));
  });

  it('reads the indices of a place once, before its stores', () => {
    const src = `"use typeshade";
class Q { a: u32; b: u32; }
declare const qs: storage<array<Q>, "read_write">;
@compute([1, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  qs[qs[0].a] = { a: 2, b: 9 };
}
`;
    const make = (): Bindings => ({
      qs: Array.from({ length: 4 }, () => ({ a: 0, b: 0 })) as unknown as CpuValue,
    });
    const r = both(src, 'main', make);
    expect(r.model).toEqual(r.oracle);
    expect(r.model.qs).toEqual([
      { a: 2, b: 9 },
      { a: 0, b: 0 },
      { a: 0, b: 0 },
      { a: 0, b: 0 },
    ]);
  });
  it('reads the length of a runtime-sized array inside the index of a load', () => {
    const src = `"use typeshade";
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
@compute([8, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  out[gid.x] = xs[(gid.x + 3) % xs.length];
}
`;
    expect(planOf(src, 'main').module.vars?.map((v) => v.name)).toContain('_phx_len_xs');
    const r = both(src, 'main', () => ({
      xs: [10, 11, 12, 13, 14],
      out: new Array<number>(8).fill(0),
    }));
    expect(r.model).toEqual(r.oracle);
    expect(r.model.out).toEqual([13, 14, 10, 11, 12, 13, 14, 10]);
  });

  it('reads memory in the index of a local array it writes', () => {
    const src = `"use typeshade";
declare const xs: storage<array<u32>>;
declare const out: storage<array<f32>, "read_write">;
@compute([1, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  const a = array<f32, 4>(0., 0., 0., 0.);
  a[xs[gid.x] % 4] = 5.;
  out[gid.x] = a[1] + a[3];
}
`;
    const r = both(src, 'main', () => ({ xs: [3, 0, 0, 0], out: [0] }));
    expect(r.model).toEqual(r.oracle);
    expect(r.model.out).toEqual([5]);
    expect(JSON.stringify(planOf(src, 'main').module.funcs)).toContain('"_phLoad"');
  });
});
