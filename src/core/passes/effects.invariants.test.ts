import { describe, expect, it } from 'vitest';
import { bothTake } from '../testing/both-halves.js';
import {
  EFFECTFUL_INTRINSICS,
  atomicWriteRoot,
  bodyHasEffectfulCall,
  calleeWritesOf,
  callReadsAny,
  callWrites,
  exprHasEffect,
  exprWrites,
  fnReads,
  fnWrites,
  inheritEffects,
} from './effects.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import type { Expr, ModuleDecl, Stmt } from '../ir/index.js';

const moduleOf = (src: string): ModuleDecl => bothTake(src).result.module;
const funcOf = (m: ModuleDecl, name: string) => m.funcs.find((f) => f.name === name)!;
const callOf = (m: ModuleDecl, fn: string, index = 0): Expr & { op: 'call' } => {
  const s = funcOf(m, fn).body[index] as Stmt & { s: 'call' };
  return s.expr as Expr & { op: 'call' };
};

const varref = (name: string): Expr => ({ op: 'varref', name }) as unknown as Expr;
const index = (base: Expr): Expr => ({ op: 'index', base }) as unknown as Expr;
const call = (fn: string, args: Expr[], declRef?: unknown): Expr =>
  ({ op: 'call', fn, args, declRef }) as unknown as Expr;

describe('EFFECTFUL_INTRINSICS', () => {
  it('lists the atomics, the barriers, the texture store, push and the collections', () => {
    for (const name of [
      'atomicAdd',
      'atomicLoad',
      'atomicStore',
      'workgroupBarrier',
      'storageBarrier',
      'workgroupUniformLoad',
      'textureStore',
      'push',
      'pushCount',
      'collectionAdd',
      'collectionSet',
      'collectionHas',
      'collectionGet',
      'collectionSize',
    ])
      expect(EFFECTFUL_INTRINSICS.has(name), name).toBe(true);
    expect(EFFECTFUL_INTRINSICS.has('sin')).toBe(false);
  });
});

describe('atomicWriteRoot', () => {
  it('names the root of the location a write intrinsic takes first', () => {
    for (const fn of [
      'atomicAdd',
      'atomicStore',
      'textureStore',
      'push',
      'collectionAdd',
      'collectionSet',
    ])
      expect(atomicWriteRoot(call(fn, [index(index(varref('b')))])), fn).toBe('b');
  });

  it('names nothing for a read, for a user function of that name, or for no location', () => {
    for (const fn of [
      'atomicLoad',
      'pushCount',
      'collectionHas',
      'collectionGet',
      'collectionSize',
    ])
      expect(atomicWriteRoot(call(fn, [varref('b')])), fn).toBeUndefined();
    expect(atomicWriteRoot(call('atomicAdd', [varref('b')], {}))).toBeUndefined();
    expect(atomicWriteRoot(call('push', [varref('b')], {}))).toBeUndefined();
    expect(atomicWriteRoot(call('atomicAdd', []))).toBeUndefined();
    expect(atomicWriteRoot(call('push', []))).toBeUndefined();
    expect(atomicWriteRoot(call('atomicAdd', [call('f', [])]))).toBeUndefined();
  });
});

const WRITES = `"use typeshade";
declare const dst: storage<array<f32>, "read_write">;
declare const bins: storage<array<atomic<u32>>, "read_write">;
let gp: f32 = 0.;
let gq: f32 = 0.;
let gr: f32 = 0.;
function inElse(i: u32, c: bool): void {
  if (c) {
    gr = 1.;
  } else {
    dst[i] = 1.;
  }
}
function inSwitch(i: u32): void {
  switch (i) {
    case 0:
      dst[i] = 1.;
      break;
    default:
      gr = 2.;
  }
}
function inForInit(): void {
  for (gp = 0.; gr < 2.; gr = gr + 1.) {
    gr = gr + 0.;
  }
}
function inForUpdate(): void {
  for (let j = 0; j < 2; gq = gq + 1.) {
    j = j + 1;
  }
}
function byValue(x: f32): f32 {
  x = x + 1.;
  return x;
}
function localAssign(): void {
  let t = 1.;
  t = 2.;
}
function inBranch(i: u32, c: bool): void {
  if (c) {
    dst[i] = 1.;
  }
}
function inLoop(i: u32): void {
  for (let j = 0; j < 2; j++) {
    atomicAdd(bins[i], u32(1));
  }
}
function callsInBranch(i: u32, c: bool): void {
  if (c) {
    inBranch(i, c);
  }
}
function callsInLoop(i: u32): void {
  for (let j = 0; j < 2; j++) {
    inLoop(i);
  }
}
@compute([4, 1, 1]) export function k(gid: builtin<"global_invocation_id">): void {
  callsInBranch(gid.x, true);
  callsInLoop(gid.x);
}
`;

