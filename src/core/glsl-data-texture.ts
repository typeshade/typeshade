// ═══ The data texture a storage binding becomes on GLSL ES 3.00 (change 0046) ═══
//
// WebGL2 has no storage buffer, so the GLSL backend reads a `storage` array from a 2D data
// texture (`lowerStorageToDataTexture` in backends/glsl.ts), and the host allocates that texture.
// Its internal format has to match the sampler the lowering declares, or the texture is
// incomplete and every fetch reads zero with no error. This one function decides the format, so
// the sampler the GLSL declares and the `glslDataTexture` that `reflect()` reports cannot part.
//
// A struct element with an integer field reads every lane from R32UI: an integer lane as it is,
// a float lane through `uintBitsToFloat`. Through R32F and `floatBitsToUint` a small integer is a
// subnormal f32 pattern, which GLSL ES 3.00 §2.1.1 lets a driver flush (#484).

import type { StructDecl } from './ir/nodes.js';
import type { ShaderType } from './ir/types.js';

/** The internal format of a storage binding's GLSL ES 3.00 data texture. */
export type GlslDataTexture = 'r32f' | 'r32ui' | 'r32i';

/** The format for a binding of type `t`: an array of a scalar, a vector or a struct the
 *  emulation reads. `undefined` for any other shape, which the GLSL backend refuses. */
export function glslDataTextureOf(
  t: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
): GlslDataTexture | undefined {
  if (t.kind !== 'array') return undefined;
  const e = t.elem;
  const ofElem = (elem: string): GlslDataTexture | undefined =>
    elem === 'f32' ? 'r32f' : elem === 'u32' ? 'r32ui' : elem === 'i32' ? 'r32i' : undefined;
  if (e.kind === 'scalar') return ofElem(e.scalar);
  if (e.kind === 'vec') return ofElem(e.elem);
  if (e.kind === 'struct') {
    const sd = structs.get(e.name);
    if (!sd) return undefined;
    return structHasIntegerLane(sd) ? 'r32ui' : 'r32f';
  }
  return undefined;
}

/** Whether a struct has a `u32` or `i32` scalar field, which moves its texture to R32UI. */
export function structHasIntegerLane(sd: StructDecl): boolean {
  return sd.fields.some(
    (f) => f.type.kind === 'scalar' && (f.type.scalar === 'u32' || f.type.scalar === 'i32'),
  );
}
