// Verifies: Rule 8.28, Rule 8.10, Rule 8.11, Rule 8.25, Rule 12.7
// (docs/language-design.md; traced in reqs/).
//
// A call does not copy a struct or an array its callee only reads when the argument is a place
// (change 0103). Both halves read each program: the compiler (its diagnostics, its WGSL and
// GLSL, and every CPU path where the program runs on the CPU: the oracle at both precisions,
// the generated JS at both, the optimized module and the debugger) and the language service
// (its diagnostics). The CPU paths see the IR before the targets choose a spelling, so they are
// the check that the spelling changed no value.
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { optimize } from '../../core/passes/opt/optimize.js';
import { autoVars } from '../../core/passes/opt/index.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const BIG = `class Big {
  a: vec4f; b: vec4f; xs: array<vec4f, 4>;
  pick(i: i32): f32 { return this.xs[i].x + this.a.x; }
  twice(i: i32): f32 { return this.pick(i) * 2.; }
  bump(k: f32): void { this.a = this.a + vec4f(k); }
}`;

const FRAGMENT = `class VsOut { @builtin("position") pos: vec4; @location(0) uv: vec2; }
class Color { @location(0) color: vec4; }
@vertex export function vs(@builtin("vertex_index") vi: u32): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) };
}`;

/** The editor's diagnostics on `source`, as `code message`. */
function editor(source: string): string[] {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${d.message}`);
}

/** Compile `body`, which declares what the fragment entry `fs` calls, and require both halves
 *  to say nothing. */
function emit(body: string) {
  const source = `"use typeshade";\n${body}\n${FRAGMENT}`;
  const r = compile(source);
  expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  expect(editor(source)).toEqual([]);
  expect(r.wgsl).toBeDefined();
  expect(r.glsl?.fragment).toBeDefined();
  return { wgsl: r.wgsl!, glsl: r.glsl!.fragment, module: r.module };
}

/** `emit`, and hold every CPU path's `run()` to `expected`. */
function runs(body: string, expected: number) {
  const out = emit(
    `${body}\n@fragment export function fs(v: VsOut): Color { return { color: vec4(run(), 0., 0., 1.) }; }`,
  );
  for (const precision of ['f64', 'f32'] as const) {
    expect(compileModule(out.module, { precision }).fns.run!()).toBe(expected);
    expect(compileModuleJs(out.module, { precision }).fns.run!()).toBe(expected);
  }
  expect(compileModule(optimize(autoVars(out.module))).fns.run!()).toBe(expected);
  const session = startDebugSession(out.module, 'run', []);
  session.continue();
  expect(session.result).toBe(expected);
  return out;
}

