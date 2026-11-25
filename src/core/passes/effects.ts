import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/index.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { ATOMIC_INTRINSICS, BARRIER_INTRINSICS, isAtomicIntrinsic } from '../intrinsics.js';
import { bodyHasRaw, collectLocals } from './opt/expr-utils.js';

export const EFFECTFUL_INTRINSICS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(ATOMIC_INTRINSICS),
  ...BARRIER_INTRINSICS,
  'workgroupUniformLoad',
  'textureStore',
  'push',
  'pushCount',
  'collectionAdd',
  'collectionSet',
  'collectionHas',
  'collectionGet',
  'collectionSize',
]);

const SYNC_INTRINSICS: ReadonlySet<string> = new Set<string>([
  ...BARRIER_INTRINSICS,
  'workgroupUniformLoad',
]);

export const SYNC_WRITE = '<workgroup sync>';

export type FnWrites = ReadonlyMap<string, ReadonlySet<string>>;

const memo = new WeakMap<ModuleDecl, FnWrites>();

const paramsOf = new WeakMap<FnWrites, ReadonlyMap<string, FuncDecl['params']>>();

const targetRoot = (e: Expr): Expr =>
  e.op === 'index' || e.op === 'member' ? targetRoot(e.base) : e;

export function atomicWriteRoot(x: Expr): string | undefined {
  if (x.op !== 'call' || x.declRef !== undefined) return undefined;
  if (
    x.fn === 'textureStore' ||
    x.fn === 'push' ||
    x.fn === 'collectionAdd' ||
    x.fn === 'collectionSet'
  ) {
    const target = x.args[0];
    if (target === undefined) return undefined;
    const root = targetRoot(target);
    return root.op === 'varref' || root.op === 'param' ? root.name : undefined;
  }
  if (!isAtomicIntrinsic(x.fn)) return undefined;
  if (x.fn === 'atomicLoad' || x.args[0] === undefined) return undefined;
  const root = targetRoot(x.args[0]);
  return root.op === 'varref' || root.op === 'param' ? root.name : undefined;
}

function directWrites(f: FuncDecl, out: Set<string>): void {
  const owned = new Set<string>(f.params.filter((p) => p.mode !== 'inout').map((p) => p.name));
  collectLocals(f.body, owned);
  const walk = (body: readonly Stmt[]): void => {
    for (const s of body) {
      eachStmtExpr(
        s,
        (e) => {
          eachExpr(e, (x) => {
            const root = atomicWriteRoot(x);
            if (root !== undefined && !owned.has(root)) out.add(root);
            if (x.op === 'call' && x.declRef === undefined && SYNC_INTRINSICS.has(x.fn))
              out.add(SYNC_WRITE);
          });
        },
        () => {},
      );
      if (s.s === 'assign' || s.s === 'assignOp') {
        const root = targetRoot(s.target);
        if ((root.op === 'varref' || root.op === 'param') && !owned.has(root.name))
          out.add(root.name);
      } else if (s.s === 'if') {
        for (const a of s.arms) walk(a.body);
        if (s.elseBody) walk(s.elseBody);
      } else if (s.s === 'for') {
        walk([s.init, s.update]);
        walk(s.body);
      } else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body);
        if (s.defaultBody) walk(s.defaultBody);
      }
    }
  };
  walk(f.body);
}

function inheritedWrites(
  call: Expr & { op: 'call' },
  callee: FuncDecl,
  calleeWrites: ReadonlySet<string>,
  ownedByCaller: ReadonlySet<string>,
  out: Set<string>,
): void {
  const throughParam = new Map<string, string | undefined>();
  for (const [i, p] of callee.params.entries()) {
    if (p.mode !== 'inout') continue;
    const arg = call.args[i];
    const root = arg === undefined ? undefined : targetRoot(arg);
    throughParam.set(
      p.name,
      root !== undefined && (root.op === 'varref' || root.op === 'param') ? root.name : undefined,
    );
  }
  for (const name of calleeWrites) {
    if (!throughParam.has(name)) {
      out.add(name);
      continue;
    }
    const here = throughParam.get(name);
    if (here !== undefined && !ownedByCaller.has(here)) out.add(here);
  }
}

function calleesOf(f: FuncDecl, declared: ReadonlySet<string>, out: Set<string>): void {
  for (const s of f.body) {
    eachStmtExpr(s, (e) => {
      eachExpr(e, (x) => {
        if (x.op === 'call' && (x.declRef !== undefined || declared.has(x.fn))) out.add(x.fn);
      });
    });
  }
}

export function inheritEffects(from: ModuleDecl, to: ModuleDecl): void {
  if (to === from) return;
  const table = memo.get(from);
  if (table !== undefined && !memo.has(to)) memo.set(to, table);
  const reads = readMemo.get(from);
  if (reads !== undefined && !readMemo.has(to)) readMemo.set(to, reads);
}

export type FnReads = ReadonlyMap<string, ReadonlySet<string>>;

const readMemo = new WeakMap<ModuleDecl, FnReads>();