describe('fnWrites', () => {
  it('does not count a write to a by-value parameter or a local', () => {
    const w = fnWrites(moduleOf(WRITES));
    expect([...w.get('byValue')!]).toEqual([]);
    expect([...w.get('localAssign')!]).toEqual([]);
  });

  it('finds a write in an else branch, a switch case, a hoisted for initializer and a for update', () => {
    const w = fnWrites(moduleOf(WRITES));
    expect([...w.get('inElse')!].sort()).toEqual(['dst', 'gr']);
    expect([...w.get('inSwitch')!].sort()).toEqual(['dst', 'gr']);
    expect([...w.get('inForInit')!].sort()).toEqual(['gp', 'gr']);
    expect([...w.get('inForUpdate')!]).toEqual(['gq']);
  });

  it('finds a write that the initializer of a for statement of the IR makes', () => {
    const m = moduleOf(WRITES);
    const source = funcOf(m, 'inForInit');
    const loop = source.body.find((s) => s.s === 'for') as Stmt & { s: 'for' };
    const assign = source.body.find((s) => s.s === 'assign') as Stmt;
    const rewritten = { ...source, name: 'initWrites', body: [{ ...loop, init: assign }] };
    const w = fnWrites({ ...m, funcs: [...m.funcs, rewritten] });
    expect(w.get('initWrites')!.has('gp')).toBe(true);
  });

  it('finds a write inside a branch or a loop, and carries a call there to the caller', () => {
    const w = fnWrites(moduleOf(WRITES));
    expect([...w.get('inBranch')!]).toEqual(['dst']);
    expect([...w.get('inLoop')!]).toEqual(['bins']);
    expect([...w.get('callsInBranch')!]).toEqual(['dst']);
    expect([...w.get('callsInLoop')!]).toEqual(['bins']);
    expect([...w.get('k')!].sort()).toEqual(['bins', 'dst']);
  });

  it('is computed once for a module object and again for another', () => {
    const m = moduleOf(WRITES);
    expect(fnWrites(m)).toBe(fnWrites(m));
    expect(fnWrites({ ...m })).not.toBe(fnWrites(m));
  });

  it('keeps the table of a view that already has its own', () => {
    const m = moduleOf(WRITES);
    const view: ModuleDecl = { ...m, funcs: [funcOf(m, 'k')] };
    const own = fnWrites(view);
    fnWrites(m);
    inheritEffects(m, view);
    expect(fnWrites(view)).toBe(own);
  });
});

const RECEIVER = `"use typeshade";
class P {
  v: f32;
  bump(d: f32): void {
    this.v = this.v + d;
  }
}
declare const dst: storage<array<f32>, "read_write">;
declare const bins: storage<array<atomic<u32>>, "read_write">;
function store(i: u32): void {
  dst[i] = 1.;
}
@compute([4, 1, 1]) export function k(): void {
  let p = new P();
  p.bump(0.25);
  store(u32(0));
  atomicAdd(bins[0], u32(1));
  atomicLoad(bins[0]);
}
`;

describe('what a call writes, in its caller words', () => {
  const m = moduleOf(RECEIVER);
  const w = fnWrites(m);
  it('names the receiver for a method, the binding for a helper, the location for an atomic', () => {
    expect([...callWrites(callOf(m, 'k', 1), w)]).toEqual(['p']);
    expect([...callWrites(callOf(m, 'k', 2), w)]).toEqual(['dst']);
    expect([...callWrites(callOf(m, 'k', 3), w)]).toEqual(['bins']);
    expect([...callWrites(callOf(m, 'k', 4), w)]).toEqual([]);
  });

  it('adds the receiver and not the callee word to the names a statement writes', () => {
    const out = new Set<string>();
    calleeWritesOf(funcOf(m, 'k').body[1]!, w, out);
    expect([...out]).toEqual(['p']);
  });

  it('counts a write as a write and a read or a fence as an effect only', () => {
    expect(exprWrites(callOf(m, 'k', 1), w)).toBe(true);
    expect(exprWrites(callOf(m, 'k', 2), w)).toBe(true);
    expect(exprWrites(callOf(m, 'k', 3), w)).toBe(true);
    expect(exprWrites(callOf(m, 'k', 4), w)).toBe(false);
    expect(exprHasEffect(callOf(m, 'k', 4), w)).toBe(true);
    expect(bodyHasEffectfulCall([funcOf(m, 'k').body[4]!], w)).toBe(true);
  });
});

