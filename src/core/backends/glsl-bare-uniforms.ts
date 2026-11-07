// Private single-member blocks for bare uniform values (change 0127). The authored module,
// reflection and host layout retain the original scalar/vector/matrix type. Only GLSL reads
// the value through a member of the block. Run after fp64 lowering and IR plugins.
import type { Expr, ModuleDecl, Stmt, StructDecl } from '../ir/index.js';
import { structT } from '../ir/index.js';
import { mapChildren, mapStmtExpr } from '../ir/visit.js';
import { bodyHasRaw } from '../passes/opt/expr-utils.js';
import { UnsupportedFeatureError } from '../backend.js';
import type { TargetSpellings } from '../spelling-plan.js';

export function lowerBareUniforms(m: ModuleDecl, plan: TargetSpellings): ModuleDecl {
  const names = new Map(
    [...plan.uniformBlocks].map(([name, spelling]) => [plan.bindings.get(name) ?? name, spelling]),
  );
  const blocks = new Map<string, { block: string; member: string }>();
  const structs: StructDecl[] = [];
  const bindings = m.bindings.map((b) => {
    if (
      b.space !== 'uniform' ||
      b.owner === 'host' ||
      !(
        (b.type.kind === 'scalar' && b.type.scalar !== 'bool') ||
        (b.type.kind === 'vec' && b.type.elem !== 'bool') ||
        (b.type.kind === 'mat' && b.type.elem === 'f32' && b.type.rows !== 2)
      )
    )
      return b;
    const spelling = names.get(b.name);
    if (spelling === undefined)
      throw new UnsupportedFeatureError(
        `glsl-es300: uniform binding '${b.name}' has no block spelling`,
      );
    blocks.set(b.name, spelling);
    structs.push({ name: spelling.block, fields: [{ name: spelling.member, type: b.type }] });
    return { ...b, type: structT(spelling.block) };
  });
  if (blocks.size === 0) return m;
  if (m.funcs.some((f) => bodyHasRaw(f.body)))
    throw new UnsupportedFeatureError(
      'glsl-es300: a bare uniform needs a block member, but raw statements cannot be rewritten',
    );

  // Resolve a varref in its lexical scope. A parameter or local with the same spelling is
  // its own value, including a local in only one arm or a counted-loop header.
  const expr = (e: Expr, shadowed: ReadonlySet<string>): Expr => {
    if (e.op === 'varref' && !shadowed.has(e.name)) {
      const block = blocks.get(e.name);
      if (block !== undefined)
        return {
          op: 'member',
          type: e.type,
          field: block.member,
          base: { ...e, type: structT(block.block) },
        };
    }
    return mapChildren(e, (c) => expr(c, shadowed));
  };
  const body = (statements: readonly Stmt[], outer: ReadonlySet<string>): Stmt[] => {
    const scope = new Set(outer);
    return statements.map((s) => {
      const out = statement(s, scope);
      if (s.s === 'let' || s.s === 'var') scope.add(s.name);
      return out;
    });
  };
  const statement = (s: Stmt, scope: ReadonlySet<string>): Stmt => {
    if (s.s === 'if')
      return {
        ...s,
        arms: s.arms.map((a) => ({ cond: expr(a.cond, scope), body: body(a.body, scope) })),
        ...(s.elseBody === undefined ? {} : { elseBody: body(s.elseBody, scope) }),
      };
    if (s.s === 'switch')
      return {
        ...s,
        scrut: expr(s.scrut, scope),
        cases: s.cases.map((c) => ({ ...c, body: body(c.body, scope) })),
        ...(s.defaultBody === undefined ? {} : { defaultBody: body(s.defaultBody, scope) }),
      };
    if (s.s === 'for') {
      const loop = new Set(scope);
      if (s.init.s === 'let' || s.init.s === 'var') loop.add(s.init.name);
      return {
        ...s,
        init: statement(s.init, scope),
        cond: expr(s.cond, loop),
        update: statement(s.update, loop),
        body: body(s.body, loop),
      };
    }
    return mapStmtExpr(s, (e) => expr(e, scope));
  };
  return {
    ...m,
    structs: [...m.structs, ...structs],
    bindings,
    funcs: m.funcs.map((f) => ({ ...f, body: body(f.body, new Set(f.params.map((p) => p.name))) })),
  };
}
