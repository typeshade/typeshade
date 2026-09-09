// ═══ Shader DSL — call-by-name node factory (internal) ═══
//
// The one place a `call` Expr with a bare function-name string is built. fn()'s handle and
// externFn() both route through it (see makeCallFactory in builder.ts).
//
// Deliberately NOT in the `core/ir` barrel: it is the primitive under the typed call forms,
// not authoring surface. Authors call the `FnHandle` that `fn()` returns, or `externFn()` for
// a function the module does not define; both check argument names and types at `tsc` time,
// where this form checks nothing.

import type { ShaderType, KeyOf } from './types.js'
import { Node, lift, type NodeLike } from './node.js'

/** Build a call node for the function `name`, with the return type given explicitly. The
 *  WGSL backend emits `name(args)`; the CPU backend dispatches through its compiled function
 *  table. Nothing about the callee is checked here: the typed call factories that wrap this
 *  own that check. */
export function callFn<T extends ShaderType>(
  name: string,
  ret: T,
  ...args: NodeLike[]
): Node<KeyOf<T>> {
  return new Node<KeyOf<T>>({
    op: 'call',
    type: ret,
    fn: name,
    args: args.map((a) => lift(a).expr),
  })
}