describe('a callee that writes its receiver', () => {
  const OWNED = `"use typeshade";
class P {
  v: f32;
  bump(d: f32): void {
    this.v = this.v + d;
  }
}
function ownsLocal(): void {
  let p = new P();
  p.bump(0.25);
}
function viaParam(q: P): void {
  q.bump(0.25);
}
@compute([1, 1, 1]) export function k(): void {
  ownsLocal();
}
`;

  it('drops a receiver the caller owns as a local from what the caller writes', () => {
    const m = moduleOf(OWNED);
    const w = fnWrites(m);
    expect([...w.get('ownsLocal')!]).toEqual([]);
    expect([...w.get('viaParam')!]).toEqual(['q']);
    expect([...w.get('k')!]).toEqual([]);
    expect(exprHasEffect(callOf(m, 'ownsLocal', 1), w)).toBe(true);
  });
});

const BARRIER = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([4, 1, 1]) export function k(lid: builtin<"local_invocation_id">): void {
  workgroupBarrier();
  out[lid.x] = 1.;
}
`;

describe('a barrier', () => {
  it('has an effect and writes no location', () => {
    const m = moduleOf(BARRIER);
    const w = fnWrites(m);
    expect(exprHasEffect(callOf(m, 'k', 0), w)).toBe(true);
    expect(exprWrites(callOf(m, 'k', 0), w)).toBe(false);
  });
});

const READS = `"use typeshade";
let gp: f32 = 1.;
const K: f32 = 2.;
class P {
  v: f32;
  bump(d: f32): void {
    this.v = this.v + d + gp;
  }
}
function h(q: f32): f32 {
  return q * gp;
}
function usesConst(): f32 {
  return K;
}
function pure(q: f32): f32 {
  return q;
}
function viaMethod(): f32 {
  let p = new P();
  p.bump(1.);
  return p.v;
}
@fragment export function fs(): vec4 {
  return vec4(h(1.) + pure(gp), usesConst(), viaMethod(), 1.);
}
`;

describe('the read table beyond a call', () => {
  const m = moduleOf(READS);
  const reads = fnReads(m);

  it('counts a module constant, and a read through the receiver of the callee', () => {
    expect([...reads.get('usesConst')!]).toEqual(['K']);
    expect([...reads.get('P_bump')!]).toEqual(['gp']);
    expect([...reads.get('viaMethod')!]).toEqual(['gp']);
  });

  it('reads every module name for a function with a raw statement', () => {
    const rawFn = { ...funcOf(m, 'pure'), name: 'rawFn', body: [{ s: 'raw', wgsl: 'x' } as Stmt] };
    const withRaw: ModuleDecl = { ...m, funcs: [...m.funcs, rawFn] };
    const names = [...fnReads(withRaw).get('rawFn')!].sort();
    expect(names).toEqual(expect.arrayContaining(['gp']));
    expect(names.length).toBeGreaterThan([...fnReads(withRaw).get('pure')!].length);
  });

  it('asks whether a callee reads a name and ignores the arguments', () => {
    const gpSet = new Set(['gp']);
    const calls: Expr[] = [];
    for (const st of funcOf(m, 'fs').body)
      eachStmtExpr(st, (e) =>
        eachExpr(e, (x) => {
          if (x.op === 'call') calls.push(x);
        }),
      );
    const named = (fn: string) => calls.find((c) => c.op === 'call' && c.fn === fn)!;
    expect(callReadsAny(named('h'), gpSet, reads)).toBe(true);
    expect(callReadsAny(named('pure'), gpSet, reads)).toBe(false);
    expect(callReadsAny(named('h'), new Set(), reads)).toBe(false);
    expect(callReadsAny(named('h'), gpSet, undefined)).toBe(false);
    expect(callReadsAny(varref('gp'), gpSet, reads)).toBe(false);
  });
});
