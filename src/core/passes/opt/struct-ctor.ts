// ═══ Shader DSL — write-once struct local → constructor (Optimization context) ═══
//
// Collapses the shape an ioStruct body authors with `Out.var()` + field assigns +
// `return o.$`:
//
//   var _v1: VsOut;                       →   return VsOut(
//   _v1.pos = vec4(_v0, 0.0, 1.0);        →     vec4(_v0, 0.0, 1.0),
//   _v1.uv  = vec2(…);                    →     vec2(…));
//   return _v1;
//
// The local is a value being assembled, not a variable: every field is written once
// and nothing reads the aggregate before the return, so the constructor says the same
// thing with no storage. This is an IR fact, not a spelling one — the mutable-`var`
// shape reaches BOTH writers identically (see the `var out: FragmentOutput` in any
// emitted WGSL), which is why it is fixed here rather than in a backend. WGSL gets the
// shorter return; GLSL additionally stops emitting the struct at all, because its
// entry writer scatters a CONSTRUCTOR exit field-by-field (X-GIS #1867) and the type then
// has no spelling left for the decl to be needed by.
//
// VALUE-SAFE by construction: the field expressions are carried over verbatim, and no
// expression moves across anything — see the contiguity rule below, which is what makes
// that claim hold rather than merely be likely. What does move is ORDER: a constructor
// evaluates its arguments in FIELD order, and the assignments ran in whatever order they
// were written. For pure expressions that is invisible. For one with an effect it is not
// (`o.b = rng.next(); o.a = rng.next()` would swap the two draws), so a run holding a call
// that has an effect is left as written.
//
// CONSERVATIVE EXCLUSIONS (each is a real shape in this repo, not a hypothetical):
//   • a MUTATED aggregate — `out.color.w = out.color.w * …` reads the field back, so
//     the polygon fragment entries keep their `var` (a nested member target is the
//     tell, and it disqualifies);
//   • a partially-written aggregate — a ctor must supply every field;
//   • a `raw` body, whose text can touch the local invisibly, as in every other pass.

import type { Expr, Stmt, ModuleDecl, FuncDecl, StructDecl } from '../../ir/index.js';
import { exprHasEffect, fnWrites, type FnWrites } from '../effects.js';
import { bodyHasRaw, collectMutatedRoots } from './expr-utils.js';
import { inoutRoots } from './var-to-let.js';
import { mapExpr } from './ir-transform.js';

/** Does any expression in `s` (nested blocks included) mention `name`? */
function mentions(stmts: readonly Stmt[], name: string): boolean {
  let found = false;
  const see = (e: Expr): Expr => {
    if ((e.op === 'varref' || e.op === 'param') && e.name === name) found = true;
    return e;
  };
  const walk = (list: readonly Stmt[]): void => {
    for (const s of list) {
      switch (s.s) {
        case 'if':
          for (const a of s.arms) {
            mapExpr(a.cond, see);
            walk(a.body);
          }
          if (s.elseBody) walk(s.elseBody);
          break;
        case 'for':
          walk([s.init]);
          mapExpr(s.cond, see);
          walk([s.update]);
          walk(s.body);
          break;
        case 'switch':
          mapExpr(s.scrut, see);
          for (const c of s.cases) walk(c.body);
          if (s.defaultBody) walk(s.defaultBody);
          break;
        case 'let':
          mapExpr(s.expr, see);
          break;
        case 'var':
          if (s.init !== undefined) mapExpr(s.init, see);
          break;
        case 'assign':
        case 'assignOp':
          mapExpr(s.target, see);
          mapExpr(s.expr, see);
          break;
        case 'return':
          if (s.expr !== undefined) mapExpr(s.expr, see);
          break;
        case 'call':
          mapExpr(s.expr, see);
          break;
        default:
          break;
      }
    }
  };
  walk(stmts);
  return found;
}

/** `name`'s field if `e` is exactly `<name>.<field>` — not a deeper path, which would
 *  mean the aggregate is being read back rather than assembled. */
function directField(e: Expr, name: string): string | undefined {
  if (e.op !== 'member') return undefined;
  const b = e.base;
  if ((b.op !== 'varref' && b.op !== 'param') || b.name !== name) return undefined;
  return e.field;
}

