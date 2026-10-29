// ═══ Shader DSL — GLSL ES 3.00: a call reads a module-scope place by its name ═══
//
// GLSL ES 3.00 has no pointer. A parameter is `in`, `out` or `inout`, and each of the three is a
// copy (GLSL ES 3.00 §6.1.1). So a method called on a uniform block, `U.twice(i)`, built a new
// struct from the block's members at each call, `Big_twice(Big_value(U.a, U.b, U.xs), i)`, and a
// method that writes its object, called on a module variable, copied it in and out. A read-only
// method on an emulated storage element was refused: the element is no value on this target.
//
// Rule 8.26 (change 0103): a call must not copy an object its callee only reads when the
// argument is a place. On this target a module-scope place can be reached without a copy, by
// its NAME: this pass makes a copy of the callee for each module-scope place its calls hand it,
// with the parameter replaced by the place itself (`Big_twice_U(i)` reads `U.xs[i].x`), and
// each index the place is reached through passed as an integer parameter, evaluated once at the
// call as the copy evaluated it (`Big_pick_R(u32(i), i)` reads `R[at0].a`). A writing method
// handed a module variable writes it by name (`Big_bump_G(2.0)`), with no `inout` copy. The
// copy is the same one Tint makes of a function that takes a pointer when it writes HLSL or MSL
// (its DirectVariableAccess transform).
//
// A local stays an `in` copy: GLSL ES 3.00 has no reference that only reads, and the place
// cannot be named from another function.
//
// A read-only argument stays a copy where the place can change while the callee runs, as WGSL's
// pointer does (wgsl-ptr.ts, change 0103 section 4): the callee writes it by name, or another
// argument of the call that the callee writes is the same place. A written argument is always
// reached by name: the front end refuses a call where the callee also reads or writes the place
// by its name, or where two arguments name it (Rule 8.25), so the copy-in and copy-out and the
// write by name cannot tell apart.
//
// GLSL-LOCAL, like glsl-block-values.ts: WGSL takes the same arguments by pointer. Called from
// `lowerForGlsl` after the IR plugins and before `lowerUniformBlockValues`, so a block a call no
// longer reads whole needs no twin, and before the storage emulation reads the module.

