import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from '../../ir/index.js';
import { eachExpr } from '../../ir/visit.js';
import { armValues, type LocalVar } from './if-convert/arms.js';
import { isCheapAndPure } from './if-convert/pure.js';
import { parallelAssign, selectValues } from './if-convert/sequence.js';
import { bodyHasRaw, collectLocals, collectMutatedRoots } from './expr-utils.js';
import { fnWrites } from '../effects.js';
import { eachBlockStmt, eachBodyExpr, rewriteBlocks, type Fused } from './sroa/blocks.js';

function localVars(f: FuncDecl): Map<string, LocalVar> {
  const out = new Map<string, LocalVar>();
  eachBlockStmt(f.body, (s) => {
    if (s.s === 'var') out.set(s.name, { type: s.type, hasInit: s.init !== undefined });
    if (s.s === 'for' && s.init.s === 'var')
      out.set(s.init.name, { type: s.init.type, hasInit: s.init.init !== undefined });
  });
  return out;
}

function readCounts(f: FuncDecl): Map<string, number> {
  const reads = new Map<string, number>();
  const bump = (name: string, by: number): void => {
    reads.set(name, (reads.get(name) ?? 0) + by);
  };
  eachBodyExpr(f.body, (e) => {
    if (e.op === 'varref') bump(e.name, 1);
  });
  eachBlockStmt(f.body, (s) => {
    if (s.s === 'assign' && s.target.op === 'varref') bump(s.target.name, -1);
  });
  return reads;
}

function namer(m: ModuleDecl, f: FuncDecl): () => string {
  const used = new Set<string>(f.params.map((p) => p.name));
  collectLocals(f.body, used);
  for (const c of m.consts) used.add(c.name);
  for (const g of m.funcs) used.add(g.name);
  for (const b of m.bindings) used.add(b.name);
  let n = 0;
  return () => {
    while (used.has(`_ifc${String(n)}`)) n++;
    const name = `_ifc${String(n)}`;
    used.add(name);
    return name;
  };
}

const readsOverride = (e: Expr): boolean => {
  let found = false;
  eachExpr(e, (x) => {
    if (x.op === 'overrideref') found = true;
  });
  return found;
};

const isImmutableLeaf = (e: Expr): boolean =>
  e.op === 'lit' || e.op === 'param' || e.op === 'constref';

function fuseCopies(
  values: Map<string, Expr>,
  siblings: readonly Stmt[],
  next: number,
  locals: ReadonlyMap<string, LocalVar>,
  reads: ReadonlyMap<string, number>,
): number {
  let consumed = 0;
  for (let i = next; i < siblings.length; i++) {
    const c = siblings[i]!;
    if (c.s !== 'assign' || c.target.op !== 'varref' || c.expr.op !== 'varref') break;
    const [x, t] = [c.target.name, c.expr.name];
    const value = values.get(t);
    const fusable =
      value !== undefined && x !== t && !values.has(x) && locals.has(x) && reads.get(t) === 1;
    if (!fusable) break;
    values.delete(t);
    values.set(x, value);
    consumed++;
  }
  return consumed;
}

function convertIf(
  s: Extract<Stmt, { s: 'if' }>,
  siblings: readonly Stmt[],
  next: number,
  locals: ReadonlyMap<string, LocalVar>,
  reads: ReadonlyMap<string, number>,
  fresh: () => string,
  converted: Set<string>,
): Fused | undefined {
  if (s.arms.length !== 1 || readsOverride(s.arms[0]!.cond)) return undefined;
  const [arm] = s.arms;
  const thenValues = armValues(arm!.body, locals);
  const elseValues = armValues(s.elseBody ?? [], locals);
  if (thenValues === undefined || elseValues === undefined) return undefined;
  if (thenValues.size === 0 && elseValues.size === 0) return undefined;
  const types = new Map<string, ShaderType>();
  for (const [name, v] of locals) types.set(name, v.type);
  const prelude: Stmt[] = [];
  const own = arm!.cond;
  const pick = (cond: Expr): Map<string, Expr> | undefined =>
    selectValues(cond, thenValues, elseValues, types, (n) => locals.get(n)!.hasInit);
  let values = pick(own);
  if (values === undefined) return undefined;
  const inlined = isImmutableLeaf(own) || (values.size === 1 && isCheapAndPure(own));
  if (!inlined) {
    const name = fresh();
    prelude.push({ s: 'let', name, expr: own, span: s.span });
    values = pick({ op: 'varref', type: own.type, name });
    if (values === undefined) return undefined;
  }
  const consumed = fuseCopies(values, siblings, next, locals, reads);
  for (const name of values.keys()) converted.add(name);
  return { stmts: [...prelude, ...parallelAssign(values, types, fresh, s.span)], consumed };
}

const mentions = (e: Expr, name: string): boolean => {
  let found = false;
  eachExpr(e, (x) => {
    if (x.op === 'varref' && x.name === name) found = true;
  });
  return found;
};

function mergeInit(body: readonly Stmt[], converted: ReadonlySet<string>): Stmt[] {
  return rewriteBlocks(body, (s, siblings, next) => {
    if (s.s !== 'var' || s.init !== undefined || !converted.has(s.name)) return undefined;
    let at = next;
    const isLetOfOthers = (t: Stmt | undefined): boolean =>
      t?.s === 'let' && !mentions(t.expr, s.name);
    while (isLetOfOthers(siblings[at])) at++;
    const write = siblings[at];
    const initializes =
      write?.s === 'assign' &&
      write.target.op === 'varref' &&
      write.target.name === s.name &&
      !mentions(write.expr, s.name);
    if (!initializes) return undefined;
    return {
      stmts: [...siblings.slice(next, at), { ...s, init: write.expr }],
      consumed: at - next + 1,
    };
  });
}

function promoteUnwritten(
  body: readonly Stmt[],
  converted: ReadonlySet<string>,
  m: ModuleDecl,
): Stmt[] {
  const mutated = new Set<string>();
  collectMutatedRoots(body, mutated, fnWrites(m));
  return rewriteBlocks(body, (s) =>
    s.s === 'var' && s.init !== undefined && converted.has(s.name) && !mutated.has(s.name)
      ? [{ s: 'let', name: s.name, expr: s.init, span: s.span }]
      : undefined,
  );
}

function convertFn(m: ModuleDecl, f: FuncDecl): FuncDecl {
  if (bodyHasRaw(f.body)) return f;
  const locals = localVars(f);
  const reads = readCounts(f);
  const fresh = namer(m, f);
  const converted = new Set<string>();
  const body = rewriteBlocks(f.body, (s, siblings, next) =>
    s.s === 'if' ? convertIf(s, siblings, next, locals, reads, fresh, converted) : undefined,
  );
  if (converted.size === 0) return { ...f, body };
  return { ...f, body: promoteUnwritten(mergeInit(body, converted), converted, m) };
}

let converting = true;

export function setIfConversion(on: boolean): void {
  converting = on;
}

export function ifConvert(m: ModuleDecl): ModuleDecl {
  return converting ? { ...m, funcs: m.funcs.map((f) => convertFn(m, f)) } : m;
}