/** Rewrite one fn, or return it unchanged. */
function collapseFn(
  f: FuncDecl,
  structs: ReadonlyMap<string, StructDecl>,
  writes: FnWrites,
): FuncDecl {
  if (bodyHasRaw(f.body)) return f;
  const body = f.body;
  const last = body[body.length - 1];
  if (last?.s !== 'return' || last.expr === undefined) return f;
  const ret = last.expr;
  if (ret.op !== 'varref' && ret.op !== 'param') return f;
  const name = ret.name;

  const decl = structs.get(ret.type.kind === 'struct' ? ret.type.name : '');
  if (decl === undefined || decl.fields.length === 0) return f;

  // Walk BACK from the return over a contiguous run of `<name>.<field> = expr`. Contiguity
  // is what makes the value claim hold with no dataflow analysis: nothing but these
  // assignments separates a field's expression from the constructor that will hold it,
  // and none of them writes anything an expression here reads (the aggregate is proven
  // read-free below).
  const prev = body[body.length - 2];
  const prevInit = prev?.s === 'let' ? prev.expr : prev?.s === 'var' ? prev.init : undefined;
  if (
    (prev?.s === 'let' || prev?.s === 'var') &&
    prev.name === name &&
    prevInit?.op === 'construct' &&
    !mentions(body.slice(0, -2), name)
  )
    return { ...f, body: [...body.slice(0, -2), { s: 'return', expr: prevInit, span: last.span }] };
  const byField = new Map<string, Expr>();
  let i = body.length - 2;
  for (; i >= 0; i--) {
    const s = body[i]!;
    if (s.s !== 'assign') break;
    const fld = directField(s.target, name);
    if (fld === undefined || byField.has(fld)) break;
    byField.set(fld, s.expr);
  }
  if (byField.size !== decl.fields.length) return f; // partial — a ctor needs every field
  if (!decl.fields.every((sf) => byField.has(sf.name))) return f;
  // Field order is not assignment order, and a call with an effect keeps the order it was
  // written in (see the header).
  if ([...byField.values()].some((e) => exprHasEffect(e, writes))) return f;

  // The declaration must be an uninitialised `var` of that struct, and nothing outside
  // the run may mention the local — a single read would make this a real variable.
  const declAt = body.findIndex((s) => s.s === 'var' && s.name === name);
  if (declAt < 0 || declAt >= i + 1) return f;
  const d = body[declAt]!;
  if (d.s !== 'var' || d.init !== undefined) return f;
  const outside = [...body.slice(0, declAt), ...body.slice(declAt + 1, i + 1)];
  if (mentions(outside, name)) return f;

  const args = decl.fields.map((sf) => byField.get(sf.name)!);
  return {
    ...f,
    body: [
      ...body.slice(0, declAt),
      ...body.slice(declAt + 1, i + 1),
      { s: 'return', expr: { op: 'construct', type: ret.type, args } },
    ],
  };
}

function exprMentions(e: Expr, name: string): boolean {
  let found = false;
  mapExpr(e, (x) => {
    if ((x.op === 'varref' || x.op === 'param') && x.name === name) found = true;
    return x;
  });
  return found;
}

const stableOps: ReadonlySet<string> = new Set([
  'lit',
  'varref',
  'param',
  'constref',
  'construct',
  'member',
]);

function isStable(e: Expr, mutated: ReadonlySet<string>): boolean {
  let ok = true;
  mapExpr(e, (x) => {
    if (!stableOps.has(x.op)) ok = false;
    if ((x.op === 'varref' || x.op === 'param') && mutated.has(x.name)) ok = false;
    return x;
  });
  return ok;
}

type KnownCtors = ReadonlyMap<string, readonly Expr[]>;

function knownCtors(f: FuncDecl, m: ModuleDecl, writes: FnWrites): KnownCtors {
  const mutated = new Set<string>();
  collectMutatedRoots(f.body, mutated, writes);
  inoutRoots(f.body, m, mutated);
  const found = new Map<string, readonly Expr[]>();
  const seen = new Set<string>();
  const walk = (list: readonly Stmt[]): void => {
    for (const s of list) {
      if (s.s === 'let' || s.s === 'var') {
        const init = s.s === 'let' ? s.expr : s.init;
        if (seen.has(s.name)) found.delete(s.name);
        else if (
          init?.op === 'construct' &&
          init.type.kind === 'struct' &&
          !mutated.has(s.name) &&
          init.args.every((a) => isStable(a, mutated))
        )
          found.set(s.name, init.args);
        seen.add(s.name);
      } else if (s.s === 'if') {
        for (const a of s.arms) walk(a.body);
        if (s.elseBody) walk(s.elseBody);
      } else if (s.s === 'for') walk(s.body);
      else if (s.s === 'switch') {
        for (const c of s.cases) walk(c.body);
        if (s.defaultBody) walk(s.defaultBody);
      }
    }
  };
  walk(f.body);
  return found;
}

