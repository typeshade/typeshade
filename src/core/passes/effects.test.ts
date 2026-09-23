// The effect table (passes/effects.ts) and the optimizer's use of it (#47). The one arm that
// matters most is the fixpoint's: it optimizes each function in a module holding that function
// alone, so without the table riding along, `store(gid.x);` in `main_k` was a call to a
// function the pass could not see, taken for pure, and dropped. Measured before the fix: the
// emitted `main_k` body was empty.

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import {
  SYNC_WRITE,
  bodyHasEffectfulCall,
  exprHasEffect,
  fnReads,
  fnWrites,
  inheritEffects,
} from './effects.js';
import { fixpoint, optimizeAt } from './opt/optimize.js';
import { dce } from './opt/dce.js';
import { cse } from './opt/cse.js';
import { licm } from './opt/licm.js';
import { cseLocal } from './opt/cse-local.js';
import { gvn } from './opt/gvn.js';
import { emitModule, emitModuleAt } from '../backends/wgsl.js';
import { compileModule } from '../oracle.js';
import type { ModuleDecl } from '../ir/nodes.js';

const SRC = `"use typeshade";
declare let dst: storage<array<f32>>;
function pure(x: f32): f32 {
  return x * 2.;
}
function store(i: u32): void {
  dst[i] = 1.;
}
function viaStore(i: u32): f32 {
  store(i);
  return 3.;
}
@compute([64, 1, 1])
export function main_k(@builtin("global_invocation_id") gid: vec3u): void {
  viaStore(gid.x);
  pure(1.);
}
`;

const bodyOf = (m: ModuleDecl, name: string) => m.funcs.find((f) => f.name === name)!.body;

describe('the effect table', () => {
  it('names the binding each function writes, through the functions it calls', () => {
    const m = compile(SRC).module;
    const w = fnWrites(m);
    expect([...w.get('pure')!]).toEqual([]);
    expect([...w.get('store')!]).toEqual(['dst']);
    expect([...w.get('viaStore')!]).toEqual(['dst']);
    expect([...w.get('main_k')!]).toEqual(['dst']);
  });

  it('tells an effectful call from a pure one', () => {
    const m = compile(SRC).module;
    const w = fnWrites(m);
    const [viaStore, pure] = bodyOf(m, 'main_k');
    expect(viaStore!.s).toBe('call');
    expect(pure!.s).toBe('call');
    if (viaStore!.s !== 'call' || pure!.s !== 'call')
      throw new Error('expected two call statements');
    expect(exprHasEffect(viaStore!.expr, w)).toBe(true);
    expect(exprHasEffect(pure!.expr, w)).toBe(false);
    expect(bodyHasEffectfulCall(bodyOf(m, 'main_k'), w)).toBe(true);
    expect(bodyHasEffectfulCall(bodyOf(m, 'pure'), w)).toBe(false);
  });

  it('is handed to a view of the module and not recomputed from it', () => {
    const m = compile(SRC).module;
    const table = fnWrites(m);
    const view: ModuleDecl = { ...m, funcs: [m.funcs.find((f) => f.name === 'main_k')!] };
    inheritEffects(m, view);
    expect(fnWrites(view)).toBe(table);
    // A view nobody handed the table to computes its own, and from one function it can only
    // see the call, not the callee: this is the mistake the hand-over exists to prevent.
    const orphan: ModuleDecl = { ...m, funcs: [m.funcs.find((f) => f.name === 'main_k')!] };
    expect([...fnWrites(orphan).get('main_k')!]).toEqual([]);
  });
});

describe('the optimizer with the effect table', () => {
  it('dce keeps the effectful call statement and drops the pure one', () => {
    const m = compile(SRC).module;
    const out = bodyOf(dce(m), 'main_k');
    expect(out).toHaveLength(1);
    expect(out[0]!.s === 'call' && out[0]!.expr.op === 'call' && out[0]!.expr.fn).toBe('viaStore');
  });

  it('the per-function fixpoint still sees what a helper writes', () => {
    const m = compile(SRC).module;
    for (const out of [fixpoint(m), optimizeAt(m, 'O2'), optimizeAt(m, 'O1')]) {
      const body = bodyOf(out, 'main_k');
      expect(body).toHaveLength(1);
      expect(body[0]!.s === 'call' && body[0]!.expr.op === 'call' && body[0]!.expr.fn).toBe(
        'viaStore',
      );
    }
  });
});