describe('WGSL reads a place in place', () => {
  it('a let local is handed by pointer, and a pointer is handed on', () => {
    const { wgsl, glsl } = runs(
      `${BIG}
function run(): f32 {
  let b = new Big();
  b.a = vec4f(1.);
  b.xs[2] = vec4f(5.);
  return b.twice(2);
}`,
      12,
    );
    expect(wgsl).toContain('fn Big_pick(self_: ptr<function, Big>, i: i32) -> f32');
    expect(wgsl).toContain('fn Big_twice(self_: ptr<function, Big>, i: i32) -> f32');
    expect(wgsl).toContain('Big_pick(self_, i)');
    expect(wgsl).toContain('Big_twice(&b, 2)');
    // GLSL ES 3.00 has no reference that only reads: a local stays an `in` copy.
    expect(glsl).toContain('float Big_twice(Big self_, int i)');
  });

  it('a module variable is handed by pointer, and GLSL reads it by name', () => {
    const { wgsl, glsl } = runs(
      `${BIG}
let G: Big;
function run(): f32 {
  G.bump(2.);
  return G.pick(1);
}`,
      2,
    );
    expect(wgsl).toContain('fn Big_pick_private(self_: ptr<private, Big>, i: i32) -> f32');
    expect(wgsl).toContain('Big_pick_private(&G, 1)');
    // `twice`, which nothing calls, is still emitted, by value, and calls the by-value copy.
    expect(wgsl).toContain('fn Big_twice(self_: Big, i: i32) -> f32');
    expect(wgsl).toContain('Big_pick_value(self_, i)');
    expect(glsl).toContain('float Big_pick_G(int i)');
    expect(glsl).toContain('void Big_bump_G(float k)');
    expect(glsl).toContain('G.a = ');
    expect(glsl).not.toContain('inout');
  });

  it('a uniform and a storage element are handed by pointer in their own space', () => {
    const { wgsl, glsl } = emit(`${BIG}
class P { a: vec4f; sum(): f32 { return this.a.x; } }
const U = uniform<Big>();
const R = storage<array<P>>();
@fragment export function fs(v: VsOut): Color {
  const i = i32(v.uv.x);
  return { color: vec4(U.twice(i) + R[u32(i)].sum(), 0., 0., 1.) };
}`);
    expect(wgsl).toContain('fn Big_pick(self_: ptr<uniform, Big>, i: i32) -> f32');
    expect(wgsl).toContain('fn P_sum(self_: ptr<storage, P, read>) -> f32');
    expect(wgsl).toContain('Big_twice(&U, i)');
    expect(wgsl).toContain('P_sum(&R[u32(i)])');
    // GLSL reads the block by name, and no longer rebuilds it whole at the call.
    expect(glsl).toContain('Big_twice_U(i)');
    expect(glsl).not.toMatch(/Big_value\(U\./);
  });

  it('a method on an emulated storage element compiles for WebGL2', () => {
    const { wgsl, glsl } = emit(`class P { a: vec4f; b: vec4f;
  sum(): f32 { return this.a.x + this.b.y; }
  twice(): f32 { return this.sum() * 2.; } }
const R = storage<array<P>>();
@fragment export function fs(v: VsOut): Color {
  const i = u32(v.uv.x);
  return { color: vec4(R[i].twice() + R[i + u32(1)].sum(), 0., 0., 1.) };
}`);
    expect(wgsl).toContain('fn P_sum(self_: ptr<storage, P, read>) -> f32');
    expect(glsl).toContain('float P_sum_R_at(uint at0)');
    expect(glsl).toContain('P_twice_R_at(i)');
    expect(glsl).toContain('P_sum_R_at((i + 1u))');
  });

  it('a struct argument of a plain function is handed by pointer', () => {
    const { wgsl } = runs(
      `class Rect { w: f32; h: f32; }
function area(r: Rect): f32 { return r.w * r.h; }
function run(): f32 {
  let r: Rect = { w: 3., h: 4. };
  return area(r);
}`,
      12,
    );
    expect(wgsl).toContain('fn area(r: ptr<function, Rect>) -> f32');
    expect(wgsl).toContain('area(&r)');
  });
});

describe('a copy remains where the place is no place, or can change', () => {
  it('a const local and a temporary are read in place from a var (change 0105)', () => {
    const { wgsl } = runs(
      `${BIG}
function run(): f32 {
  const b = new Big();
  return b.pick(0) + new Big().pick(1);
}`,
      0,
    );
    // Change 0105: the struct local is a `var`, so its method takes a pointer.
    expect(wgsl).toContain('fn Big_pick_function(self_: ptr<function, Big>, i: i32) -> f32');
    expect(wgsl).toContain('Big_pick_function(&_cse0, 0)');
  });

  it('a callee that writes the place by its name reads the copy taken at the call', () => {
    const { wgsl, glsl } = runs(
      `class Cell {
  a: f32;
  peek(): f32 { G.a = 9.; return this.a; }
}
let G: Cell;
function run(): f32 {
  G.a = 1.;
  return G.peek() + G.a;
}`,
      10,
    );
    expect(wgsl).toContain('fn Cell_peek(self_: Cell) -> f32');
    expect(wgsl).toContain('Cell_peek(G)');
    expect(glsl).not.toContain('Cell_peek_G');
  });

  it('an argument another argument writes through is copied', () => {
    const { wgsl } = runs(
      `class Cell { a: f32; }
function take(@inout into: Cell, src: Cell): f32 { into.a = 7.; return src.a; }
function run(): f32 {
  let c: Cell = { a: 1. };
  return take(c, c) + c.a;
}`,
      8,
    );
    expect(wgsl).toContain('fn take(into: ptr<function, Cell>, src: Cell) -> f32');
    expect(wgsl).toContain('take(&c, c)');
  });

  it('shared memory read across a barrier is copied', () => {
    const r = compile(`"use typeshade";
class Cell { a: f32; }
let tile: workgroup<Cell>;
const out = storage<array<f32>, "read_write">();
function late(c: Cell): f32 { workgroupBarrier(); return c.a; }
function early(c: Cell): f32 { return c.a; }
@compute([64])
export function main(@builtin("local_invocation_index") i: u32) {
  if (i == u32(0)) { tile.a = 1.; }
  out[i] = late(tile) + early(tile);
}`);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
    expect(r.wgsl).toContain('fn late(c: Cell) -> f32');
    expect(r.wgsl).toContain('fn early(c: ptr<workgroup, Cell>) -> f32');
    expect(r.wgsl).toContain('late(tile)');
    expect(r.wgsl).toContain('early(&tile)');
  });
});
