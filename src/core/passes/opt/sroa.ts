import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from '../../ir/index.js';
import { typeKey } from '../../ir/types.js';
import { fnWrites } from '../effects.js';
import { eachExpr } from '../../ir/visit.js';
import { mapExpr } from './ir-transform.js';
import { bodyHasRaw, collectLocals, collectMutatedRoots } from './expr-utils.js';
import { eachBlockStmt, eachBodyExpr, rewriteBlocks } from './sroa/blocks.js';

const MAX_ELEMENTS = 16;

interface Split {
  readonly elem: ShaderType;
  readonly size: number;
  readonly init: readonly Expr[] | undefined;
}

const splitName = (name: string, k: number): string => `${name}_${String(k)}`;

function splitOf(type: ShaderType, init: Expr | undefined): Split | undefined {
  if (type.kind !== 'array' || type.size === undefined || type.sizeOverride !== undefined)
    return undefined;
  const { elem, size } = type;
  if (size < 1 || size > MAX_ELEMENTS) return undefined;
  if (init === undefined) return { elem, size, init: undefined };
  if (init.op !== 'construct' || init.args.length !== size) return undefined;
  const key = typeKey(elem);
  if (init.args.some((a) => typeKey(a.type) !== key)) return undefined;
  return { elem, size, init: init.args };
}

function candidates(body: readonly Stmt[]): Map<string, Split> {
  const found = new Map<string, Split>();
  eachBlockStmt(body, (s) => {
    const split =
      s.s === 'var'
        ? splitOf(s.type, s.init)
        : s.s === 'let'
          ? splitOf(s.expr.type, s.expr)
          : undefined;
    if (split !== undefined && (s.s === 'var' || s.s === 'let')) found.set(s.name, split);
  });
  return found;
}

const literalIndex = (e: Expr): number | undefined =>
  e.op === 'lit' && typeof e.value === 'number' && Number.isInteger(e.value) ? e.value : undefined;

const mentions = (e: Expr, name: string): boolean => {
  let found = false;
  eachExpr(e, (x) => {
    if (x.op === 'varref' && x.name === name) found = true;
  });
  return found;
};

function wholeAssign(s: Stmt, split: Split | undefined): readonly Expr[] | undefined {
  if (s.s !== 'assign' || s.target.op !== 'varref' || split === undefined) return undefined;
  const e = s.expr;
  if (e.op !== 'construct' || e.args.length !== split.size) return undefined;
  const key = typeKey(split.elem);
  const name = s.target.name;
  if (e.args.some((a) => typeKey(a.type) !== key || mentions(a, name))) return undefined;
  return e.args;
}

function onlyLiteralIndexed(body: readonly Stmt[], found: Map<string, Split>): void {
  const refs = new Map<string, number>();
  const indexed = new Map<string, number>();
  const bad = new Set<string>();
  eachBlockStmt(body, (s) => {
    if (s.s === 'assign' && s.target.op === 'varref' && wholeAssign(s, found.get(s.target.name)))
      indexed.set(s.target.name, (indexed.get(s.target.name) ?? 0) + 1);
  });
  eachBodyExpr(body, (e) => {
    if (e.op === 'varref' && found.has(e.name)) refs.set(e.name, (refs.get(e.name) ?? 0) + 1);
    if (e.op !== 'index' || e.base.op !== 'varref') return;
    const split = found.get(e.base.name);
    const k = literalIndex(e.idx);
    if (split === undefined) return;
    if (k === undefined || k < 0 || k >= split.size) bad.add(e.base.name);
    else indexed.set(e.base.name, (indexed.get(e.base.name) ?? 0) + 1);
  });
  for (const name of [...found.keys()]) {
    if (bad.has(name) || (refs.get(name) ?? 0) !== (indexed.get(name) ?? 0)) found.delete(name);
  }
}

function splitFunction(f: FuncDecl, writes: ReturnType<typeof fnWrites>): FuncDecl {
  const found = candidates(f.body);
  if (found.size === 0) return f;
  onlyLiteralIndexed(f.body, found);
  if (found.size === 0) return f;
  const taken = new Set<string>(f.params.map((p) => p.name));
  collectLocals(f.body, taken);
  const names = new Map<string, string[]>();
  for (const [name, split] of found) {
    const parts: string[] = [];
    for (let k = 0; k < split.size; k++) {
      let candidate = splitName(name, k);
      while (taken.has(candidate)) candidate = `${candidate}_`;
      taken.add(candidate);
      parts.push(candidate);
    }
    names.set(name, parts);
  }
  const read = (e: Expr): Expr => {
    if (e.op !== 'index' || e.base.op !== 'varref') return e;
    const parts = names.get(e.base.name);
    const k = literalIndex(e.idx);
    if (parts === undefined || k === undefined) return e;
    return { op: 'varref', type: e.type, name: parts[k]! };
  };
  const created = new Set<string>();
  const declare = (s: Stmt): readonly Stmt[] | undefined => {
    if (s.s === 'assign' && s.target.op === 'varref') {
      const target = s.target.name;
      const parts = names.get(target);
      const args = wholeAssign(s, found.get(target));
      if (parts === undefined || args === undefined) return undefined;
      return parts.map((name, k): Stmt => ({
        s: 'assign',
        target: { op: 'varref', type: found.get(target)!.elem, name },
        expr: mapExpr(args[k]!, read),
        span: s.span,
      }));
    }
    if (s.s !== 'var' && s.s !== 'let') return undefined;
    const split = found.get(s.name);
    if (split === undefined) return undefined;
    return names.get(s.name)!.map((name, k): Stmt => {
      created.add(name);
      return {
        s: 'var',
        name,
        type: split.elem,
        init: split.init && mapExpr(split.init[k]!, read),
        span: s.span,
      };
    });
  };
  const split = rewriteBlocks(f.body, declare, (e) => mapExpr(e, read));
  const mutated = new Set<string>();
  collectMutatedRoots(split, mutated, writes);
  const settle = (s: Stmt): readonly Stmt[] | undefined =>
    s.s === 'var' && s.init !== undefined && created.has(s.name) && !mutated.has(s.name)
      ? [{ s: 'let', name: s.name, expr: s.init, span: s.span }]
      : undefined;
  return { ...f, body: rewriteBlocks(split, settle) };
}

export function splitLocalArrays(m: ModuleDecl): ModuleDecl {
  const writes = fnWrites(m);
  return {
    ...m,
    funcs: m.funcs.map((f) => (bodyHasRaw(f.body) ? f : splitFunction(f, writes))),
  };
}
