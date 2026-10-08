// ═══ What an operation does with each of its operands (#348) ═══
//
// Every analysis that asks "does this read that array" used to answer it with a walker of its
// own, and each walker learned the exceptions separately. `arrayLength(xs)` reads the length of
// `xs`, which the host fixes when it binds the buffer, and no element: the Rule 7.5 bound check
// learned that first, then uniformity and the kernel lowering, and the kernel proof never did,
// so a loop that read `out.length` while writing `out` ran on the CPU (#345). An atomic's first
// argument and `textureStore`'s texture are places the call writes, which the proof and the
// lowering each spelled out by name.
//
// This file is the one answer: a table of how each builtin uses each argument, and
// `eachOperand`, which hands an analysis the operands of one expression with that access. The
// atomics come from `ATOMIC_INTRINSICS`, and the rest is two rows; every other argument is read
// for its value, `workgroupUniformLoad`'s pointer included. It is small on purpose:
// the kernel proof is in the bundle of `typeshade/compute` and of every CPU backend, which must
// not carry Tint's overload table. `spec-conformance/argument-access.test.ts` holds it to that
// table instead: every supported row that takes a pointer or writes a texture is here, with the
// access its parameter types say.

import type { Expr } from '../ir/nodes.js';
import { mapChildren } from '../ir/visit.js';
import { ATOMIC_INTRINSICS } from '../intrinsics.js';

/** How an expression uses one of its operands. */
export type Access =
  /** Evaluated for its value: a place is read. Every operand but the ones below. */
  | 'value'
  /** The runtime-sized array `arrayLength` measures: its length, fixed when the host binds the
   *  buffer, and none of its elements. */
  | 'length'
  /** An atomic's place, read (`atomicLoad`). */
  | 'atomic-load'
  /** An atomic's place, written (`atomicStore`). */
  | 'atomic-store'
  /** An atomic's place, read and written in one step: every other atomic builtin. */
  | 'atomic-update'
  /** The storage texture `textureStore` writes one texel of, at the coordinate it is given. */
  | 'texel-write';

/** The access of each leading argument of the builtins that do not only read their arguments;
 *  an argument past the listed ones, and every argument of any other call, is a `value`. */
const ARGUMENTS: ReadonlyMap<string, readonly Access[]> = new Map<string, readonly Access[]>([
  ...Object.entries(ATOMIC_INTRINSICS).map(([name, sig]): [string, readonly Access[]] => [
    name,
    [sig.returns === 'void' ? 'atomic-store' : sig.arity === 1 ? 'atomic-load' : 'atomic-update'],
  ]),
  ['arrayLength', ['length']],
  ['textureStore', ['texel-write']],
]);

/** The builtins the table lists, each with the access of its leading arguments. The test that
 *  holds the table to Tint's overloads reads it; an analysis asks {@link argAccess}. */
export const ARGUMENT_ACCESS: ReadonlyMap<string, readonly Access[]> = ARGUMENTS;

/** How the builtin `fn` uses its argument at `index`: `value` unless the table says otherwise. */
export function argAccess(fn: string, index: number): Access {
  return ARGUMENTS.get(fn)?.[index] ?? 'value';
}

/** How the call `call` uses its argument at `index`. A call that carries a `declRef` reaches a
 *  function the module declares, which wins over the builtin of its name (Rule 9.5): it reads
 *  each argument for its value, whatever the builtin of that name does with it. A declared
 *  `atomicAdd(a: f32, b: f32)` reads `xs[i]` and writes no atomic. */
export function callArgAccess(call: Expr & { op: 'call' }, index: number): Access {
  return call.declRef !== undefined ? 'value' : argAccess(call.fn, index);
}

/** Whether an access is to an atomic's place. */
export const isAtomicAccess = (a: Access): boolean =>
  a === 'atomic-load' || a === 'atomic-store' || a === 'atomic-update';

/** Whether an access writes its place: an atomic store or update, or a texel write. */
export const writesPlace = (a: Access): boolean =>
  a === 'atomic-store' || a === 'atomic-update' || a === 'texel-write';

/** Whether an access reads an atomic's place, which makes the value the call returns depend on
 *  the order of the invocations: every atomic but a store. */
export const readsAtomic = (a: Access): boolean => a === 'atomic-load' || a === 'atomic-update';

/** Visit each direct operand of `e`, with how `e` uses it. A call's arguments take their access
 *  from the table (a call to a module function passes `value` for each, `inout` being the
 *  caller's own fact about its callee, and so does a call through a declaration named like a
 *  builtin, {@link callArgAccess}); every other operand is a `value`. */
export function eachOperand(e: Expr, visit: (operand: Expr, access: Access) => void): void {
  if (e.op === 'call') {
    e.args.forEach((a, k) => visit(a, callArgAccess(e, k)));
    return;
  }
  mapChildren(e, (c) => {
    visit(c, 'value');
    return c;
  });
}
