/** Turns a `ShaderType` literal into the precise string key that {@link Node} carries as its
 *  compile-time phantom: `KeyOf<typeof vec3fT>` resolves to `'vec3<f32>'`, so a `vec2` and
 *  `vec3` operand mismatch fails `tsc` before the runtime `SD0002` check in {@link typeKey} and
 *  {@link typeEq} would catch it. It narrows only against a `T` that kept its literal shape
 *  (the `as const satisfies ShaderType` constants in this module, or a {@link structT} or
 *  {@link arrayT} result); a widened `ShaderType` collapses to the `string` fallback. Every arm
 *  mirrors one `case` of {@link typeKey}, and a new `ShaderType` variant needs an arm in both.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @typeParam T The `ShaderType` (or a subset of it) to resolve a key for.
 */
export type KeyOf<T> = T extends { kind: 'scalar'; scalar: infer S extends string }
  ? S
  : T extends { kind: 'f64' }
    ? 'f64'
    : T extends { kind: 'vec64'; n: infer N extends number }
      ? `vec${N}<f64>`
      : T extends { kind: 'vec'; n: infer N extends number; elem: infer E extends string }
        ? `vec${N}<${E}>`
        : T extends {
              kind: 'mat';
              cols: infer C extends number;
              rows: infer R extends number;
              elem: infer E extends string;
            }
          ? `mat${C}x${R}<${E}>`
          : T extends { kind: 'struct'; name: infer N extends string }
            ? `struct:${N}`
            : T extends { kind: 'array'; elem: infer E; size: infer S }
              ? S extends number
                ? `array<${KeyOf<E>},${S}>`
                : `array<${KeyOf<E>}>`
              : T extends { kind: 'atomic'; elem: infer E extends string }
                ? `atomic<${E}>`
                : T extends { kind: 'void' }
                  ? 'void'
                  : T extends { kind: 'texture'; dim: '2d-ms'; elem: infer E extends string }
                    ? `texture_multisampled_2d<${E}>`
                    : T extends { kind: 'texture'; dim: '2d-array'; elem: infer E extends string }
                      ? `texture_2d_array<${E}>`
                      : T extends { kind: 'texture'; dim: '2d'; elem: infer E extends string }
                        ? `texture_2d<${E}>`
                        : T extends { kind: 'texture'; dim: 'cube'; elem: infer E extends string }
                          ? `texture_cube<${E}>`
                          : T extends { kind: 'texture'; dim: '3d'; elem: infer E extends string }
                            ? `texture_3d<${E}>`
                            : T extends { kind: 'texture'; dim: '1d'; elem: infer E extends string }
                              ? `texture_1d<${E}>`
                              : T extends {
                                    kind: 'texture';
                                    dim: 'cube-array';
                                    elem: infer E extends string;
                                  }
                                ? `texture_cube_array<${E}>`
                                : T extends { kind: 'sampler' }
                                  ? 'sampler'
                                  : string;
/** Element key of a vector key (`vec3<u32>` → `u32`); identity for scalars. */
export type ElemKey<K extends string> = K extends `vec${number}<${infer E}>` ? E : K;

type DropArraySize<S extends string> = S extends `${infer A},${infer B}`
  ? B extends `${number}`
    ? A
    : `${A},${DropArraySize<B>}`
  : S;

/** Element key of an array key: `array<f32,4>` → `'f32'`, `array<vec3<f32>>` → `'vec3<f32>'`,
 *  and `never` for a key that is not an array. It is the inverse of the `array` arm of
 *  {@link KeyOf}, and it is what lets `xs.at(i)` know the element type without being told
 *  again — the declaration already said it.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 *
 *  @typeParam K The array key to take the element of.
 */
export type ArrayElemKey<K extends string> = K extends `array<${infer Inner}>`
  ? DropArraySize<Inner>
  : never;
/** The key form of {@link Scalar} without `'bool'`: the set accepted wherever the DSL needs an
 *  indexable or comparable native scalar, such as array indices (`.at(i, elem)`), bitwise-op
 *  operands, and {@link matchExpr} or {@link Switch} scrutinees. `'f64'` and `'bool'` are
 *  excluded because a `Switch` scrutinee must become a WGSL `switch`, which only accepts
 *  integer cases, and an array index or bit-op operand is never boolean.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export type ScalarKey = 'f32' | 'i32' | 'u32';