function foldRun(
  items: readonly Stmt[],
  at: number,
  structs: ReadonlyMap<string, StructDecl>,
  known: KnownCtors,
  writes: FnWrites,
): { end: number; stmts: readonly Stmt[] } | undefined {
  const d = items[at]!;
  if (d.s !== 'var' || d.type.kind !== 'struct') return undefined;
  const decl = structs.get(d.type.name);
  if (decl === undefined || decl.fields.length === 0) return undefined;
  const name = d.name;
  const byField = new Map<string, Expr>();
  const between: Stmt[] = [];
  let pending: Stmt[] = [];
  let end = -1;
  for (let j = at + 1; j < items.length; j++) {
    const t = items[j]!;
    if (t.s === 'assign') {
      const fld = directField(t.target, name);
      if (fld === undefined || byField.has(fld) || !decl.fields.some((sf) => sf.name === fld))
        break;
      if (exprMentions(t.expr, name) || exprHasEffect(t.expr, writes)) break;
      byField.set(fld, t.expr);
      between.push(...pending);
      pending = [];
      end = j;
    } else if (t.s === 'let' || t.s === 'var') {
      const init = t.s === 'let' ? t.expr : t.init;
      if (init !== undefined && (exprMentions(init, name) || exprHasEffect(init, writes))) break;
      pending.push(t);
    } else break;
  }
  if (byField.size === 0) return undefined;
  let base: readonly Expr[] | undefined;
  if (d.init === undefined) base = undefined;
  else if (d.init.op === 'construct') {
    if (d.init.args.some((a) => exprHasEffect(a, writes))) return undefined;
    base = d.init.args;
  } else if (d.init.op === 'varref') base = known.get(d.init.name);
  if (d.init !== undefined && (base === undefined || base.length !== decl.fields.length))
    return undefined;
  const args: Expr[] = [];
  for (const [k, sf] of decl.fields.entries()) {
    const arg = byField.get(sf.name) ?? base?.[k];
    if (arg === undefined) return undefined;
    args.push(arg);
  }
  const init: Expr = { op: 'construct', type: d.type, args };
  return { end, stmts: [...between, { ...d, init }] };
}

function foldBody(
  body: readonly Stmt[],
  structs: ReadonlyMap<string, StructDecl>,
  known: KnownCtors,
  writes: FnWrites,
): readonly Stmt[] {
  const nest = (b: readonly Stmt[]): readonly Stmt[] => foldBody(b, structs, known, writes);
  let items = body.map((s): Stmt => {
    if (s.s === 'if')
      return {
        ...s,
        arms: s.arms.map((a) => ({ ...a, body: nest(a.body) })),
        elseBody: s.elseBody && nest(s.elseBody),
      };
    if (s.s === 'for') return { ...s, body: nest(s.body) };
    if (s.s === 'switch')
      return {
        ...s,
        cases: s.cases.map((c) => ({ ...c, body: nest(c.body) })),
        defaultBody: s.defaultBody && nest(s.defaultBody),
      };
    return s;
  });
  for (let i = items.length - 1; i >= 0; i--) {
    const run = foldRun(items, i, structs, known, writes);
    if (run !== undefined)
      items = [...items.slice(0, i), ...run.stmts, ...items.slice(run.end + 1)];
  }
  return items;
}

function foldFn(
  f: FuncDecl,
  m: ModuleDecl,
  structs: ReadonlyMap<string, StructDecl>,
  writes: FnWrites,
): FuncDecl {
  if (bodyHasRaw(f.body)) return f;
  return { ...f, body: foldBody(f.body, structs, knownCtors(f, m, writes), writes) };
}

/** Collapse every write-once struct local that is only ever assembled and returned. */
export function structCtor(m: ModuleDecl): ModuleDecl {
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  if (structs.size === 0) return m;
  const writes = fnWrites(m);
  return {
    ...m,
    funcs: m.funcs.map((f) => foldFn(collapseFn(f, structs, writes), m, structs, writes)),
  };
}
