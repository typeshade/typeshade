// A local function, and the triple-slash directives that already worked (roadmap 0.3 item T7,
// design #92, §14). `const f = (x: f32): f32 => x * 2.` is how a TypeScript developer writes a
// helper they need once. Measured on `main` before this: `TS8099 Unsupported expression
// "(x: f32): f32 => x * 2."` and then `TS8004 Unknown function "f(uv.x)"`.
//
// Neither target has a function value, so a local function is a function of the module named
// after the body that declares it, and the one rule that separates it from a function
// declaration is that it may not capture.

import { describe, expect, it } from 'vitest'
import { compile } from './compile.js'
import { compileTsSource } from './source-file.js'
import { TS_CODES } from './codes.js'
import { compileModule } from '../../core/oracle.js'
import { compileModuleJs } from '../../core/cpu-codegen.js'

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`)

const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!(), make.name).toEqual(expected)
  }
}

describe('a local function is a function of the module', () => {
  it('named after the body that declares it, in both spellings', () => {
    const arrow = compile(`"use typeshade";
@fragment
export function fs(): vec4 {
  const f = (x: f32): f32 => x * 2.;
  return vec4(f(3.), 0., 0., 1.);
}
`)
    expect(arrow.diagnostics).toEqual([])
    expect(arrow.wgsl).toContain('fn fs_f(x: f32) -> f32 {')
    expect(arrow.wgsl).toContain('return vec4<f32>(fs_f(3.0), 0.0, 0.0, 1.0);')
    expect(arrow.glsl?.fragment).toContain('float fs_f(float x) {')
    agree(arrow, [6, 0, 0, 1])
    const expr = compile(`"use typeshade";
@fragment
export function fs(): vec4 {
  const f = function (x: f32): f32 {
    return x * 3.;
  };
  return vec4(f(3.), 0., 0., 1.);
}
`)
    expect(expr.diagnostics).toEqual([])
    expect(expr.wgsl).toContain('fn fs_f(x: f32) -> f32 {')
    agree(expr, [9, 0, 0, 1])
  })

  it('so two bodies may each declare an "f"', () => {
    const r = compile(`"use typeshade";
function g(): f32 {
  const f = (x: f32): f32 => x * 10.;
  return f(2.);
}
@fragment
export function fs(): vec4 {
  const f = (x: f32): f32 => x * 100.;
  return vec4(f(2.), g(), 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn g_f(x: f32) -> f32 {')
    expect(r.wgsl).toContain('fn fs_f(x: f32) -> f32 {')
    agree(r, [200, 20, 0, 1])
  })

  it('with a block body, a nested one, and a module const in reach', () => {
    const r = compile(`"use typeshade";
const K: f32 = 4.;
@fragment
export function fs(): vec4 {
  const outer = (x: f32): f32 => {
    const inner = (y: f32): f32 => y + 1.;
    return inner(x) * K;
  };
  return vec4(outer(3.), 0., 0., 1.);
}
`)
    expect(r.diagnostics).toEqual([])
    expect(r.wgsl).toContain('fn fs_outer_inner(y: f32) -> f32 {')
    expect(r.wgsl).toContain('return (fs_outer_inner(x) * K);')
    agree(r, [16, 0, 0, 1])
  })

  it('at the module top level it is already one, and in a namespace it takes the flattened name', () => {
    const top = compile(`"use typeshade";
const half = (x: f32): f32 => x * 0.5;
@fragment
export function fs(): vec4 {
  return vec4(half(3.), 0., 0., 1.);
}
`)
    expect(top.diagnostics).toEqual([])
    expect(top.wgsl).toContain('fn half(x: f32) -> f32 {')
    agree(top, [1.5, 0, 0, 1])
    const ns = compile(`"use typeshade";
namespace N {
  export const twice = (x: f32): f32 => x * 2.;
  export function use(x: f32): f32 {
    return twice(x);
  }
}
@fragment
export function fs(): vec4 {
  return vec4(N.use(3.), 0., 0., 1.);
}
`)
    expect(ns.diagnostics).toEqual([])
    expect(ns.wgsl).toContain('fn N_twice(x: f32) -> f32 {')
    agree(ns, [6, 0, 0, 1])
  })
})

describe('what a local function may not do', () => {
  it('capture a name from the body around it', () => {
    expect(
      errorsOf(`"use typeshade";
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const f = (x: f32): f32 => x * uv.x;
  return vec4(f(2.), 0., 0., 1.);
}
`)[0],
    ).toBe(
      `${TS_CODES.UNSUPPORTED} "f" reads "uv" from the function around it. A shader function takes its arguments and reads the module; there is no environment for it to carry one in. Pass "uv" as a parameter.`,
    )
  })

  it('leave its return type off an expression body, or be a let', () => {
    expect(
      errorsOf(`"use typeshade";
@fragment
export function fs(): vec4 {
  const f = (x: f32) => x * 2.;
  return vec4(f(3.), 0., 0., 1.);
}
`)[0],
    ).toBe(
      `${TS_CODES.FUNCTION_SHAPE} "f" returns a value straight away, so it needs a return type: write "(x: f32): f32 => ...".`,
    )
    expect(
      errorsOf(`"use typeshade";
@fragment
export function fs(): vec4 {
  let f = (x: f32): f32 => x * 2.;
  return vec4(f(3.), 0., 0., 1.);
}
`)[0],
    ).toBe(
      `${TS_CODES.FUNCTION_SHAPE} "f" is a function, so it is declared with const; a "let" would let the name point at another one, which no shader value does.`,
    )
  })

  it('take a type on the const rather than on itself', () => {
    expect(
      errorsOf(`"use typeshade";
@fragment
export function fs(): vec4 {
  const f: f32 = (x: f32): f32 => x * 2.;
  return vec4(f(3.), 0., 0., 1.);
}
`)[0],
    ).toBe(
      `${TS_CODES.FUNCTION_SHAPE} "f" is a function; its types are written on its own parameters and after them, not as a type on the const.`,
    )
  })
})

describe('a triple-slash directive is a comment, and always was', () => {
  it('above the "use typeshade" directive and below it', () => {
    const above = compile(`/// <reference types="typeshade" />
"use typeshade";
@fragment
export function fs(): vec4 {
  return vec4(1.);
}
`)
    expect(above.diagnostics).toEqual([])
    expect(above.wgsl).toContain('fn fs()')
    const below = compile(`"use typeshade";
/// <reference path="./other.d.ts" />
@fragment
export function fs(): vec4 {
  return vec4(1.);
}
`)
    expect(below.diagnostics).toEqual([])
    expect(below.wgsl).toContain('fn fs()')
  })
})
