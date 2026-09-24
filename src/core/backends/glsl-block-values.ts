// ═══ Shader DSL — GLSL ES 3.00: a uniform block's struct used as a value ═══
//
// A `uniform<U>` binding is a std140 block on this target, `layout(std140) uniform U { … } u;`,
// and the block's tag is the struct's own name, because that is the name a GLSL host passes to
// `getUniformBlockIndex` (`BindEntry.structName`, reflect.ts). A block name is nothing but a
// block name in GLSL ES 3.00, so the writer declares no `struct U` beside the block, and every
// other place the program holds a `U` still spelled the name: a parameter, a local, the `self_`
// of a method called on the uniform, a field of another struct or block. Measured on ANGLE
// (WebGL2 on SwiftShader, `chromium_headless_shell-1194`): `float f(U x)` is
// `'U' : syntax error`, `U copy;` is `'U' : variable expected`, and a block field `U inner;` is
// `'U' : syntax error`. Tint takes the same module, since WGSL declares the struct and the
// `var<uniform>` separately, so `compile()` reported nothing while ANGLE refused the stage.
//
// The lowering gives such a struct a TWIN, `U_value`: an ordinary struct with the same members,
// the type every VALUE of `U` takes, while the block keeps the name a host binds it by and its
// members keep theirs, so neither the std140 offsets nor a host's lookups move. A read of the
// block WHOLE (an argument `f(u)`, `copy = u`, the object of `u.sum()`) is rebuilt from its
// members, `U_value(u.a, u.b)`, which is the load a copy was going to do anyway; surface §51
// rebuilds a padded uniform array read whole the same way on WGSL. A member read `u.a` stays as
// written. Measured on the same driver: a `U_value` parameter and local beside
// `uniform U { … } u`, built by `U_value(u.a, u.b, u.inner, u.arr, u.items)` with array and
// nested-struct members, and a block field `U_value inner;`, compile and link.
//
// Identity for a module that never holds a block's struct as a value, which is every module
// that compiled on WebGL2 before this, so their emitted bytes do not move.
//
// GLSL-LOCAL, like glsl-sanitize.ts and glsl-legalize.ts: WGSL has no such rule, and its golden
// corpus is byte-gated. Called from `lowerForGlsl` after the IR plugins and before
// `hoistDiscardingCtorArgs`, so the module the assembly spells holds no whole read of a block
// whatever a plugin did, and the legalisation still sees the final IR.

