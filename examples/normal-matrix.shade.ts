"use typeshade"

// Matrices beyond `mat4` (§40). Every `matCxR` is a type here, so the shape a renderer
// actually wants can be said rather than padded: a NORMAL matrix is 3×3, and carrying it as a
// `mat4` costs a column and a row of zeroes per draw and invites the wrong multiply.
//
// The constructs this exercises, all of which were refused before #149:
//
//   `mat3(m)`            truncation — the upper-left 3×3 of the model matrix, which is the
//                        normal matrix when the model has no non-uniform scale
//   `mat3(a, b, c)`      from columns, and `mat2x3(...)` from components
//   `transpose(m2x3)`    on a NON-SQUARE shape, which yields a `mat3x2`
//   `determinant(m3)`    on a 3×3 — the handedness of the basis, negative when the model
//                        mirrors, which is what decides whether the normal has to be flipped
//   `m * s`, `s * m`     component-wise scaling
//   `v * m`              the row-vector product, which is `transpose(m) * v` — the spelling a
//                        renderer reaches for to avoid building the transpose
//
// WHY THE UNIFORM IS A mat4 AND NOT A mat4x2. Measured on real ANGLE and Tint: std140 rounds
// every matrix column up to 16 bytes, while WGSL's column stride is AlignOf(vecR<f32>) — 8
// when the matrix has two ROWS. So mat2x2, mat3x2 and mat4x2 lay out differently on the two
// targets and `reflect()` could not describe one honestly; a two-row matrix in a uniform
// block is refused with those numbers. Every other shape agrees byte for byte, which is why
// the `mat3` below rides in the block without ceremony.

class Uniforms {
  model: mat4
  // A 3×3 in std140: three columns, each a vec3 padded to 16 bytes — the same 48 bytes WGSL
  // gives it. This is the shape the refusal above is NOT about.
  tint: mat3
}

declare const u: uniform<Uniforms>

class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
  @location(1) normal: vec3
}

/** The normal matrix: the model's upper-left 3×3. Truncation, not padding. */
export function normalMatrix(model: mat4): mat3 {
  return mat3(model)
}

@vertex
export function vs(@builtin("vertex_index") idx: u32): VsOut {
  const x = f32(idx & 1) * 4. - 1.
  const y = f32(idx >> 1) * 4. - 1.
  const n = normalMatrix(u.model)
  // A handedness flip: `determinant` on a 3×3, which no shape but a square one has.
  const handed: f32 = determinant(n) < 0. ? -1. : 1.
  // `m * v` is the column-vector product; the normal rides it.
  // Annotated for the same reason `hello-uniform-struct` annotates its local: TypeScript
  // types arithmetic on a branded matrix or vector as `number`, so a product needs to be told
  // what it is. The compiler knows; only the editor needs the note.
  const normal: vec3 = n * vec3(0., 0., handed)
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5), normal: normal }
}

@fragment
export function fs(vo: VsOut): vec4 {
  // From columns, and scaled either way round — `m * s` and `s * m` are both the spec's
  // component-wise scaling and both emit as written.
  const basis = mat3(vec3(1., 0., 0.), vec3(0., 1., 0.), vec3(0., 0., 1.))
  const scaled: mat3 = 0.5 * basis * 2.
  // A NON-SQUARE matrix and its transpose: mat2x3 (2 columns of 3) becomes mat3x2.
  const wide = mat2x3(vo.uv.x, vo.uv.y, 1., vo.uv.y, vo.uv.x, 1.)
  const tall: mat3x2 = transpose(wide)
  // `v * m` is the row-vector product: a vec3 against a mat2x3 gives a vec2.
  const row: vec2 = vo.normal * wide
  // And the column form on the transpose gives the same two numbers, COMPONENT FOR COMPONENT:
  // `v * M == transpose(M) * v`. So `row.y - col.y` is the residual of that identity and is 0
  // for every input; `row.y - col.x` would compare two different components and only happens
  // to vanish when the vector makes them equal. `examples/normal-matrix.test.ts` evaluates
  // this function on the CPU oracle and pins the residual at exactly 0.
  const col: vec2 = tall * vo.normal
  const rgb: vec3 = scaled * u.tint * vec3(row.x, col.y, abs(row.y - col.y))
  return vec4(rgb, 1.)
}
