// === WGSL: a `mod` operand that holds a call is evaluated once, through a helper ===
//
// WGSL has no floor modulo, so `intrinsics.ts` spells `mod(x, y)` as `x - y * floor(x / y)`
// and writes each operand's TEXT twice. For a name or a literal that costs characters only.
// For an operand that holds a call it is two calls: the class-based Namek example emitted
// `((atan2(q.y, q.x) - start) - TAU * floor((atan2(q.y, q.x) - start) / TAU))` from one
// `mod(atan(q.y, q.x) - start, TAU)` (#841, N2). CSE cannot share it, because the copy is
// made by the spelling, after the optimizer has run, and the IR holds the operand once.
//
// So such a call goes through a helper whose parameters are the operands:
//
//   fn _mod_f32(x: f32, y: f32) -> f32 { return (x - y * floor(x / y)); }
//   … _mod_f32((atan2(q.y, q.x) - start), TAU) …
//
// A call evaluates each argument once, left to right, wherever it stands: in an `else if`
// condition, a loop header or the right side of `&&`, where a `let` before the statement would
// have run it on paths that never asked for it. The body is the same intrinsic with parameter
// operands, so the arithmetic and its grouping are what they were. GLSL ES 3.00 has a native
// `mod()` and the CPU backends read the IR, so neither sees any of this.
//
// A `mod` whose operands hold no call keeps the inline spelling, so its bytes do not move.

import type { Expr, FuncDecl, ModuleDecl } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { eachExpr } from '../ir/visit.js';
import { mapStmt } from '../passes/opt/ir-transform.js';

const holdsCall = (e: Expr): boolean => {
  let found = false;
  eachExpr(e, (x) => {
    if (x.op === 'call') found = true;
  });
  return found;
};

/** The part of a helper's name one operand type contributes: `f32`, `v3f32`. Undefined for a
 *  type `mod` does not take, which leaves the call as it was. */
const typeTag = (t: ShaderType): string | undefined =>
  t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? `v${String(t.n)}${t.elem}` : undefined;

/** Route every `mod` call with a call in an operand through a helper that evaluates each operand
 *  once. A call that carries a `declRef` calls the module's own `mod`, as `resolvedOwnFns` in
 *  emit.ts reads it, and is left alone. Identity for a module with no such call. */
export function modOperandsOnce(m: ModuleDecl): ModuleDecl {
  const taken = new Set<string>([
    ...m.consts.map((d) => d.name),
    ...m.structs.map((d) => d.name),
    ...m.bindings.map((d) => d.name),
    ...m.funcs.map((d) => d.name),
    ...(m.vars ?? []).map((d) => d.name),
    ...(m.externs ?? []).map((d) => d.name),
    ...(m.overrides ?? []).map((d) => d.name),
  ]);
  const helpers = new Map<string, FuncDecl>();
  const helperFor = (x: ShaderType, y: ShaderType, tags: string): FuncDecl => {
    const have = helpers.get(tags);
    if (have !== undefined) return have;
    let name = `_mod_${tags}`;
    for (let n = 1; taken.has(name); n++) name = `_mod_${tags}_${String(n)}`;
    taken.add(name);
    const helper: FuncDecl = {
      name,
      params: [
        { name: 'x', type: x },
        { name: 'y', type: y },
      ],
      ret: x,
      body: [
        {
          s: 'return',
          expr: {
            op: 'call',
            type: x,
            fn: 'mod',
            args: [
              { op: 'param', type: x, name: 'x' },
              { op: 'param', type: y, name: 'y' },
            ],
          },
        },
      ],
    };
    helpers.set(tags, helper);
    return helper;
  };
  const route = (e: Expr): Expr => {
    if (e.op !== 'call' || e.fn !== 'mod' || e.declRef !== undefined || e.args.length !== 2)
      return e;
    const [x, y] = e.args as [Expr, Expr];
    if (!holdsCall(x) && !holdsCall(y)) return e;
    const tx = typeTag(x.type);
    const ty = typeTag(y.type);
    if (tx === undefined || ty === undefined) return e;
    const helper = helperFor(x.type, y.type, tx === ty ? tx : `${tx}_${ty}`);
    return { op: 'call', type: e.type, fn: helper.name, args: [x, y], declRef: helper };
  };
  const funcs = m.funcs.map((f) => ({ ...f, body: f.body.map((s) => mapStmt(s, route)) }));
  if (helpers.size === 0) return m;
  return { ...m, funcs: [...helpers.values(), ...funcs] };
}
