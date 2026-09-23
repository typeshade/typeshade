// A class whose members are all static, and a static field (roadmap 0.3 item T3, design #92,
// §26). The utility class is one of the most common shapes in TypeScript. Measured on `main`
// before this: `class Util { static half(x) { ... } }` was TS8010 "Struct "Util" has no
// fields", and `static PI = 3.14` was TS8035 "A static field has no shader form; declare "PI"
// as a module const". What is pinned here: a static-only class is a namespace of functions and
// carries no struct into the emit, its statics are the same `Cls_fn` functions a data class's
// already were, a static field is the module constant `Cls_Field` on both targets and both CPU
// paths, and the shapes that were refused before are refused still.

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

const file = (head: string, body: string) => `"use typeshade"
${head}@fragment
export function fs(@location(0) uv: vec2): vec4 {
${body}
}
`;

describe('a class whose members are all static is a namespace of functions', () => {
  it('compiles, names its functions Cls_fn, and carries no struct', () => {
    const r = compile(
      file(
        `class Util {
  static half(x: f32): f32 {
    return x * 0.5
  }
  static quarter(x: f32): f32 {
    return Util.half(Util.half(x))
  }
}
`,
        `  return vec4(Util.quarter(uv.x), 0., 0., 1.)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('fn Util_half(x: f32) -> f32 {');
    expect(r.wgsl).toContain('fn Util_quarter(x: f32) -> f32 {');
    // The point of the item: WGSL has no empty struct, and the class needs none.
    expect(r.wgsl).not.toContain('struct Util');
    expect(r.glsl?.fragment).toContain('float Util_half(float x) {');
    expect(r.glsl?.fragment).not.toContain('struct Util');
    expect(r.module.structs ?? []).toEqual([]);
  });

  it('a class with a field and a static is still a struct, as it was', () => {
    const r = compile(
      file(
        `class Util {
  pad: f32
  static half(x: f32): f32 {
    return x * 0.5
  }
}
`,
        `  return vec4(Util.half(uv.x), 0., 0., 1.)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('struct Util {');
    expect(r.wgsl).toContain('fn Util_half(x: f32) -> f32 {');
  });

  it('a fieldless class with an instance member keeps the empty-struct refusal', () => {
    // An instance method needs a receiver, and the receiver is the struct that is not there.
    expect(
      errorsOf(
        file(
          `class Util {\n  half(x: f32): f32 {\n    return x * 0.5\n  }\n}\n`,
          `  return vec4(1., 0., 0., 1.)`,
        ),
      ),
    ).toEqual([
      `${TS_CODES.STRUCT_FIELD} Struct "Util" has no fields. WGSL requires a struct to declare at least one member, so an empty one cannot be emitted. A class holding only functions is not a struct; write them as functions.`,
    ]);
    expect(errorsOf(file(`class Util {}\n`, `  return vec4(1., 0., 0., 1.)`))).toEqual([
      `${TS_CODES.STRUCT_FIELD} Struct "Util" has no fields. WGSL requires a struct to declare at least one member, so an empty one cannot be emitted.`,
    ]);
  });
});

describe('a static field is a module constant', () => {
  it('takes the name Cls_Field, in every scalar kind and as a vector', () => {
    const r = compile(
      file(
        `class K {
  static N: i32 = 4
  static M: u32 = 7
  static ON: bool = true
  static C: vec3 = vec3(1., 0., 0.)
  static PI: f32 = 3.5
}
`,
        `  return vec4(K.C * f32(K.N) * f32(K.M) * select(0., K.PI, K.ON), 1.)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('const K_N: i32 = 4;');
    expect(r.wgsl).toContain('const K_M: u32 = 7u;');
    expect(r.wgsl).toContain('const K_ON: bool = true;');
    expect(r.wgsl).toContain('const K_C: vec3<f32> = vec3<f32>(1.0, 0.0, 0.0);');
    expect(r.glsl?.fragment).toContain('const int K_N = 4;');
  });

  it('folds against an earlier const, bounds a loop, and agrees on both CPU paths', () => {
    const r = compile(
      file(
        `const BASE: f32 = 2.
class K {
  static N: i32 = 3
  static PI: f32 = BASE * 1.75
  static twice(x: f32): f32 {
    return x * 2.
  }
}
`,
        `  let s: f32 = 0.
  for (let i: i32 = 0; i < K.N; i++) {
    s = s + K.twice(K.PI)
  }
  return vec4(s, 0., 0., 1.)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('const K_PI: f32 = 3.5;');
    expect(r.wgsl).toContain('(i < K_N)');
    // 3 rounds of 2 * 3.5.
    for (const make of [compileModule, compileModuleJs]) {
      expect(make(r.module).fns['fs']!([0.5, 0.5]), make.name).toEqual([21, 0, 0, 1]);
    }
  });

  it('a static field on a data class is a constant beside the struct', () => {
    const r = compile(
      file(
        `class P {
  x: f32
  static ORIGIN: f32 = 0.
}
declare const u: uniform<P>
`,
        `  return vec4(u.x + P.ORIGIN, 0., 0., 1.)`,
      ),
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('const P_ORIGIN: f32 = 0.0;');
    expect(r.wgsl).toContain('struct P {');
    expect(r.wgsl).toContain('(u.x + P_ORIGIN)');
  });
});

describe('what a static member still does not do', () => {
  it('a static field with no value is refused, and an unknown one is named', () => {
    expect(
      errorsOf(file(`class K {\n  static PI: f32\n}\n`, `  return vec4(1., 0., 0., 1.)`)),
    ).toEqual([
      `${TS_CODES.TOP_LEVEL} Static field "K.PI" needs an initializer: it is a module constant, and a constant has a value.`,
    ]);
    expect(
      errorsOf(
        file(`class K {\n  static PI: f32 = 3.14\n}\n`, `  return vec4(K.TAU, 0., 0., 1.)`),
      )[0],
    ).toBe(`${TS_CODES.UNKNOWN_NAME} "K" has no static field "TAU".`);
  });

  it('a static function named as a value says to call it', () => {
    expect(
      errorsOf(
        file(
          `class K {\n  static twice(x: f32): f32 {\n    return x * 2.\n  }\n}\n`,
          `  return vec4(K.twice, 0., 0., 1.)`,
        ),
      )[0],
    ).toBe(`${TS_CODES.UNKNOWN_NAME} "K.twice" is a function; call it: K.twice(...).`);
  });
});
