import type { ShaderType } from './shader-type.js';

/** The struct `atomicCompareExchangeWeak` answers (#152, wgsl.txt:25584): the contents the
 *  location held BEFORE the call, and whether the exchange happened. WGSL calls the type
 *  `__atomic_compare_exchange_result<T>` and gives no way to write that name — measured on
 *  Tint, a variable declared with it is "invalid type for variable declaration" — so the
 *  result is bound by inference and its fields read.
 *
 *  It is a struct the IR TYPES and no backend DECLARES: WGSL's is built in, so emitting a
 *  `struct` for it would shadow the builtin one, and the emitted code never names the type
 *  (`let r = atomicCompareExchangeWeak(&x, a, b);` infers it). That is why these two decls are
 *  constants here rather than entries in a module's `structs`.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const CAS_RESULT_STRUCTS: readonly {
  readonly name: string;
  readonly fields: readonly { readonly name: string; readonly type: ShaderType }[];
}[] = [
  {
    name: '__atomic_compare_exchange_result_u32',
    fields: [
      { name: 'old_value', type: { kind: 'scalar', scalar: 'u32' } },
      { name: 'exchanged', type: { kind: 'scalar', scalar: 'bool' } },
    ],
  },
  {
    name: '__atomic_compare_exchange_result_i32',
    fields: [
      { name: 'old_value', type: { kind: 'scalar', scalar: 'i32' } },
      { name: 'exchanged', type: { kind: 'scalar', scalar: 'bool' } },
    ],
  },
];

/** The {@link CAS_RESULT_STRUCTS} type for one atomic element kind.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const casResultT = (elem: 'u32' | 'i32'): ShaderType => ({
  kind: 'struct',
  name: `__atomic_compare_exchange_result_${elem}`,
});