export function fnReads(m: ModuleDecl): FnReads {
  const hit = readMemo.get(m);
  if (hit !== undefined) return hit;
  const declared = new Set(m.funcs.map((f) => f.name));
  const opaque = [
    ...m.bindings.map((b) => b.name),
    ...(m.vars ?? []).map((v) => v.name),
    ...(m.externs ?? []).map((v) => v.name),
  ];
  const reads = new Map<string, Set<string>>();
  const callees = new Map<string, Set<string>>();
  for (const f of m.funcs) {
    const owned = new Set<string>(f.params.map((p) => p.name));
    collectLocals(f.body, owned);
    const r = new Set<string>();
    for (const s of f.body)
      eachStmtExpr(s, (e) =>
        eachExpr(e, (x) => {
          if (
            (x.op === 'varref' || x.op === 'constref' || x.op === 'externref') &&
            !owned.has(x.name)
          )
            r.add(x.name);
        }),
      );
    if (bodyHasRaw(f.body)) for (const n of opaque) r.add(n);
    reads.set(f.name, r);
    const c = new Set<string>();
    calleesOf(f, declared, c);
    callees.set(f.name, c);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of m.funcs) {
      const r = reads.get(f.name)!;
      const before = r.size;
      for (const callee of callees.get(f.name)!) for (const n of reads.get(callee) ?? []) r.add(n);
      if (r.size !== before) changed = true;
    }
  }
  readMemo.set(m, reads);
  return reads;
}

export function callReadsAny(
  x: Expr,
  names: ReadonlySet<string>,
  reads: FnReads | undefined,
): boolean {
  if (x.op !== 'call' || reads === undefined || names.size === 0) return false;
  const r = reads.get(x.fn);
  if (r === undefined) return false;
  for (const n of r) if (names.has(n)) return true;
  return false;
}

export function fnWrites(m: ModuleDecl): FnWrites {
  const hit = memo.get(m);
  if (hit !== undefined) return hit;
  const declared = new Set(m.funcs.map((f) => f.name));
  const writes = new Map<string, Set<string>>();
  const callees = new Map<string, Set<string>>();
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  for (const f of m.funcs) {
    const w = new Set<string>();
    directWrites(f, w);
    writes.set(f.name, w);
    const c = new Set<string>();
    calleesOf(f, declared, c);
    callees.set(f.name, c);
  }
  const owned = new Map<string, Set<string>>();
  for (const f of m.funcs) {
    const o = new Set<string>(f.params.filter((p) => p.mode !== 'inout').map((p) => p.name));
    collectLocals(f.body, o);
    owned.set(f.name, o);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of m.funcs) {
      const w = writes.get(f.name)!;
      const before = w.size;
      for (const s of f.body) {
        eachStmtExpr(s, (e) => {
          eachExpr(e, (x) => {
            if (x.op !== 'call') return;
            const callee = byName.get(x.fn);
            if (callee === undefined) return;
            inheritedWrites(x, callee, writes.get(x.fn) ?? new Set(), owned.get(f.name)!, w);
          });
        });
      }
      for (const callee of callees.get(f.name)!) {
        const decl = byName.get(callee);
        const through = new Set(
          (decl?.params ?? []).filter((p) => p.mode === 'inout').map((p) => p.name),
        );
        for (const name of writes.get(callee) ?? []) {
          if (!through.has(name)) w.add(name);
        }
      }
      if (w.size !== before) changed = true;
    }
  }
  memo.set(m, writes);
  paramsOf.set(writes, new Map(m.funcs.map((f) => [f.name, f.params])));
  return writes;
}

export function callWrites(x: Expr & { op: 'call' }, writes: FnWrites): ReadonlySet<string> {
  const out = new Set<string>();
  const params = paramsOf.get(writes)?.get(x.fn);
  for (const name of writes.get(x.fn) ?? []) {
    const at = params?.findIndex((p) => p.mode === 'inout' && p.name === name) ?? -1;
    if (at < 0) {
      out.add(name);
      continue;
    }
    const arg = x.args[at];
    const root = arg === undefined ? undefined : targetRoot(arg);
    if (root !== undefined && (root.op === 'varref' || root.op === 'param')) out.add(root.name);
  }
  const root = atomicWriteRoot(x);
  if (root !== undefined) out.add(root);
  return out;
}

export function exprWrites(e: Expr, writes: FnWrites): boolean {
  let found = false;
  eachExpr(e, (x) => {
    if (found || x.op !== 'call') return;
    if ((writes.get(x.fn)?.size ?? 0) > 0 || atomicWriteRoot(x) !== undefined) found = true;
  });
  return found;
}

export function exprHasEffect(e: Expr, writes: FnWrites): boolean {
  let found = false;
  eachExpr(e, (x) => {
    if (x.op !== 'call') return;
    if (EFFECTFUL_INTRINSICS.has(x.fn)) found = true;
    const w = writes.get(x.fn);
    if (w !== undefined && w.size > 0) found = true;
  });
  return found;
}

export function bodyHasEffectfulCall(body: readonly Stmt[], writes: FnWrites): boolean {
  let found = false;
  const walk = (s: Stmt): void => {
    if (found) return;
    eachStmtExpr(
      s,
      (e) => {
        if (!found && exprHasEffect(e, writes)) found = true;
      },
      walk,
    );
  };
  for (const s of body) walk(s);
  return found;
}

export function calleeWritesOf(s: Stmt, writes: FnWrites, out: Set<string>): void {
  eachStmtExpr(
    s,
    (e) => {
      eachExpr(e, (x) => {
        if (x.op !== 'call') return;
        for (const name of callWrites(x, writes)) out.add(name);
      });
    },
    () => {},
  );
}
