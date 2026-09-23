// Function overload signatures (roadmap 0.3 item T6, design #92, §14). TypeScript writes a
// function's overloads as body-less declarations above the one that has a body. Measured on
// `main` before this: each signature was `TS8020 Function "lum" needs a body (no ambient
// declarations)`, so a file that used the shape did not compile at all. What is pinned here:
// the signatures are skipped and the implementation is lowered once, inside a namespace too,
// the class shapes that already worked keep working, and the two body-less declarations that
// are not overloads keep their error.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const agree = (r: ReturnType<typeof compile>, expected: number[]): void => {
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns['fs']!(), make.name).toEqual(expected);
  }
};

describe('an overload signature is skipped and the implementation is lowered', () => {
  it('once, however many signatures stand above it', () => {
    const r = compile(`"use typeshade";
export function lum(c: vec3): f32;
export function lum(c: vec3): f32;
export function lum(c: vec3): f32 {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
@fragment
export function fs(): vec4 {
  return vec4(lum(vec3(1., 0., 0.)), 0., 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl?.match(/fn lum\(/g)).toHaveLength(1);
    expect(r.wgsl).toContain('fn lum(c: vec3<f32>) -> f32 {');
    expect(r.glsl?.fragment?.match(/float lum\(/g)).toHaveLength(1);
    agree(r, [0.2126, 0, 0, 1]);
  });

  it('inside a namespace, under the flattened name', () => {
    const r = compile(`"use typeshade";
namespace Color {
  export function lum(c: vec3): f32;
  export function lum(c: vec3): f32 {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }
}
@fragment
export function fs(): vec4 {
  return vec4(Color.lum(vec3(0., 1., 0.)), 0., 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl?.match(/fn Color_lum\(/g)).toHaveLength(1);
    agree(r, [0.7152, 0, 0, 1]);
  });

  it('on a method, a static function and a constructor', () => {
    const r = compile(`"use typeshade";
class C {
  x: f32;
  at(t: f32): f32;
  at(t: f32): f32 {
    return this.x * t;
  }
  static mk(v: f32): C;
  static mk(v: f32): C {
    return { x: v };
  }
  constructor(v: f32)
  constructor(v: f32) {
    this.x = v;
  }
}
@fragment
export function fs(): vec4 {
  const a = C.mk(2.);
  const b = new C(3.);
  return vec4(a.at(5.), b.at(5.), 0., 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl?.match(/fn C_at\(/g)).toHaveLength(1);
    expect(r.wgsl?.match(/fn C_mk\(/g)).toHaveLength(1);
    expect(r.wgsl?.match(/fn C_new\(/g)).toHaveLength(1);
    agree(r, [10, 15, 0, 1]);
  });
});

describe('a body-less declaration that is not an overload keeps its error', () => {
  it('with no implementation anywhere', () => {
    expect(
      errorsOf(`"use typeshade";
export function lum(c: vec3): f32;
@fragment
export function fs(): vec4 {
  return vec4(1.);
}
`)[0],
    ).toBe(`${TS_CODES.FUNCTION_SHAPE} Function "lum" needs a body (no ambient declarations).`);
  });

  it('and when it is ambient, even beside an implementation', () => {
    expect(
      errorsOf(`"use typeshade";
declare function lum(c: vec3): f32;
@fragment
export function fs(): vec4 {
  return vec4(1.);
}
`)[0],
    ).toBe(`${TS_CODES.FUNCTION_SHAPE} Function "lum" needs a body (no ambient declarations).`);
    expect(
      errorsOf(`"use typeshade";
declare function lum(c: vec3): f32;
function lum(c: vec3): f32 {
  return c.x;
}
@fragment
export function fs(): vec4 {
  return vec4(lum(vec3(1.)), 0., 0., 1.);
}
`)[0],
    ).toBe(`${TS_CODES.FUNCTION_SHAPE} Function "lum" needs a body (no ambient declarations).`);
  });

  it('and two implementations of one name are still a duplicate', () => {
    expect(
      errorsOf(`"use typeshade";
function lum(c: vec3): f32 {
  return c.x;
}
function lum(c: vec3): f32 {
  return c.y;
}
@fragment
export function fs(): vec4 {
  return vec4(lum(vec3(1.)), 0., 0., 1.);
}
`)[0],
    ).toBe(`${TS_CODES.DUPLICATE_SYMBOL} Duplicate function "lum".`);
  });
});
