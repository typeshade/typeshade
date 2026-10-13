// ═══ The workgroup of a kernel function's loops (proposal 0067) ═══
//
// A kernel function may declare `@workgroup_size([n])`. The front end records the extent in
// `kernelWorkgroups`, and the lowering (`passes/kernel-lower.ts`) runs each loop that does not
// reduce at it. The record is a side table, not a field of `FuncDecl`, since the shape of that
// type is a public export (`src/__api__/surface.md`), and a kernel function is no entry.
//
// A map loop's `@compute` entry starts by numbering its invocation, `_k`, from the workgroup and
// the dispatch: `gid.x + gid.y * (nwg.x * wg)`, where `wg` is the workgroup size of the entry. The
// lowering writes it for the size the function declares, and the fuse planner (`fuse-entry.ts`)
// writes it again for the size of a fused group, which may differ from the size its first call
// was built at. Both read the statement from here, so the number is one.
//
// It is the one piece of IR the runtime builds, and it imports only the IR's types.

import type { Expr, FuncDecl, Stmt } from './ir/nodes.js';
import type { ShaderType } from './ir/types.js';
import { u32T } from './ir/types.js';

/** The extent of each kernel function's `@workgroup_size([n])`, keyed by the function the front end
 *  built. A function with none is absent, and its loops run at `KERNEL_WORKGROUP`. */
export const kernelWorkgroups = new WeakMap<FuncDecl, number>();

export const vec3u: ShaderType = { kind: 'vec', n: 3, elem: 'u32' };
export const u = (n: number): Expr => ({ op: 'lit', type: u32T, value: n });
export const x = (v: Expr): Expr => ({ op: 'member', type: u32T, base: v, field: 'x' });
export const y = (v: Expr): Expr => ({ op: 'member', type: u32T, base: v, field: 'y' });
export const bin = (bop: '+' | '*', a: Expr, b: Expr): Expr => ({
  op: 'binop',
  type: u32T,
  bop,
  a,
  b,
});
export const gid: Expr = { op: 'param', type: vec3u, name: '_gid' };
export const nwg: Expr = { op: 'param', type: vec3u, name: '_nwg' };

/** `_k = gid.x + gid.y * (nwg.x * wg)`: a dispatch past 65535 workgroups spills into y. It is the
 *  first statement of a map loop's entry. */
export function invocationIndex(wg: number): Stmt {
  return {
    s: 'let',
    name: '_k',
    expr: bin('+', x(gid), bin('*', y(gid), bin('*', x(nwg), u(wg)))),
  };
}
