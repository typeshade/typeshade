// compile() fails honestly: no shader text and no runnable oracle for a program that did not
// compile. Before this, an error left `wgsl` undefined in `compileTsSource` and compile() then
// packed the PARTIAL module anyway, so a caller got WGSL for a program that had not compiled,
// or a TypeShadeError thrown out of the emitter.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { TS_CODES } from './codes.js'

const CLIP_COLOR = `
"use typeshade";

class Clip {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4;
}

@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  return { pos: vec4(0., 0., 0., 1.) };
}

@fragment
export function fs(): Color {
  return { color: vec4(1., 0., 0., 1.) };
}
`

const COMPUTE_ONLY = `
"use typeshade";

@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3<u32>): void {
  const x = gid.x;
}
`

const VERTEX_ONLY = `
"use typeshade";

class Clip {
  @builtin("position") pos: vec4;
}

@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  return { pos: vec4(0., 0., 0., 1.) };
}
`

const FRAGMENT_ONLY = `
"use typeshade";

class Color {
  @location(0) color: vec4;
}

@fragment
export function fs(): Color {
  return { color: vec4(1., 0., 0., 1.) };
}
`

// A normal WebGPU program: a render pair plus a compute entry. The WGSL emitter takes it; the
// GLSL ES 3.00 backend has no compute and throws on the whole module.
const RENDER_PLUS_COMPUTE =
  CLIP_COLOR +
  `
@compute([1])
export function cs(@builtin("global_invocation_id") g: vec3<u32>): void {
  const x = g.x;
}
`

// A vertex+fragment module whose storage binding the GLSL storage emulation cannot spell
// (an array of mat4). WGSL emits; only emitGlslStages throws.
const GLSL_UNSUPPORTED_BINDING = `
"use typeshade";
declare const m: storage<array<mat4, 2>>;

class Clip {
  @builtin("position") pos: vec4;
}

class Color {
  @location(0) color: vec4;
}

@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  return { pos: vec4(0., 0., 0., 1.) };
}

@fragment
export function fs(): Color {
  return { color: m[0][0] };
}
`

// `a + b` on f32 and i32 is a TYPE_MISMATCH the front end reports; `f` still lowers to a
// partial function, which is exactly the module compile() used to pack.
const TYPE_ERROR = `
"use typeshade";
export function f(a: f32, b: i32): f32 {
  return a + b;
}
`

// The front end accepts `1e400` (TypeScript parses it as a numeric literal, Infinity) and
// lowers no function, so `compileTsSource` never runs the WGSL emitter; compile() does, and the
// emitter throws SD0017 (literal cannot be spelled). That is the seam where compile() must turn
// a backend throw into a diagnostic instead of letting it escape.
const BACKEND_THROW = `
"use typeshade";
export const K: f32 = 1e400;
`

// The same unspellable const, read by a function. `compileTsSource` lowers `f` with no
// front-end error and runs the emitter itself; emitModule throws SD0017 on the const. It used
// to fall back to emitFuncs(funcs), which emits the functions alone, so compile() handed back
// `fn f() -> f32 { return (K * 2.0); }` with `K` undeclared and zero diagnostics.
const BACKEND_THROW_READ = `
"use typeshade";
export const K: f32 = 1e400;
export function f(): f32 { return K * 2.; }
`

const errorsOf = (s: ReturnType<typeof compile>) =>
  s.diagnostics.filter((d) => d.category === 'error')

