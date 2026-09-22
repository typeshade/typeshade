// ═══ Shader DSL — the integer builtins whose portable spelling is a lie ═══
//
// `abs` and `dot` live in PORTABLE_INTRINSICS, the set whose members are claimed to spell the
// same on every target. That claim holds for floats, and for `abs` it holds for SIGNED
// integers too. It does not hold for an UNSIGNED `abs` or for an integer `dot` of either
// signedness: GLSL ES 3.00 has no `abs(uint)` and no integer `dot` at all, and a WebGL2 driver
// refuses both outright ("no matching overloaded function found", measured). Those three cases
// take their own registry ids — `absU`, `dotI`, `dotU` — which carry a GLSL column that exists.
//
// BOTH authoring surfaces have to make the same choice. The `"use typeshade"` front end lowers
// `abs(x)` from source and the `fn()` node graph builds it directly; when only one of them knew
// about the divergence, the other kept emitting `abs(uvec3)` and `dot(ivec3, ivec3)` (#154). So
// the rule lives here, over ShaderType alone, and each surface asks it.

import type { ShaderType } from './types.js'

/** The element scalar of a scalar or native vector type, or undefined for anything else (a
 *  matrix, an array, a struct, an emulated double). */
function elemOf(t: ShaderType | undefined): string | undefined {
  if (!t) return undefined
  return t.kind === 'scalar' ? t.scalar : t.kind === 'vec' ? t.elem : undefined
}

/** The id `abs` and `dot` take for the argument types they are given, and the id unchanged for
 *  every other call. `argType` is the first argument's type; `resultType` is what the call
 *  yields, which for `dot` is the element the operands share — WGSL's
 *  `dot(vecN<T>, vecN<T>)` is a `T`, so an integer result is an integer dot. */
export function divergentIntegerId(
  id: string,
  argType: ShaderType | undefined,
  resultType: ShaderType | undefined,
): string {
  // `absU` only: the SIGNED and float forms of `abs` are real GLSL and keep the portable name.
  if (id === 'abs') return elemOf(argType) === 'u32' ? 'absU' : id
  if (id === 'dot') {
    const elem = elemOf(resultType)
    return elem === 'i32' ? 'dotI' : elem === 'u32' ? 'dotU' : id
  }
  return id
}
