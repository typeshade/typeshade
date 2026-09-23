// Generics by monomorphisation (roadmap 0.3 item T9, #92). WGSL and GLSL ES 3.00 have no
// generics: a function has one signature. TypeScript has them and a shader author reaches for
// them, so a generic declaration is compiled once per set of argument types the file uses it
// with. `pick<T>` called on an f32 and on a vec3 emits `pick_f32` and `pick_vec3`.
//
// The substitution is not an AST rewrite. A type parameter is a NAME, and `type-map.ts` is the
// one place a name becomes a `ShaderType`, so an instantiation binds `T` there and lowers the
// declaration's own nodes unchanged.
//
// Every spelling below type-checks under `tsc` with the ambient lib as well as compiling here —
// the lesson T8 taught, checked through `src/language-service/ambient.test.ts` on
// `examples/generic-helpers.shade.ts`. What tsc will NOT take is arithmetic on an unconstrained
// type parameter (`a + a` is "Operator '+' cannot be applied to types 'T' and 'T'"), which is
// TypeScript's limit and not this compiler's: a generic here composes calls, selects, indexes
// and field reads.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message)

const FS = `@fragment
export function fs(): vec4 {
  return vec4(1.)
}
`

describe('one compilation per set of argument types the file calls it with', () => {
  it('emits one instance, named for the type', () => {
    const r = compile(`"use typeshade";
function pick<T>(c: bool, a: T, b: T): T {
  return c ? a : b;
}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return vec4(pick(p.x > 0.5, 1., 2.), 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn pick_f32(c: bool, a: f32, b: f32) -> f32 {')
    // `pick<T>` itself is not a function the module emits.
    expect(r.wgsl).not.toMatch(/fn pick\(/)
  })

  it('emits two instances for two sets of types, and one for two calls at the same types', () => {
    const r = compile(`"use typeshade";
function pick<T>(c: bool, a: T, b: T): T {
  return c ? a : b;
}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const s = pick(p.x > 0.5, 1., 2.);
  const t = pick(p.y > 0.5, 3., 4.);
  const v = pick(p.x > 0.5, vec3(0.), vec3(1.));
  return vec4(v * (s + t), 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn pick_f32(')
    expect(r.wgsl).toContain('fn pick_vec3(')
    expect(r.wgsl?.match(/fn pick_f32\(/g)).toHaveLength(1)
  })

  it('declares each instance before the body that calls it', () => {
    // WGSL wants a function declared before it is called, and an instance is made where a
    // call asks for it — in the middle of lowering that call's own body.
    const r = compile(`"use typeshade";
function id<T>(a: T): T {
  return a;
}
@fragment
export function fs(): vec4 {
  return vec4(id(1.), 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect((r.wgsl ?? '').indexOf('fn id_f32')).toBeLessThan((r.wgsl ?? '').indexOf('fn fs'))
  })

  it('a generic that is never called emits nothing', () => {
    const r = compile(`"use typeshade"
function unused<T>(a: T): T {
  return a
}
${FS}`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).not.toContain('unused')
  })

  it('a generic calling a generic instantiates both, innermost first', () => {
    const r = compile(`"use typeshade";
function id<T>(a: T): T {
  return a;
}
function twice<T>(a: T): T {
  return id(id(a));
}
@fragment
export function fs(): vec4 {
  return vec4(twice(1.), 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn twice_f32(a: f32) -> f32 {\n  return id_f32(id_f32(a));\n}')
    expect((r.wgsl ?? '').indexOf('fn id_f32')).toBeLessThan((r.wgsl ?? '').indexOf('fn twice_f32'))
  })
})

describe('what settles the type arguments', () => {
  it('an argument whose parameter is written as the type parameter', () => {
    const r = compile(`"use typeshade";
function id<T>(a: T): T {
  return a;
}
@fragment
export function fs(): vec4 {
  return vec4(id(1.), f32(id(u32(2))), 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn id_f32(a: f32) -> f32 {')
    expect(r.wgsl).toContain('fn id_u32(a: u32) -> u32 {')
  })

  it('an argument whose parameter is written as array<T, N>', () => {
    const r = compile(`"use typeshade";
function head<T>(xs: array<T, 3>): T {
  return xs[0];
}
@fragment
export function fs(): vec4 {
  const xs: array<f32, 3> = [1., 2., 3.];
  const us: array<u32, 3> = [1, 2, 3];
  return vec4(head(xs), f32(head(us)), 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn head_f32(xs: array<f32, 3>) -> f32 {')
    expect(r.wgsl).toContain('fn head_u32(xs: array<u32, 3>) -> u32 {')
  })

  it('the type argument the call writes, which wins over any inference', () => {
    const r = compile(`"use typeshade";
function id<T>(a: T): T {
  return a;
}
@fragment
export function fs(): vec4 {
  return vec4(f32(id<u32>(1)), 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn id_u32(a: u32) -> u32 {')
  })

  it('the caller\'s own type argument, passed through', () => {
    const r = compile(`"use typeshade";
function id<T>(a: T): T {
  return a;
}
function relay<T>(a: T): T {
  return id<T>(a);
}
@fragment
export function fs(): vec4 {
  return vec4(relay(1.), 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn relay_f32(a: f32) -> f32 {\n  return id_f32(a);\n}')
  })
})

describe('the type parameter is a type wherever a type is written', () => {
  it('a return type', () => {
    const r = compile(`"use typeshade";
function pair<T>(a: T, b: T): array<T, 2> {
  const xs: array<T, 2> = [a, b];
  return xs;
}
@fragment
export function fs(): vec4 {
  const p = pair(1., 2.);
  return vec4(p[0], p[1], 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn pair_f32(a: f32, b: f32) -> array<f32, 2> {')
  })

  it('a local declaration inside the body', () => {
    const r = compile(`"use typeshade";
function keep<T>(c: bool, a: T): T {
  const held: T = a;
  return c ? held : a;
}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return vec4(keep(p.x > 0.5, 1.), 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn keep_f32(c: bool, a: f32) -> f32 {')
  })

  it('shadows a type of the same name, the way TypeScript does', () => {
    const r = compile(`"use typeshade";
type T = vec3;
function id<T>(a: T): T {
  return a;
}
@fragment
export function fs(): vec4 {
  return vec4(id(1.), 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn id_f32(a: f32) -> f32 {')
  })
})

describe('what a generic call is refused for, each in one sentence', () => {
  it('nothing in the call says what the type parameter is', () => {
    expect(
      errorsOf(`"use typeshade";
function zero<T>(): T {
  return 0. as T;
}
@fragment
export function fs(): vec4 {
  return vec4(zero(), 0., 0., 1.);
}
`)[0],
    ).toContain('This call does not say what "T" is in "zero"')
  })

  it('the wrong number of type arguments', () => {
    expect(
      errorsOf(`"use typeshade";
function id<T>(a: T): T {
  return a;
}
@fragment
export function fs(): vec4 {
  return vec4(id<f32, f32>(1.), 0., 0., 1.);
}
`)[0],
    ).toBe('"id" takes 1 type argument(s), got 2.')
  })

  it('a type argument that names no type', () => {
    expect(
      errorsOf(`"use typeshade";
function id<T>(a: T): T {
  return a;
}
@fragment
export function fs(): vec4 {
  return vec4(id<nope>(1.), 0., 0., 1.);
}
`)[0],
    ).toContain('Unknown type "nope"')
  })

  it('an argument whose type is not the parameter\'s once the instance exists', () => {
    expect(
      errorsOf(`"use typeshade";
function same<T>(a: T, b: T): T {
  return a;
}
@fragment
export function fs(): vec4 {
  return vec4(same(1., vec3(1.)), 0., 0., 1.);
}
`)[0],
    ).toContain('Argument 2 of "same" type mismatch')
  })

  it('the arguments are reported once, not once per lowering', () => {
    const errs = errorsOf(`"use typeshade";
function id<T>(a: T): T {
  return a;
}
@fragment
export function fs(): vec4 {
  return vec4(id(nowhere), 0., 0., 1.);
}
`)
    expect(errs.filter((m) => m.includes('nowhere'))).toHaveLength(1)
  })
})
