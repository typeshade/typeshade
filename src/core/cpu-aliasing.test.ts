// The CPU paths hand a function a copy of an aggregate it takes by value, as both GPU targets do
// (`copiedParams`, cpu-runtime.ts), and store back what an `inout` parameter holds as the function
// returns (`inoutReturn`).
//
// Measured before the copy: a JavaScript vector, matrix, array or struct is the caller's own
// object, so a function that wrote what the caller passed, a module variable or the object an
// `inout` parameter reaches, changed what its by-value parameter held too. `a.add(a)` with `add`
// writing its object computed 4 on the oracle, the codegen and the debugger, where WGSL and
// GLSL ES 3.00, whose `o` is a copy taken at the call, compute 3; `f(g)` with `f` writing `g.x`
// read 5 where both targets read 1. Before the store back, a scalar a local function writes
// through a capture (Rule 8.17) kept its old value on the CPU paths.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { compileModule } from './oracle.js';
import { compileModuleJs } from './cpu-codegen.js';
import { startDebugSession } from './debug/session.js';

/** `run()` on the oracle, the codegen and the debugger, each at f64 and f32 where it has both. */
function everyPath(src: string): unknown[] {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const s = startDebugSession(r.module, 'run', []);
  s.continue();
  return [
    r.eval('run', []),
    compileModule(r.module, { precision: 'f32' }).fns['run']!(),
    compileModuleJs(r.module).fns['run']!(),
    compileModuleJs(r.module, { precision: 'f32' }).fns['run']!(),
    s.result,
  ];
}

describe('a by-value aggregate is a copy on every CPU path, as on the GPU', () => {
  it('a method that writes its object, handed its own object as an argument', () => {
    const src = `"use typeshade";
class V {
  x: f32 = 1.;
  add(o: V): void {
    this.x += 1.;
    this.x += o.x;
  }
}
export function run(): f32 {
  let a = new V();
  a.add(a);
  return a.x;
}
@fragment
export function fs(): vec4 {
  return vec4(run(), 0., 0., 1.);
}
`;
    // `o` is `a` as the call found it, x = 1: 1 + 1 + 1.
    expect(everyPath(src)).toEqual([3, 3, 3, 3, 3]);
    expect(compile(src).wgsl).toContain('V_add(&a, a);');
  });

  it('a function that writes the module variable it was passed', () => {
    const src = `"use typeshade";
class V {
  x: f32 = 1.;
}
let g: V = { x: 1. };
function f(p: V): f32 {
  g.x = 5.;
  return p.x;
}
export function run(): f32 {
  return f(g);
}
@fragment
export function fs(): vec4 {
  return vec4(run(), 0., 0., 1.);
}
`;
    expect(everyPath(src)).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('an inout parameter is stored back into the variable passed there', () => {
  it('a scalar a local function writes through a capture (Rule 8.17)', () => {
    const src = `"use typeshade";
export function run(): f32 {
  let n = 1.;
  const grow = (): void => {
    n = n * 3.;
  };
  grow();
  grow();
  return n;
}
@fragment
export function fs(): vec4 {
  return vec4(run(), 0., 0., 1.);
}
`;
    expect(everyPath(src)).toEqual([9, 9, 9, 9, 9]);
  });
});
