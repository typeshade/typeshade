// GLSL ES 3.00 needs a type declared before its first use, and WGSL does not, so the GLSL writer
// is the one that can emit a valid program in an invalid order. Measured on ANGLE (the compile
// gate's WebGL2): a module constant of a struct type written above the struct is `'[' : syntax
// error`, and a struct-typed top-level `let` above it is `'Cursor' : syntax error` (#179), on
// both stages. The struct section now comes before the constants and the module variables.

import { describe, expect, it } from 'vitest'
import { compile } from '../../compiler/ts/compile.js'

const STAGES = `
class VsOut {
  @builtin("position") pos: vec4
  @location(0) uv: vec2
}
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & u32(1)) * 4. - 1.
  const y = f32(vi >> u32(1)) * 4. - 1.
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x, y) }
}`

/** Every struct declaration comes before the first line that names the struct otherwise. */
function declaredBeforeUse(glsl: string, struct: string): void {
  const decl = glsl.indexOf(`struct ${struct} {`)
  expect(decl, `struct ${struct} is declared`).toBeGreaterThan(-1)
  const firstUse = glsl.search(new RegExp(`\\b${struct}\\b(?! \\{)`))
  expect(firstUse, `${struct} is used after its declaration`).toBeGreaterThan(decl)
}

describe('GLSL: a struct is declared before a module constant or variable of its type', () => {
  it('a constant array of structs (a scene table)', () => {
    const r = compile(`"use typeshade"
class Sphere {
  center: vec3
  radius: f32
}
const SPHERES: array<Sphere, 2> = [
  { center: vec3(0.), radius: 1. },
  { center: vec3(1.), radius: 0.5 },
]
${STAGES}
@fragment
export function fs(v: VsOut): vec4 {
  return vec4(SPHERES[i32(v.uv.x > 0.)].radius)
}`)
    expect(r.diagnostics).toEqual([])
    for (const glsl of [r.glsl!.vertex, r.glsl!.fragment]) declaredBeforeUse(glsl, 'Sphere')
  })

  it('a struct-typed top-level let (#179)', () => {
    const r = compile(`"use typeshade"
interface Cursor {
  at: vec2
  hits: u32
}
let cur: Cursor
${STAGES}
@fragment
export function fs(v: VsOut): vec4 {
  cur.hits = cur.hits + 1
  cur.at = v.uv
  return vec4(f32(cur.hits), cur.at.x, 0., 1.)
}`)
    expect(r.diagnostics).toEqual([])
    // Both stages: the variable is emitted into the vertex shader too, although only the
    // fragment entry reads it, so its struct has to be declared there as well.
    for (const glsl of [r.glsl!.vertex, r.glsl!.fragment]) declaredBeforeUse(glsl, 'Cursor')
  })
})