describe('compile() contract', () => {
  it('yields wgsl and glsl for a vertex+fragment module, and eval runs', () => {
    const s = compile(CLIP_COLOR)
    expect(errorsOf(s)).toEqual([])
    expect(s.wgsl).toMatch(/@vertex/)
    expect(s.wgsl).toMatch(/@fragment/)
    expect(s.glsl?.vertex).toMatch(/#version 300 es/)
    expect(s.glsl?.fragment).toMatch(/#version 300 es/)
    expect((s.eval('fs') as { color: number[] }).color).toEqual([1, 0, 0, 1])
  })

  it('yields wgsl but no glsl and no warning for a compute-only module', () => {
    const s = compile(COMPUTE_ONLY)
    expect(s.diagnostics).toEqual([])
    expect(s.wgsl).toMatch(/@compute/)
    expect(s.glsl).toBeUndefined()
  })

  it('yields wgsl and glsl for a vertex-only module', () => {
    const s = compile(VERTEX_ONLY)
    expect(s.diagnostics).toEqual([])
    expect(s.wgsl).toMatch(/@vertex/)
    expect(s.glsl?.vertex).toMatch(/#version 300 es/)
    expect(s.glsl?.fragment).toMatch(/#version 300 es/)
  })

  it('yields wgsl and glsl for a fragment-only module, and eval runs', () => {
    const s = compile(FRAGMENT_ONLY)
    expect(s.diagnostics).toEqual([])
    expect(s.wgsl).toMatch(/@fragment/)
    expect(s.glsl?.fragment).toMatch(/#version 300 es/)
    expect((s.eval('fs') as { color: number[] }).color).toEqual([1, 0, 0, 1])
  })

  it('keeps the wgsl of a render+compute module when only the GLSL backend cannot emit it', () => {
    const s = compile(RENDER_PLUS_COMPUTE)
    expect(errorsOf(s)).toEqual([])
    expect(s.wgsl).toMatch(/@vertex/)
    expect(s.wgsl).toMatch(/@fragment/)
    expect(s.wgsl).toMatch(/@compute/)
    expect(s.glsl).toBeUndefined()
    // The GLSL shortfall is visible, as a warning: the program compiled, one target is missing.
    expect(s.diagnostics.map((d) => [d.code, d.category])).toEqual([[TS_CODES.BACKEND, 'warning']])
    expect(s.diagnostics[0]!.message).toMatch(/glsl/)
    expect((s.eval('fs') as { color: number[] }).color).toEqual([1, 0, 0, 1])
  })

  it('keeps the wgsl of a vertex+fragment module whose binding the GLSL backend cannot spell', () => {
    const s = compile(GLSL_UNSUPPORTED_BINDING)
    expect(errorsOf(s)).toEqual([])
    expect(s.wgsl).toMatch(/var<storage/)
    expect(s.glsl).toBeUndefined()
    expect(s.diagnostics.map((d) => [d.code, d.category])).toEqual([[TS_CODES.BACKEND, 'warning']])
    expect(s.diagnostics[0]!.message).toMatch(/storage binding 'm'/)
  })

  it('yields diagnostics and no shader text for a type error, and eval throws with the message', () => {
    const s = compile(TYPE_ERROR)
    const errors = errorsOf(s)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]!.code).toBe(TS_CODES.TYPE_MISMATCH)
    expect(s.wgsl).toBeUndefined()
    expect(s.glsl).toBeUndefined()
    // The partial module is still there for inspection.
    expect(s.module.funcs.map((f) => f.name)).toEqual(['f'])
    const first = errors[0]!
    expect(() => s.eval('f', [1, 2])).toThrow(first.message)
    expect(() => s.eval('f', [1, 2])).toThrow(`${first.fileName}:${first.line}:${first.character}`)
    expect(() => s.eval('f', [1, 2])).toThrow(first.code!)
  })

  it('yields one MISSING_DIRECTIVE error and no shader text for a source without the directive', () => {
    const s = compile('export function f(): f32 { return 1.; }')
    expect(s.diagnostics.map((d) => [d.code, d.category])).toEqual([
      [TS_CODES.MISSING_DIRECTIVE, 'error'],
    ])
    expect(s.wgsl).toBeUndefined()
    expect(s.glsl).toBeUndefined()
    expect(s.module.funcs).toEqual([])
    expect(() => s.eval('f')).toThrow(/use typeshade/)
  })

  it('converts a backend throw on a front-end-clean module into a BACKEND diagnostic', () => {
    let s: ReturnType<typeof compile> | undefined
    expect(() => {
      s = compile(BACKEND_THROW)
    }).not.toThrow()
    expect(s!.diagnostics.map((d) => [d.code, d.category])).toEqual([[TS_CODES.BACKEND, 'error']])
    expect(s!.diagnostics[0]!.message).toMatch(/Backend emit failed/)
    expect(s!.diagnostics[0]!.message).toMatch(/SD0017/)
    // Anchored on the file's first statement, the directive itself, not at a fake position.
    expect(s!.diagnostics[0]!.line).toBe(2)
    expect(s!.wgsl).toBeUndefined()
    expect(s!.glsl).toBeUndefined()
    expect(() => s!.eval('K')).toThrow(/Backend emit failed/)
  })

  it('reports an emitModule throw on a const a function reads, instead of emitting the functions alone', () => {
    const s = compile(BACKEND_THROW_READ)
    expect(s.diagnostics.map((d) => [d.code, d.category])).toEqual([[TS_CODES.BACKEND, 'error']])
    expect(s.diagnostics[0]!.message).toMatch(/SD0017/)
    expect(s.wgsl).toBeUndefined()
    expect(s.glsl).toBeUndefined()
    expect(() => s.eval('f')).toThrow(/Backend emit failed/)
  })

  it('reports a backend throw the front end already caught as that same diagnostic, once', () => {
    // A function body with the same literal: compileTsSource runs the emitter itself and
    // records the BACKEND error, so compile() must not run the emitter a second time.
    const s = compile(`"use typeshade";\nexport function f(): f32 { return 1e400; }`)
    expect(s.diagnostics.map((d) => d.code)).toEqual([TS_CODES.BACKEND])
    expect(s.wgsl).toBeUndefined()
    expect(s.glsl).toBeUndefined()
  })
})