import type { Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/index.js';
import { stageOf } from '../ir/nodes.js';
import { mapChildren, mapStmtExpr } from '../ir/visit.js';
import { fnWrites } from '../passes/effects.js';

type Param = FuncDecl['params'][number];

/** Whether `p` of `f` is a parameter a module-scope place may reach by name: one the callee
 *  writes through, or a struct or a fixed-size array it takes by value, of a function that is
 *  not an entry point. */
const keyedParam = (f: FuncDecl, p: Param): boolean =>
  stageOf(f) === undefined &&
  (p.mode === 'inout' ||
    (p.builtin === undefined &&
      p.location === undefined &&
      (p.type.kind === 'struct' || (p.type.kind === 'array' && p.type.size !== undefined))));

/** The root of an l-value, `R` for `R[i].a`, when the path to it is members and indices. */
function rootOf(e: Expr): (Expr & { op: 'varref' }) | undefined {
  let at = e;
  for (;;) {
    if (at.op === 'varref') return at;
    if (at.op === 'member' || at.op === 'index') {
      at = at.base;
      continue;
    }
    return undefined;
  }
}

/** One place an argument names: its root, the template a callee's copy reads it through (each
 *  index that is not a literal replaced by a parameter of the copy), the indices themselves,
 *  which the call passes, and a key that names the shape. */
interface Place {
  readonly root: string;
  readonly template: Expr;
  readonly indices: readonly Expr[];
  readonly key: string;
}

function placeOf(arg: Expr, prefix: string): Place | undefined {
  const root = rootOf(arg);
  if (root === undefined) return undefined;
  const indices: Expr[] = [];
  const parts: string[] = [];
  const build = (e: Expr): Expr => {
    if (e.op === 'varref') {
      parts.push(e.name);
      return e;
    }
    if (e.op === 'member') {
      const base = build(e.base);
      parts.push(e.field);
      return { ...e, base };
    }
    if (e.op === 'index') {
      const base = build(e.base);
      if (e.idx.op === 'lit') {
        parts.push(String(e.idx.value));
        return { ...e, base };
      }
      const name = `${prefix}${indices.length}`;
      indices.push(e.idx);
      parts.push('at');
      return { ...e, base, idx: { op: 'param', type: e.idx.type, name } };
    }
    return e;
  };
  const template = build(arg);
  return { root: root.name, template, indices, key: parts.join('_') };
}

/** Replace every read of the parameter `name` in `e` with `place`. */
function substitute(e: Expr, name: string, place: Expr): Expr {
  if ((e.op === 'param' || e.op === 'varref') && e.name === name) return place;
  return mapChildren(e, (c) => substitute(c, name, place));
}

/** Copy each function a call hands a module-scope place, reading the place by name. See the
 *  module header. Identity for a module whose calls hand no module-scope place to a struct, an
 *  array or a written parameter. */
export function lowerGlobalPlaceArguments(m: ModuleDecl): ModuleDecl {
  const globals = new Set<string>([
    // A `read_write` storage binding is left out: on this target it is the output of an
    // emulated compute pass, whose lowering reads its own writes' shapes (gl-compute.ts).
    ...m.bindings
      .filter((b) => b.space === 'uniform' || (b.space === 'storage' && b.access !== 'read_write'))
      .map((b) => b.name),
    ...(m.vars ?? []).filter((v) => v.space === 'private').map((v) => v.name),
  ]);
  if (globals.size === 0) return m;
  const writes = fnWrites(m);
  const taken = new Set<string>(m.funcs.map((f) => f.name));
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  /** Copy name by `callee|param index|place key`. */
  const made = new Map<string, FuncDecl>();
  /** Which function each copy was made of, so a copy's own writes are its origin's. */
  const originOf = new Map<string, string>();
  const order: FuncDecl[] = [...m.funcs];

  const fresh = (wanted: string): string => {
    // GLSL ES reserves an identifier that holds two underscores in a row.
    const base = wanted.replace(/_+/g, '_');
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
    taken.add(name);
    return name;
  };

  /** The argument at `at` of `call`, if it is a module-scope place the callee may read by
   *  name. */
  const reachable = (
    call: Expr & { op: 'call' },
    callee: FuncDecl,
    at: number,
  ): Place | undefined => {
    const p = callee.params[at]!;
    if (!keyedParam(callee, p)) return undefined;
    const arg = call.args[at];
    if (arg === undefined) return undefined;
    const place = placeOf(arg, 'at');
    if (place === undefined || !globals.has(place.root)) return undefined;
    if (p.mode === 'inout') return place;
    // A read-only argument whose place may change while the callee runs stays a copy.
    const origin = originOf.get(callee.name) ?? callee.name;
    if ((writes.get(origin) ?? new Set()).has(place.root)) return undefined;
    for (const [j, q] of callee.params.entries()) {
      if (j === at || q.mode !== 'inout') continue;
      const other = call.args[j];
      if (other !== undefined && rootOf(other)?.name === place.root) return undefined;
    }
    return place;
  };

  /** The copy of `callee` with its parameter `at` read as `place`. */
  const copyOf = (callee: FuncDecl, at: number, place: Place): FuncDecl => {
    const key = `${callee.name}|${at}|${place.key}`;
    const hit = made.get(key);
    if (hit !== undefined) return hit;
    const p = callee.params[at]!;
    const owned = new Set(callee.params.map((q) => q.name));
    const prefix = (() => {
      for (let n = 0; ; n++) {
        const candidate = n === 0 ? 'at' : `at${n}_`;
        if (![...owned].some((o) => o.startsWith(candidate))) return candidate;
      }
    })();
    const renamed =
      place.indices.length === 0 ? place.template : retargetIndices(place.template, prefix);
    const params: Param[] = [
      ...callee.params.slice(0, at),
      ...place.indices.map((ix, i): Param => ({ name: `${prefix}${i}`, type: ix.type })),
      ...callee.params.slice(at + 1),
    ];
    const body = callee.body.map((s: Stmt) =>
      mapStmtExpr(s, (e) => substitute(e, p.name, renamed)),
    );
    const name = fresh(`${callee.name}_${place.key}`);
    const copy: FuncDecl = { ...callee, name, params, body };
    made.set(key, copy);
    originOf.set(name, originOf.get(callee.name) ?? callee.name);
    byName.set(name, copy);
    const after = order.indexOf(callee);
    order.splice(after + 1, 0, copy);
    return copy;
  };

  /** Rewrite the calls in `e` that hand a module-scope place to a keyed parameter. */
  const rewrite = (e: Expr): Expr => {
    const inner = mapChildren(e, rewrite);
    if (inner.op !== 'call') return inner;
    let call = inner;
    for (;;) {
      const callee = byName.get(call.fn);
      if (callee === undefined) return call;
      let changed = false;
      for (let at = 0; at < callee.params.length; at++) {
        const place = reachable(call, callee, at);
        if (place === undefined) continue;
        const copy = copyOf(callee, at, place);
        call = {
          ...call,
          fn: copy.name,
          declRef: copy,
          args: [...call.args.slice(0, at), ...place.indices, ...call.args.slice(at + 1)],
        };
        changed = true;
        break;
      }
      if (!changed) return call;
    }
  };

  // Rewrite every body until no call hands a module-scope place on: a copy's own body reads the
  // place, and a call in it that hands the place (or a part of it) on is rewritten in turn.
  const done = new Map<FuncDecl, FuncDecl>();
  for (let round = 0; round <= m.funcs.length + 1; round++) {
    let grew = false;
    for (const f of [...order]) {
      if (done.has(f)) continue;
      const body = f.body.map((s: Stmt) => mapStmtExpr(s, rewrite));
      done.set(f, { ...f, body });
      grew = true;
    }
    if (!grew) break;
  }
  if (made.size === 0) return m;
  return { ...m, funcs: order.map((f) => done.get(f) ?? f) };
}

/** `template` with each parameter index `atN` it reads renamed to `${prefix}N`. */
function retargetIndices(template: Expr, prefix: string): Expr {
  const walk = (e: Expr): Expr => {
    if (e.op === 'param' && /^at\d+$/.test(e.name))
      return { ...e, name: `${prefix}${e.name.slice(2)}` };
    return mapChildren(e, walk);
  };
  return walk(template);
}
