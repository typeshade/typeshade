// A conditional on a struct or a fixed-length array (issue #113). Neither target has an
// operator for it, so it is hoisted into a slot and an `if`, the way `match-lower.ts` hoists a
// multi-arm conditional expression into a slot and a `switch`.
//
// A helper function would have been shorter to write and WRONG: its arguments are evaluated
// before the call, so both arms would run, and `glsl-legalize.test.ts` holds the case that makes
// that visible — an arm whose call discards. The `if` keeps each arm on its own branch.
//
// Measured on `main` at 99e0a29, with zero diagnostics on both:
//
//   WGSL   select(Ray, Ray, bool)       Tint: "no matching call to 'select(Ray, Ray, bool)'"
//   GLSL   ((c) ? r1 : r2) on a struct  WebGL2: "'?:' : ternary operator is not allowed for
//                                       structures in ESSL 1.0 and webgl"; the same for arrays
//
// The GLSL half corrected a guess made from the ES 3.00 spec, whose ternary takes any two
// operands of one type. The driver is what the emitted code has to satisfy.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { compileModule } from './oracle.js';
import { compileModuleJs } from './cpu-codegen.js';

const RAYS = `"use typeshade";
class Ray {
  o: vec3;
  d: vec3;
  constructor(o: vec3) {
    this.o = o;
  }
}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const r1 = new Ray(vec3(1., 0., 0.));
  const r2 = new Ray(vec3(0., 1., 0.));
  const r = p.x > 0.5 ? r1 : r2;
  return vec4(r.o, 1.);
}
`;

describe('a conditional on a struct becomes a slot and an if, on both targets', () => {
  it('WGSL hoists it, with no select builtin in sight', () => {
    const r = compile(RAYS);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain(
      '  var _sel0: Ray;\n  if ((p.x > 0.5)) {\n    _sel0 = r1;\n  } else {\n    _sel0 = r2;\n  }',
    );
    expect(r.wgsl).not.toContain('select(r2');
  });

  it('GLSL hoists the same way, with no ternary', () => {
    const r = compile(RAYS);
    expect(r.diagnostics).toEqual([]);
    const g = r.glsl!.fragment;
    expect(g).toContain(
      '  Ray _sel0;\n  if ((p.x > 0.5)) {\n    _sel0 = r1;\n  } else {\n    _sel0 = r2;\n  }',
    );
    expect(g).not.toContain('? r1 :');
  });

  it('each arm sits on its own branch, so a side effect in one stays conditional', () => {
    // The reason this is an `if` and not a helper call: a helper's arguments are evaluated
    // before the call, and an arm that discards would then discard unconditionally.
    const r = compile(RAYS);
    const w = r.wgsl!;
    const open = w.indexOf('if ((p.x > 0.5))');
    expect(w.slice(open, w.indexOf('}', open))).toContain('_sel0 = r1;');
  });
});

describe('an array conditional, which the same driver refuses the same way', () => {
  const ARRAYS = `"use typeshade";
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const xs: array<f32, 2> = [1., 2.];
  const ys: array<f32, 2> = [3., 4.];
  const zs = p.x > 0.5 ? xs : ys;
  return vec4(zs[0], zs[1], 0., 1.);
}
`;

  it('hoists into a slot of its own type on both targets', () => {
    const r = compile(ARRAYS);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('  var _sel0: array<f32, 2>;');
    expect(r.wgsl).toContain('    _sel0 = xs;');
    expect(r.glsl!.fragment).toContain('  float[2] _sel0;');
    expect(r.glsl!.fragment).not.toContain('? xs :');
  });
});

describe('what is left alone', () => {
  it('a scalar and a vector conditional keep the operator each target has', () => {
    const r = compile(`"use typeshade";
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const a = p.x > 0.5 ? 1. : 2.;
  const v = p.y > 0.5 ? vec3(1., 0., 0.) : vec3(0., 1., 0.);
  return vec4(v * a, 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('select(2.0, 1.0, (p.x > 0.5))');
    expect(r.wgsl).not.toContain('_sel0');
    expect(r.glsl!.fragment).not.toContain('_sel0');
  });

  it('two composite conditionals each get their own slot', () => {
    const r = compile(`"use typeshade";
class Ray {
  o: vec3;
  d: vec3;
  constructor(o: vec3) {
    this.o = o;
  }
}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  const r1 = new Ray(vec3(1., 0., 0.));
  const r2 = new Ray(vec3(0., 1., 0.));
  const a = p.x > 0.5 ? r1 : r2;
  const b = p.y > 0.5 ? r2 : r1;
  return vec4(a.o + b.o, 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('var _sel0: Ray;');
    expect(r.wgsl).toContain('var _sel1: Ray;');
  });
});

describe('the CPU backends need none of it', () => {
  it('a struct conditional is an ordinary choice there', () => {
    const r = compile(`"use typeshade";
class Ray {
  o: vec3;
  d: vec3;
  constructor(o: vec3) {
    this.o = o;
  }
}
export function probe(c: bool): vec3 {
  const r1 = new Ray(vec3(1., 0., 0.));
  const r2 = new Ray(vec3(0., 1., 0.));
  const r = c ? r1 : r2;
  return r.o;
}
@fragment
export function fs(): vec4 {
  return vec4(probe(true), 1.);
}
`);
    expect(r.diagnostics).toEqual([]);
    // The IR the oracle reads still carries the `select`; the hoist is a spelling, made for
    // the GPU targets on the way to source.
    for (const make of [compileModule, compileModuleJs]) {
      const cpu = make(r.module);
      expect(cpu.fns['probe']!(true)).toEqual([1, 0, 0]);
      expect(cpu.fns['probe']!(false)).toEqual([0, 1, 0]);
    }
    expect(JSON.stringify(r.module)).not.toContain('_sel0');
  });
});
