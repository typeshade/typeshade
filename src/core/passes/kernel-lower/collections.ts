import type { Expr, FuncDecl, ModuleDecl, Stmt, StructDecl } from '../../ir/nodes.js';
import type { ShaderType } from '../../ir/types.js';
import { u32T } from '../../ir/types.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../../ir/visit.js';
import {
  declaredNames,
  type ForStmt,
  type KernelCollection,
  type KernelLookup,
  type KernelLowering,
  type KernelPlan,
} from '../kernel-lower-ir.js';
import { proveKernels } from '../parallel-loop.js';
import { addsPerRun } from './push-counts.js';
import { NOT_FOUND, findFunction } from './lookup-search.js';

function readsCollection(sts: readonly Stmt[], name: string): boolean {
  let found = false;
  const visit = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (
        x.op === 'call' &&
        (x.fn === 'collectionHas' || x.fn === 'collectionGet' || x.fn === 'collectionSize') &&
        x.args[0]?.op === 'param' &&
        x.args[0].name === name
      )
        found = true;
    });
  const walk = (st: Stmt): void => eachStmtExpr(st, visit, walk);
  sts.forEach(walk);
  return found;
}

export function lowerCollections(
  f: FuncDecl,
  m: ModuleDecl,
  lower: KernelLowering,
): KernelPlan | { readonly noGpu: string } {
  const loops = f.body.filter((st): st is ForStmt => st.s === 'for');
  const taken = declaredNames(m);
  const structs: StructDecl[] = [];
  const params: FuncDecl['params'][number][] = [];
  const collections: KernelCollection[] = [];
  const lookups: KernelLookup[] = [];
  const helpers: FuncDecl[] = [];
  const finders = new Map<
    string,
    { find: FuncDecl; keys: string; values: string | undefined; value: ShaderType | undefined }
  >();
  for (const p of f.params) {
    const t = p.type;
    if (t.kind !== 'collection') continue;
    const what = `the ${t.value === undefined ? 'Set' : 'Map'} "${p.name}"`;
    const adding = loops.flatMap((l, j) => (addsPerRun(l.body, p.name) !== 0 ? [j] : []));
    const reading = loops.flatMap((l, j) => (readsCollection(l.body, p.name) ? [j] : []));
    if (reading.length > 0 && adding.some((a) => a >= reading[0]!))
      return {
        noGpu: `loop ${adding.find((a) => a >= reading[0]!)! + 1} adds to ${what}, which loop ${reading[0]! + 1} reads before it, and the call uploads a collection once`,
      };
    if (reading.length > 0) {
      const fresh = (base: string): string => {
        let name = base;
        while (taken.has(name)) name = `_${name}`;
        taken.add(name);
        return name;
      };
      const keys = fresh(`_${p.name}_keys`);
      params.push({ name: keys, type: { kind: 'array', elem: u32T } });
      const values = t.value !== undefined ? fresh(`_${p.name}_values`) : undefined;
      if (values !== undefined)
        params.push({ name: values, type: { kind: 'array', elem: t.value! } });
      const find = findFunction(fresh(`${f.name}_${p.name}_find`), keys, t.key);
      helpers.push(find);
      lookups.push({
        param: p.name,
        keys,
        ...(values !== undefined ? { values } : {}),
        loop: reading[0]!,
      });
      finders.set(p.name, { find, keys, values, value: t.value });
      if (adding.length === 0) continue;
    }
    if (adding.length === 0) continue;
    if (adding.length > 1)
      return {
        noGpu: `loops ${adding[0]! + 1} and ${adding[1]! + 1} both add to ${what}, and the second adds after the first`,
      };
    const j = adding[0]!;
    const perIteration = addsPerRun(loops[j]!.body, p.name);
    if (perIteration === undefined)
      return {
        noGpu: `loop ${j + 1} adds to ${what} inside a nested loop, whose trips the call does not count`,
      };
    let records = `_${p.name}_records`;
    while (taken.has(records)) records = `_${records}`;
    taken.add(records);
    const keyT: ShaderType = { kind: 'scalar', scalar: t.key };
    let elem: ShaderType = keyT;
    if (t.value !== undefined) {
      let name = `${f.name}_${p.name}_Entry`;
      while (taken.has(name)) name = `_${name}`;
      taken.add(name);
      structs.push({
        name,
        fields: [
          { name: 'k', type: keyT },
          { name: 'v', type: t.value },
        ],
      });
      elem = { kind: 'struct', name };
    }
    params.push({ name: records, type: { kind: 'array', elem }, mode: 'inout' });
    collections.push({ param: p.name, records, loop: j, perIteration });
  }
  const byParam = new Map(collections.map((c) => [c.param, c]));
  const recordOf = (x: Expr & { op: 'call' }): Expr | undefined => {
    const target = x.args[0];
    const c = target?.op === 'param' ? byParam.get(target.name) : undefined;
    if (c === undefined) return undefined;
    const p = params.find((q) => q.name === c.records)!;
    const arr: Expr = { op: 'param', type: p.type, name: c.records };
    const elem = (p.type as { elem: ShaderType }).elem;
    const value: Expr =
      x.fn === 'collectionAdd'
        ? x.args[1]!
        : { op: 'construct', type: elem, args: [x.args[1]!, x.args[2]!] };
    return { op: 'call', type: u32T, fn: 'push', args: [arr, value] };
  };
  const lookupOf = (y: Expr & { op: 'call' }): Expr | undefined => {
    const target = y.args[0];
    const l = target?.op === 'param' ? finders.get(target.name) : undefined;
    if (l === undefined) return undefined;
    const keysT: ShaderType = { kind: 'array', elem: u32T };
    const keysRef: Expr = { op: 'param', type: keysT, name: l.keys };
    const lit = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
    if (y.fn === 'collectionSize') return { op: 'index', type: u32T, base: keysRef, idx: lit(0) };
    const at: Expr = {
      op: 'call',
      type: u32T,
      fn: l.find.name,
      args: [y.args[1]!],
      declRef: l.find,
    };
    if (y.fn === 'collectionHas')
      return {
        op: 'compare',
        type: { kind: 'scalar', scalar: 'bool' },
        cop: '!=',
        a: at,
        b: lit(NOT_FOUND),
      };
    const valuesT: ShaderType = { kind: 'array', elem: l.value! };
    return {
      op: 'index',
      type: l.value!,
      base: { op: 'param', type: valuesT, name: l.values! },
      idx: at,
    };
  };
  const rewrite = (e: Expr): Expr => {
    const y = mapChildren(e, rewrite);
    if (y.op === 'call' && (y.fn === 'collectionAdd' || y.fn === 'collectionSet'))
      return recordOf(y) ?? y;
    if (
      y.op === 'call' &&
      (y.fn === 'collectionHas' || y.fn === 'collectionGet' || y.fn === 'collectionSize')
    )
      return lookupOf(y) ?? y;
    return y;
  };
  const stmt = (st: Stmt): Stmt => mapStmtExpr(st, rewrite, stmt);
  const lowered: FuncDecl = {
    ...f,
    params: [...f.params.filter((p) => p.type.kind !== 'collection'), ...params],
    body: f.body.map((st) => (st.s === 'for' ? stmt(st) : st)),
  };
  const m2: ModuleDecl = {
    ...m,
    structs: [...m.structs, ...structs],
    funcs: [...helpers, ...m.funcs.map((x) => (x === f ? lowered : x))],
  };
  const proof2 = proveKernels(m2).find((x) => x.fn === f.name);
  if (proof2 === undefined) return { noGpu: 'its records were not proved' };
  if (proof2.loops.some((l) => !l.ok)) return { noGpu: 'a loop of it runs on the CPU (TS8070)' };
  const plan = lower(lowered, m2, proof2);
  if ('noGpu' in plan) return plan;
  const own = (fn: FuncDecl): FuncDecl => ({
    ...fn,
    params: [...f.params, ...fn.params.slice(lowered.params.length)],
  });
  return {
    ...plan,
    ranges: plan.ranges.map(own),
    ...(collections.length > 0 ? { collections } : {}),
    ...(lookups.length > 0 ? { lookups } : {}),
  };
}
