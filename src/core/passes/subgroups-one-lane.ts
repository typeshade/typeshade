// ═══ A subgroup of one invocation, for GLSL ES 3.00 (change 0117, Rule 11.21) ═══
//
// GLSL ES 3.00 has no subgroups. Rule 11.21 gives that target the meaning the CPU oracle has:
// a subgroup is one invocation, so a fold of the lanes' values is the lane's own value, a scan
// before it is the operator's identity, a vote is the lane's own bool, a ballot has one bit,
// the one lane is elected, and a broadcast or a shuffle from any lane gives the lane's own
// value. The determinism report lists what that meaning cannot keep (`passes/determinism.ts`):
// a float fold's order, and a read of another lane.
//
// The rewrite runs before the GLSL writer, on the module's functions, and each call becomes
// an expression the writer already spells: the argument itself, a literal of its type, a
// vector constructor, or a cast. `INTRINSICS`'s GLSL column for these ids throws, so a call
// that reaches the writer is one this pass did not see. The oracle's own table
// (`cpu-runtime.ts`) gives the same values without this pass, and the GPU differential holds
// the two to each other on an integer fold.
//
// The built-in values take the same meaning in the writers themselves: `subgroup_invocation_id`
// is 0 and `subgroup_size` 1 on a fragment input (`backends/glsl.ts`), and the compute lowering
// gives `subgroup_id` the local invocation index and `num_subgroups` the workgroup's size
// (`passes/gl-compute.ts`).

import type { Expr, FuncDecl, ModuleDecl } from '../ir/index.js';
import type { ShaderType } from '../ir/types.js';
import { boolT, u32T, vec4uT } from '../ir/types.js';
import { eachExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { SUBGROUP_INTRINSICS } from '../intrinsics.js';

/** The literal `value` in every lane of `t`: a scalar, or a vector of the scalar. */
function fill(t: ShaderType, value: number): Expr {
  if (t.kind === 'vec') {
    const elem: ShaderType = { kind: 'scalar', scalar: t.elem };
    return {
      op: 'construct',
      type: t,
      args: new Array<Expr>(t.n).fill({ op: 'lit', type: elem, value }),
    };
  }
  return { op: 'lit', type: t, value };
}

/** The one-lane value of a subgroup call, by Rule 11.21's table. */
function oneLane(e: Extract<Expr, { op: 'call' }>): Expr {
  const x = e.args[0];
  switch (e.fn) {
    case 'subgroupExclusiveAdd':
      return fill(e.type, 0);
    case 'subgroupExclusiveMul':
      return fill(e.type, 1);
    case 'subgroupBallot':
      // One lane, bit 0 of the first word: `vec4<u32>(u32(p), 0, 0, 0)`.
      return {
        op: 'construct',
        type: vec4uT,
        args: [
          {
            op: 'call',
            type: u32T,
            fn: 'u32',
            args: [x ?? { op: 'lit', type: boolT, value: false }],
          },
          { op: 'lit', type: u32T, value: 0 },
          { op: 'lit', type: u32T, value: 0 },
          { op: 'lit', type: u32T, value: 0 },
        ],
      };
    case 'subgroupElect':
      return { op: 'lit', type: boolT, value: true };
    default:
      // A fold, an inclusive scan, a vote, a broadcast or a shuffle: the lane's own value. The
      // lane argument of a broadcast or a shuffle is dropped with the lanes it named.
      if (x === undefined) throw new Error(`subgroups-one-lane: ${e.fn} with no argument`);
      return x;
  }
}

/** Whether `e` or a descendant is a subgroup built-in function call. */
function mentions(e: Expr): boolean {
  let found = false;
  eachExpr(e, (c) => {
    if (c.op === 'call' && c.declRef === undefined && SUBGROUP_INTRINSICS.has(c.fn)) found = true;
  });
  return found;
}

/** Every subgroup call of `e`, children first, rewritten to its one-lane value. A call through
 *  a declaration is the module's own function of that name (Rule 9.5) and stays.
 *
 *  A subtree with no subgroup call is returned as the same object: `autoVars` runs after this
 *  pass and reads an assigned binding by the identity of its expression (`opt/auto-vars.ts`),
 *  so a clone of an untouched expression would orphan every later read of it. */
function rewrite(e: Expr): Expr {
  if (!mentions(e)) return e;
  const mapped = mapChildren(e, rewrite);
  if (mapped.op === 'call' && mapped.declRef === undefined && SUBGROUP_INTRINSICS.has(mapped.fn))
    return oneLane(mapped);
  return mapped;
}

/** `f` with its subgroup calls rewritten, or `f` itself when its body has none. */
function lowerFunction(f: FuncDecl): FuncDecl {
  let touched = false;
  const body = f.body.map((s) =>
    mapStmtExpr(s, (e) => {
      const out = rewrite(e);
      if (out !== e) touched = true;
      return out;
    }),
  );
  return touched ? { ...f, body } : f;
}

/** `m` with every subgroup built-in function call replaced by its one-lane value (Rule 11.21),
 *  or `m` itself when it calls none. */
export function lowerSubgroupsToOneLane(m: ModuleDecl): ModuleDecl {
  const funcs = m.funcs.map(lowerFunction);
  return funcs.some((f, i) => f !== m.funcs[i]) ? { ...m, funcs } : m;
}