// ═══ The read table (`fnReads`) ═══
//
// A call's value depends on what its callee reads of the module as well as on its arguments.
// cse, licm and gvn saw only the arguments, so `h(x * 2.)` with `h` returning `q * gp` was one
// value on both sides of a `gp = 5.`. Measured before the table: at O1 — documented as
// value-identical to O0 — f(3) below returned 12 where O0 returns 36; the loop returned 18 for
// 36 at O2.
const READS = `"use typeshade";
declare const buf: storage<array<f32>>;
let gp: f32 = 1.;
const K: f32 = 2.;
function h(q: f32): f32 {
  return q * gp;
}
function viaH(q: f32): f32 {
  return h(q) + K;
}
function load(i: u32): f32 {
  return buf[i];
}
function pure(q: f32): f32 {
  let t = q * 3.;
  return t;
}
`;
const FS = `
@fragment
export function fs(): vec4 {
  return vec4(f(3.), 0., 0., 1.)
}
`;

describe('the read table', () => {
  it('names the module names each function reads, through the functions it calls', () => {
    const r = compile(READS + 'export function f(x: f32): f32 {\n  return viaH(x)\n}' + FS);
    expect(r.diagnostics).toEqual([]);
    const reads = fnReads(r.module);
    expect([...reads.get('h')!]).toEqual(['gp']);
    expect([...reads.get('viaH')!].sort()).toEqual(['K', 'gp']);
    expect([...reads.get('load')!]).toEqual(['buf']);
    expect([...reads.get('pure')!]).toEqual([]); // a parameter and a local are its own
    expect([...reads.get('f')!].sort()).toEqual(['K', 'gp']);
  });

  it('is handed to a view of the module with the write table', () => {
    const m = compile(READS + 'export function f(x: f32): f32 {\n  return viaH(x)\n}' + FS).module;
    const table = fnReads(m);
    const view: ModuleDecl = { ...m, funcs: [m.funcs.find((f) => f.name === 'f')!] };
    inheritEffects(m, view);
    expect(fnReads(view)).toBe(table);
  });

  const agree = (src: string, passes: Record<string, (m: ModuleDecl) => ModuleDecl>): void => {
    const r = compile(READS + src + FS);
    expect(r.diagnostics).toEqual([]);
    const m = r.module;
    const o0 = compileModule(m).fns['f']!;
    for (const [name, pass] of Object.entries(passes)) {
      // A fresh module object each time: the tables are cached per object, and a pass run
      // earlier on `m` must not hand the next one a table it would not have computed.
      const g = compileModule(pass({ ...m })).fns['f']!;
      for (const x of [3, -1, 0.5]) expect(g(x), `${name} x=${x}`).toEqual(o0(x));
    }
  };

  it('cse does not bind a helper call once across a write to what the helper reads', () => {
    const src = `export function f(x: f32): f32 {
  let a = h(x * 2.)
  gp = 5.
  let c = h(x * 2.)
  return a + c
}`;
    expect(compileModule(compile(READS + src + FS).module).fns['f']!(3)).toBe(36); // 6 + 30
    agree(src, { cse, O1: (m) => optimizeAt(m, 'O1'), O2: (m) => optimizeAt(m, 'O2') });
    // The same through a helper that calls the reader, and a zero-argument one.
    agree(
      `export function f(x: f32): f32 {
  let a = viaH(x)
  gp = 5.
  return a + viaH(x)
}`,
      { cse, O1: (m) => optimizeAt(m, 'O1') },
    );
  });

  it('licm does not lift a helper call out of a loop that writes what the helper reads', () => {
    const src = `export function f(x: f32): f32 {
  let r = 0.
  for (let i = 0; i < 3; i++) {
    r = r + h(x * 2.)
    gp = gp + 1.
  }
  return r
}`;
    expect(compileModule(compile(READS + src + FS).module).fns['f']!(3)).toBe(36); // 6 + 12 + 18
    agree(src, { licm, O2: (m) => optimizeAt(m, 'O2') });
  });

  it('cse-local takes the repeat within one statement that cse now refuses', () => {
    // cse-local is cse's complement: it numbers what cse will not bind at the top. A call to
    // `h` in a function that writes `gp` is now one of those, and two of them inside one
    // statement are one value (nothing runs between them), so cse-local binds it.
    const src = `export function f(x: f32): f32 {
  let r = h(x) + h(x) * 3.
  gp = 5.
  return r + h(x)
}`;
    const m = compile(READS + src + FS).module;
    const w = emitModuleAt(cseLocal(cse(m)), 'O0');
    expect(w.slice(w.indexOf('fn f('))).toContain('let _lc0 = h(x);');
    agree(src, { cseLocal: (mod) => cseLocal(cse(mod)), O1: (mod) => optimizeAt(mod, 'O1') });
  });

  it('a helper that reads only what nothing writes is still one value', () => {
    // The table narrows nothing it should not: `pure` reads no module name, so its two calls
    // are the input-only repeat cse has always bound once.
    const r = compile(
      READS +
        `export function f(x: f32): f32 {
  let a = pure(x * 2.)
  gp = 5.
  let c = pure(x * 2.)
  return a + c
}` +
        FS,
    );
    const f = cse(r.module).funcs.find((g) => g.name === 'f')!;
    expect(f.body[0]!.s === 'let' && f.body[0]!.name).toBe('_cse0');
  });
});