import type { Expr, ModuleDecl, Stmt, StructDecl } from '../ir/index.js';
import { structT, type ShaderType } from '../ir/index.js';
import { typeStructNames } from '../ir/collect-refs.js';
import { eachExpr, eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { collectLocals } from '../passes/opt/expr-utils.js';
import { RESERVED_WORDS } from '../reserved-words.js';

/** Type every value of a uniform block's struct as its twin, and rebuild each whole read of the
 *  block from its members. See the module header. */
export function lowerUniformBlockValues(m: ModuleDecl): ModuleDecl {
  // Binding name → its struct, for every uniform block. A loose host block is no longer one
  // here: `lowerHostLooseBlocks` has already flattened it into default-block uniforms.
  const blockOf = new Map<string, string>();
  for (const b of m.bindings)
    if (b.space === 'uniform' && b.type.kind === 'struct') blockOf.set(b.name, b.type.name);
  if (blockOf.size === 0) return m;

  /** The struct of the block `e` reads, when `e` is a read of a block itself: a `varref` of a
   *  block binding, typed as its struct. A local that shadows the binding with the same name
   *  and type passes too, and rebuilding a read of it from its own members is the identity, so
   *  nothing here has to tell the two apart. */
  const blockRead = (e: Expr): string | undefined =>
    e.op === 'varref' && e.type.kind === 'struct' && blockOf.get(e.name) === e.type.name
      ? e.type.name
      : undefined;

  const twin = twinNames(m, valueStructs(m, blockRead, new Set(blockOf.values())));
  if (twin.size === 0) return m;

  const retype = (t: ShaderType): ShaderType => {
    if (t.kind === 'struct') {
      const name = twin.get(t.name);
      return name === undefined ? t : structT(name);
    }
    if (t.kind === 'array') {
      const elem = retype(t.elem);
      return elem === t.elem ? t : { ...t, elem };
    }
    return t;
  };
  const retyped = <E extends Expr>(e: E): E => {
    const type = retype(e.type);
    return type === e.type ? e : { ...e, type };
  };

  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const funcs = new Map(m.funcs.map((f) => [f.name, f]));

  const rewrite = (e: Expr): Expr => {
    const read = blockRead(e);
    if (read !== undefined) {
      const name = twin.get(read);
      const decl = structs.get(read);
      if (name === undefined || decl === undefined) return e;
      return {
        op: 'construct',
        type: structT(name),
        args: decl.fields.map((f) => ({
          op: 'member' as const,
          type: retype(f.type),
          base: e,
          field: f.name,
        })),
      };
    }
    // `u.a`: the block read through a member, which GLSL spells as it is. Only the member's
    // own type moves, for a field that is itself a block's struct.
    if (e.op === 'member' && blockRead(e.base) !== undefined) return retyped(e);
    // An `inout` argument is a place the callee writes back to, never a value to rebuild.
    if (e.op === 'call') {
      const params = funcs.get(e.fn)?.params;
      return retyped({
        ...e,
        args: e.args.map((a, i) => (params?.[i]?.mode === 'inout' ? place(a) : rewrite(a))),
      });
    }
    return retyped(mapChildren(e, rewrite));
  };
  /** An assignment target or an `inout` argument: its root names storage and is kept, and only
   *  the index expressions inside it are values. */
  const place = (e: Expr): Expr => {
    if (e.op === 'member') return retyped({ ...e, base: place(e.base) });
    if (e.op === 'index') return retyped({ ...e, base: place(e.base), idx: rewrite(e.idx) });
    return e.op === 'varref' || e.op === 'param' ? retyped(e) : rewrite(e);
  };
  const rewriteStmt = (s: Stmt): Stmt => {
    switch (s.s) {
      case 'var':
        return {
          ...s,
          type: retype(s.type),
          ...(s.init !== undefined ? { init: rewrite(s.init) } : {}),
        };
      case 'assign':
      case 'assignOp':
        return { ...s, target: place(s.target), expr: rewrite(s.expr) };
      default:
        return mapStmtExpr(s, rewrite, rewriteStmt);
    }
  };

  const retypeFields = (s: StructDecl): StructDecl => ({
    ...s,
    fields: s.fields.map((f) => ({ ...f, type: retype(f.type) })),
  });
  return {
    ...m,
    // Each twin right after its block's struct, where the author declared the type.
    structs: m.structs.flatMap((s) => {
      const decl = retypeFields(s);
      const name = twin.get(s.name);
      return name === undefined ? [decl] : [decl, { ...decl, name }];
    }),
    consts: m.consts.map((c) => ({
      ...c,
      type: retype(c.type),
      ...(c.valueExpr !== undefined ? { valueExpr: rewrite(c.valueExpr) } : {}),
    })),
    ...(m.vars !== undefined
      ? {
          vars: m.vars.map((v) => ({
            ...v,
            type: retype(v.type),
            ...(v.init !== undefined ? { init: rewrite(v.init) } : {}),
          })),
        }
      : {}),
    ...(m.externs !== undefined
      ? { externs: m.externs.map((x) => ({ ...x, type: retype(x.type) })) }
      : {}),
    funcs: m.funcs.map((f) => ({
      ...f,
      params: f.params.map((p) => ({ ...p, type: retype(p.type) })),
      ret: retype(f.ret),
      body: f.body.map(rewriteStmt),
    })),
  };
}

/** The block structs the module holds as a value somewhere, in declaration order: named by a
 *  declaration's type (a parameter, a return, a `var`, a field of any struct or block, a module
 *  constant or variable), carried by an expression other than a read of the block itself, or
 *  read whole. */
function valueStructs(
  m: ModuleDecl,
  blockRead: (e: Expr) => string | undefined,
  blocks: ReadonlySet<string>,
): string[] {
  const named = new Set<string>();
  const see = (t: ShaderType): void => typeStructNames(t, named);
  // Each read of a block counts one for its struct, and each member read through one takes it
  // back. The walk visits every occurrence, so a struct left above zero has a read of its block
  // whole, however the IR shares its nodes.
  const wholeReads = new Map<string, number>();
  const count = (struct: string, by: number): void => {
    wholeReads.set(struct, (wholeReads.get(struct) ?? 0) + by);
  };
  const seeExpr = (e: Expr): void =>
    eachExpr(e, (x) => {
      const read = blockRead(x);
      if (read !== undefined) return count(read, 1);
      if (x.op === 'member') {
        const through = blockRead(x.base);
        if (through !== undefined) count(through, -1);
      }
      see(x.type);
    });
  const seeStmt = (s: Stmt): void => {
    if (s.s === 'var') see(s.type);
    eachStmtExpr(s, seeExpr, seeStmt);
  };
  for (const f of m.funcs) {
    for (const p of f.params) see(p.type);
    see(f.ret);
    for (const s of f.body) seeStmt(s);
  }
  for (const s of m.structs) for (const f of s.fields) see(f.type);
  for (const c of m.consts) {
    see(c.type);
    if (c.valueExpr !== undefined) seeExpr(c.valueExpr);
  }
  for (const v of m.vars ?? []) {
    see(v.type);
    if (v.init !== undefined) seeExpr(v.init);
  }
  for (const [struct, n] of wholeReads) if (n > 0) named.add(struct);
  return m.structs.map((s) => s.name).filter((n) => blocks.has(n) && named.has(n));
}

/** A twin name for each struct: `U_value`, numbered past any name the module already declares
 *  or can emit (Rule 3.5 keeps a generated name off both targets' reserved words as well). */
function twinNames(m: ModuleDecl, structs: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (structs.length === 0) return out;
  const taken = new Set<string>(RESERVED_WORDS);
  for (const c of m.consts) taken.add(c.name);
  for (const b of m.bindings) taken.add(b.name);
  for (const o of m.overrides ?? []) taken.add(o.name);
  for (const v of m.vars ?? []) taken.add(v.name);
  for (const x of m.externs ?? []) taken.add(x.spelling?.glsl ?? x.name);
  for (const s of m.structs) {
    taken.add(s.name);
    // A field of an entry's IO struct is a global varying too, `a_`-prefixed on a vertex input.
    for (const f of s.fields) taken.add(f.name).add(`a_${f.name}`);
  }
  // A parameter or a local of the name would hide the type inside its function.
  for (const f of m.funcs) {
    taken.add(f.name);
    for (const p of f.params) taken.add(p.name);
    collectLocals(f.body, taken);
  }
  for (const s of structs) {
    // No double underscore, which ANGLE refuses in any identifier: `Pad_` gives `Pad_value`.
    const base = s.endsWith('_') ? `${s}value` : `${s}_value`;
    let name = base;
    for (let i = 1; taken.has(name); i++) name = `${base}_${String(i)}`;
    taken.add(name);
    out.set(s, name);
  }
  return out;
}
