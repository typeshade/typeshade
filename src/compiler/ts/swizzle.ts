// === Vector swizzle validation (matches EDSL Node.swizzle / WGSL) ===

import type { ShaderType } from '../../core/ir/types.js'
import { f32T, i32T, u32T } from '../../core/ir/types.js'
import { typeKey } from '../../core/ir/types.js'

const VEC_FIELD_INDEX: Readonly<Record<string, number>> = { x: 0, y: 1, z: 2, w: 3 }
const SWIZZLE_ALIAS: Readonly<Record<string, string>> = { r: 'x', g: 'y', b: 'z', a: 'w' }

export type SwizzleOk = { readonly ok: true; readonly type: ShaderType; readonly field: string }
export type SwizzleErr = { readonly ok: false; readonly message: string }
export type SwizzleResult = SwizzleOk | SwizzleErr

export function parseSwizzle(base: ShaderType, comps: string): SwizzleResult {
  if (base.kind !== 'vec') {
    return { ok: false, message: `.${comps} on ${typeKey(base)} — swizzle requires vec2/vec3/vec4.` }
  }
  if (comps.length < 1 || comps.length > 4) {
    return { ok: false, message: `.${comps} — a swizzle takes 1–4 components.` }
  }
  let family: 'xyzw' | 'rgba' | undefined
  for (const c of comps) {
    const fam: 'xyzw' | 'rgba' = SWIZZLE_ALIAS[c] !== undefined ? 'rgba' : 'xyzw'
    if (family !== undefined && fam !== family) {
      return {
        ok: false,
        message: `.${comps} mixes xyzw and rgba sets (WGSL forbids, e.g. ".xg").`,
      }
    }
    family = fam
    const canon = SWIZZLE_ALIAS[c] ?? c
    const idx = VEC_FIELD_INDEX[canon]
    if (idx === undefined) {
      return { ok: false, message: `.${comps} — '${c}' is not a component (xyzw / rgba).` }
    }
    if (idx >= base.n) {
      return { ok: false, message: `.${comps} out of range on ${typeKey(base)}.` }
    }
  }
  const elem: ShaderType = base.elem === 'i32' ? i32T : base.elem === 'u32' ? u32T : f32T
  const type: ShaderType =
    comps.length === 1 ? elem : { kind: 'vec', n: comps.length as 2 | 3 | 4, elem: base.elem }
  return { ok: true, type, field: comps }
}
