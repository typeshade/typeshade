import type { ShaderType } from './shader-type.js';

/** The `f32` scalar type, the DSL's default numeric type: what a bare numeric literal lifts to
 *  (`lift(3)` is a `Node<'f32'>`) and what most builtins (`sin`, `mix`, `length`, …) return. Use
 *  it to type an `fn` parameter, a `resource` or uniform field, or a struct field that must
 *  hold a native float; for emulated double precision use {@link f64T}.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const f32T = { kind: 'scalar', scalar: 'f32' } as const satisfies ShaderType;
/** The `i32` scalar type, the DSL's signed-integer type: the result type of the {@link i32}
 *  cast, and the type a non-integer {@link matchExpr} scrutinee is cast to before emit, since
 *  WGSL's `switch` only accepts integer scrutinees. Use it for signed-integer `fn` parameters
 *  and fields; for an unsigned count or index, prefer {@link u32T}.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const i32T = { kind: 'scalar', scalar: 'i32' } as const satisfies ShaderType;
/** The `u32` scalar type, the DSL's unsigned-integer type: counts, indices, and the compute and
 *  vertex builtins that are unsigned by spec (`builtin('vertex_index', u32T)`; the vector form
 *  is `builtin('global_invocation_id', vec3uT)`). Prefer it to {@link i32T} whenever the value
 *  can never be negative; the type then documents the invariant.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const u32T = { kind: 'scalar', scalar: 'u32' } as const satisfies ShaderType;
/** The `bool` scalar type: the type of every comparison (`.lt`, `.eq`, …) and logical (`.and`,
 *  `.or`) result, the required return type of a boolean-returning `fn`, and the type an
 *  {@link If} condition is checked against when the authoring code runs.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const boolT = { kind: 'scalar', scalar: 'bool' } as const satisfies ShaderType;

/** `atomic<u32>`: an unsigned 32-bit integer in storage memory that many invocations update
 *  at once through the `atomic*` builtins (`atomicAdd`, `atomicLoad`, ...). It is a location,
 *  not a value: it cannot be read, assigned or used in arithmetic directly.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const atomicU32T = { kind: 'atomic', elem: 'u32' } as const satisfies ShaderType;

/** `atomic<i32>`: the signed twin of {@link atomicU32T}.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const atomicI32T = { kind: 'atomic', elem: 'i32' } as const satisfies ShaderType;
/** The absent-value type: the return type of an `fn` whose body never returns a value (a
 *  statement-only vertex mutator, a compute entry point). Return-type inference falls back to
 *  it when it finds no `Return` in a body, so you rarely need to write it explicitly.
 *
 *  Exported from `typeshade/core/ir`.
 */
export const voidT = { kind: 'void' } as const satisfies ShaderType;