// ═══ Synchronisation: barriers and workgroupUniformLoad ═══
//
// `workgroupUniformLoad` carries a barrier on each side of its read (wgsl.txt:26057), and a
// barrier writes no location of its own, so neither was an effect to the table. Measured
// before: gvn bound `workgroupUniformLoad(&flag) + y` once before the loop below, which left
// the loop body with no barrier between its `tile` writes and the neighbour reads; cse did the
// same to `ld()` wrapping one; and O2 emitted `k` with no call to `sync()`, the helper holding
// the kernel's only `workgroupBarrier()`.
const WG = `"use typeshade";
declare let out: storage<array<f32>>;
let flag: workgroup<f32>;
let tile: workgroup<array<f32, 8>>;
function ld(): f32 {
  return workgroupUniformLoad(flag);
}
function sync(): void {
  workgroupBarrier();
}
`;
const loopBody = (w: string, fn: string): string => {
  const k = w.slice(w.indexOf(`fn ${fn}(`));
  return k.slice(k.indexOf('for ('));
};

describe('synchronisation is an effect', () => {
  it('workgroupUniformLoad is effectful, and so is a helper that calls one or a barrier', () => {
    const m = compile(
      WG + '@compute([4, 1, 1])\nexport function k(): void {\n  sync()\n}\n',
    ).module;
    const w = fnWrites(m);
    expect([...w.get('ld')!]).toEqual([SYNC_WRITE]);
    expect([...w.get('sync')!]).toEqual([SYNC_WRITE]);
    expect([...w.get('k')!]).toEqual([SYNC_WRITE]);
  });

  it('a workgroupUniformLoad in a loop body is not replaced by the one before the loop', () => {
    for (const read of ['workgroupUniformLoad(flag)', 'ld()']) {
      const r = compile(`${WG}
@compute([4, 1, 1])
export function k(@builtin("local_invocation_id") lid: vec3u): void {
  let y: f32 = 0.
  y = y + 1.
  if (lid.x === u32(0)) {
    flag = 1.
  }
  let a = ${read} + y
  for (let i = 0; i < 2; i++) {
    tile[u32(i) * u32(4) + lid.x] = f32(lid.x) + 10.
    let b = ${read} + y
    out[lid.x * u32(2) + u32(i)] = tile[u32(i) * u32(4) + (lid.x + u32(1)) % u32(4)] + b + a
  }
}
`);
      expect(r.diagnostics, read).toEqual([]);
      const call = read === 'ld()' ? 'ld()' : 'workgroupUniformLoad(&flag)';
      for (const out of [gvn(r.module), cse(r.module), optimizeAt(r.module, 'O2')]) {
        const body = loopBody(emitModule(out), 'k');
        expect(body.split(call).length - 1, `${read}\n${body}`).toBe(1);
      }
    }
  });

  it('O2 keeps a helper that holds the barrier, and dispatch still sees the neighbour', () => {
    const src = `${WG}
@compute([4, 1, 1])
export function k(@builtin("local_invocation_id") lid: vec3u): void {
  tile[lid.x] = f32(lid.x) + 1.
  sync()
  out[lid.x] = tile[(lid.x + u32(1)) % u32(4)]
}
`;
    const m = compile(src).module;
    const o2 = optimizeAt(m, 'O2');
    expect(emitModule(o2)).toContain('  sync();');
    const run = (mod: ModuleDecl): number[] => {
      const out = [0, 0, 0, 0];
      const cm = compileModule(mod);
      cm.setBinding('out', out);
      cm.dispatch('k', 1);
      return out;
    };
    expect(run(m)).toEqual([2, 3, 4, 1]);
    expect(run(o2)).toEqual([2, 3, 4, 1]);
  });

  it('dce keeps an unread binding whose initialiser has an effect', () => {
    const m = compile(`"use typeshade";
declare let cnt: storage<atomic<u32>>;
declare let out: storage<array<u32>>;
let flag: workgroup<f32>;
@compute([4, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  let old = atomicAdd(cnt, u32(1));
  let w = workgroupUniformLoad(flag);
  let unused = gid.x * u32(3);
  out[gid.x] = gid.x;
}
`).module;
    const w = emitModule(dce(m));
    expect(w).toContain('atomicAdd(&cnt, 1u)');
    expect(w).toContain('workgroupUniformLoad(&flag)');
    expect(w).not.toContain('unused'); // a pure initialiser is still dead
    expect(emitModule(optimizeAt(m, 'O2'))).toContain('atomicAdd(&cnt, 1u)');
  });
});
