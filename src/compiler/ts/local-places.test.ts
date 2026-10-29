// Verifies: Rule 8.28, Rule 12.7
// (docs/language-design.md; traced in reqs/).
//
// A local that only reads a place reads the place, and a struct a call returns into a local is
// written there (change 0104); a struct or array local is a place, a struct returns into a module
// place too, an index that holds one value is not bound, and a write to another part of the place
// keeps the local in place (change 0105). Both halves read each program: the compiler (its diagnostics, its
// WGSL and GLSL, and every CPU path where the program runs on the CPU, which sees the IR before
// either writer rewrites it, so it holds the rewrite to the value the source means) and the
// language service (its diagnostics).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const FRAGMENT = `class VsOut { @builtin("position") pos: vec4; @location(0) uv: vec2; }
class Color { @location(0) color: vec4; }
@vertex export function vs(@builtin("vertex_index") vi: u32): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.) };
}`;

function editor(source: string): string[] {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${d.message}`);
}

/** Compile `body` beside a fragment entry, require both halves to say nothing, and hand back the
 *  emitted text. */
function emit(body: string, fs: string) {
  const source = `"use typeshade";\n${body}\n${FRAGMENT}\n${fs}`;
  const r = compile(source);
  expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
  expect(editor(source)).toEqual([]);
  return { wgsl: r.wgsl!, glsl: r.glsl!.fragment, module: r.module };
}

const RUN_FS = `@fragment export function fs(v: VsOut): Color { return { color: vec4(run(), 0., 0., 1.) }; }`;

/** `emit` with an entry that calls `run()`, and every CPU path's `run()` held to `expected`. */
function runs(body: string, expected: number) {
  const out = emit(body, RUN_FS);
  for (const precision of ['f64', 'f32'] as const) {
    expect(compileModule(out.module, { precision }).fns.run!()).toBe(expected);
    expect(compileModuleJs(out.module, { precision }).fns.run!()).toBe(expected);
  }
  const session = startDebugSession(out.module, 'run', []);
  session.continue();
  expect(session.result).toBe(expected);
  return out;
}

const Q = `class Q { a: f32; b: f32; ws: array<f32, 4>; }`;

/** The text of the WGSL function `name`. */
const fnText = (wgsl: string, name: string): string => {
  const at = wgsl.indexOf(`fn ${name}(`);
  return wgsl.slice(at, wgsl.indexOf('\n}\n', at));
};

describe('item 1: a local that only reads a place reads the place', () => {
  it('a storage element copied in a loop is read field by field, its index read in place', () => {
    const { wgsl, glsl } = emit(
      `class S { a: f32; b: f32; c: vec4f; }\nconst items = storage<array<S>>();`,
      `@fragment export function fs(v: VsOut): Color {
  let acc = 0.;
  for (let i = 0; i < 4; i++) {
    const q = items[u32(i) + u32(v.uv.x)];
    acc += q.a * q.b + q.c[i & 3];
  }
  return { color: vec4(acc, 0., 0., 1.) };
}`,
    );
    const fs = fnText(wgsl, 'fs');
    expect(fs).not.toMatch(/let q = /);
    // The index calls no function of the module and nothing writes its names in the loop body,
    // so it holds one value and needs no temporary (change 0105, item 3).
    expect(fs).not.toContain('_pl0');
    expect(fs).toMatch(/items\[\(u32\(i\) \+ \w+\)\]\.a/);
    expect(fs).toMatch(/items\[\(u32\(i\) \+ \w+\)\]\.c\[\(i & 3\)\]/);
    // On WebGL2 the emulated element is read one field at a time, which compiles.
    expect(glsl).not.toMatch(/\bS\w* q = /);
  });

  it('a local array element is read in place, and the value is the copy it was', () => {
    const { wgsl } = runs(
      `${Q}
function run(): f32 {
  let qs: array<Q, 2> = [{ a: 1., b: 2., ws: [1., 2., 3., 4.] }, { a: 3., b: 4., ws: [5., 6., 7., 8.] }];
  let acc = 0.;
  for (let i = 0; i < 2; i++) {
    const q = qs[i];
    acc += q.a * q.b + q.ws[3];
  }
  return acc;
}`,
      2 + 4 + 12 + 8,
    );
    const run = fnText(wgsl, 'run');
    expect(run).not.toMatch(/let q = /);
    expect(run).toContain('qs[i].a');
  });

  it('a let that is never written is read in place too (Decision D2)', () => {
    const { wgsl } = runs(
      `${Q}
function run(): f32 {
  let qs: array<Q, 2> = [{ a: 1., b: 2., ws: [1., 2., 3., 4.] }, { a: 3., b: 4., ws: [5., 6., 7., 8.] }];
  let q = qs[1];
  return q.a + q.ws[0];
}`,
      8,
    );
    expect(fnText(wgsl, 'run')).not.toMatch(/var q: /);
  });

  it('stays a copy when the place is written while the local is read', () => {
    const { wgsl } = runs(
      `${Q}
function run(): f32 {
  let qs: array<Q, 2> = [{ a: 1., b: 2., ws: [1., 2., 3., 4.] }, { a: 3., b: 4., ws: [5., 6., 7., 8.] }];
  const q = qs[0];
  qs[0].a = 50.;
  return q.a + qs[0].a;
}`,
      51,
    );
    // A copy still, now a `var` (change 0105, item 1).
    expect(fnText(wgsl, 'run')).toMatch(/var q: Q = qs\[0\];/);
  });

  it('stays a copy when the local is written', () => {
    const { wgsl } = runs(
      `${Q}
function run(): f32 {
  let qs: array<Q, 2> = [{ a: 1., b: 2., ws: [1., 2., 3., 4.] }, { a: 3., b: 4., ws: [5., 6., 7., 8.] }];
  let q = qs[0];
  q.a = 9.;
  return q.a + qs[0].a;
}`,
      10,
    );
    expect(fnText(wgsl, 'run')).toMatch(/var q: Q = qs\[0\];/);
  });

  it('stays a copy of shared memory across a barrier', () => {
    const r = compile(`"use typeshade";
class Cell { a: f32; b: f32; }
let tile: workgroup<array<Cell, 64>>;
const out = storage<array<f32>, "read_write">();
@compute([64])
export function main(@builtin("local_invocation_index") i: u32) {
  tile[i].a = f32(i);
  const c = tile[(i + u32(1)) % u32(64)];
  workgroupBarrier();
  out[i] = c.a;
}`);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
    expect(fnText(r.wgsl!, 'main')).toMatch(/var c: Cell = tile\[/);
  });
});

describe('item 2: a struct a call returns into a local is written there (WGSL)', () => {
  const HIT = `class Hit { t: f32; n: vec3f; ok: bool; }
function probe(k: f32): Hit { return { t: k * 2., n: vec3f(k), ok: k > 0. }; }`;

  it('a var initialized by the call, and an assignment of it, take the result through a pointer', () => {
    const { wgsl, glsl } = runs(
      `${HIT}
function run(): f32 {
  let h = probe(1.5);
  let best: Hit = { t: 0., n: vec3f(0.), ok: false };
  for (let j = 0; j < 3; j++) { best = probe(f32(j)); }
  return h.t + best.t;
}`,
      3 + 4,
    );
    expect(wgsl).toContain('fn probe_into(_dst: ptr<function, Hit>, k: f32) {');
    expect(wgsl).toContain('(*_dst) = Hit(');
    const run = fnText(wgsl, 'run');
    expect(run).toContain('var h: Hit;\n  probe_into(&h, 1.5);');
    expect(run).toContain('probe_into(&best, f32(j));');
    // GLSL ES 3.00's `out` is a copy back, so it keeps the return (Decision D1).
    expect(glsl).toContain('Hit probe(float k)');
  });

  it("a constructor builds the caller's local itself, through its returned local", () => {
    const { wgsl } = runs(
      `class P { x: f32; y: f32; constructor(a: f32) { this.x = a; this.y = a * 3.; } }
function run(): f32 {
  let p = new P(2.);
  return p.x + p.y;
}`,
      8,
    );
    expect(wgsl).toContain('fn P_new_into(_dst: ptr<function, P>, a: f32) {');
    expect(fnText(wgsl, 'P_new_into')).not.toMatch(/var self_/);
    expect(fnText(wgsl, 'run')).toContain('P_new_into(&p, 2.0);');
  });

  it('keeps the copy when an argument reads the destination', () => {
    const { wgsl } = runs(
      `${HIT}
function bump(h: Hit, k: f32): Hit { return { t: h.t + k, n: h.n, ok: h.ok }; }
function run(): f32 {
  let h = probe(1.);
  h = bump(h, 5.);
  return h.t;
}`,
      7,
    );
    expect(fnText(wgsl, 'run')).toMatch(/h = bump\(/);
  });
});

describe('change 0105: fewer copies', () => {
  const SHIP = `class Leg { len: f32; w: f32; }
class Ship {
  legs: array<Leg, 2>; k: f32;
  constructor(k: f32) { this.legs = [{ len: k, w: 1. }, { len: k * 2., w: 2. }]; this.k = k; }
  leg(i: i32): f32 { return this.legs[i].len * this.k; }
  total(): f32 { return this.leg(0) + this.leg(1); }
}`;

  it('item 1: a struct local built by a value is a place, so its methods take a pointer', () => {
    const { wgsl } = runs(
      `${SHIP}
function run(): f32 {
  const ship = new Ship(2.);
  return ship.total();
}`,
      4 + 8,
    );
    const run = fnText(wgsl, 'run');
    expect(run).toContain('var ship: Ship;');
    expect(run).toMatch(/Ship_total\(&ship\)/);
    expect(wgsl).not.toContain('_value(');
    expect(wgsl).toMatch(/fn Ship_leg\(self_: ptr<function, Ship>, i: i32\)/);
  });

  it('item 2: a struct returned into a storage element is written there', () => {
    const source = `"use typeshade";
class Hit { t: f32; n: vec3f; }
const out = storage<array<Hit>, "read_write">();
function probe(k: f32): Hit { return { t: k * 2., n: vec3f(k) }; }
@compute([64])
export function main(@builtin("global_invocation_id") g: vec3u) {
  out[g.x] = probe(f32(g.x));
}`;
    const r = compile(source);
    expect(editor(source)).toEqual([]);
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
    expect(r.wgsl).toContain('fn probe_into(_dst: ptr<storage, Hit, read_write>, k: f32) {');
    expect(fnText(r.wgsl!, 'main')).toContain('probe_into(&out[g.x], f32(g.x));');
  });

  it('item 2: a struct returned into a module variable is written there, unless the callee reads it', () => {
    const { wgsl } = runs(
      `class Hit { t: f32; n: vec3f; }
let last: Hit = { t: 0., n: vec3f(0.) };
function probe(k: f32): Hit { return { t: k * 2., n: vec3f(k) }; }
function again(k: f32): Hit { return { t: last.t + k, n: last.n }; }
function run(): f32 {
  last = probe(3.);
  const a = last.t;
  last = again(1.);
  return a + last.t;
}`,
      6 + 7,
    );
    const run = fnText(wgsl, 'run');
    expect(run).toContain('probe_into(&last, 3.0);');
    expect(run).toMatch(/last = again\(1\.0\);/);
  });

  it('item 4: a write to another element or another field keeps the local in place', () => {
    const { wgsl } = runs(
      `${Q}
function run(): f32 {
  let qs: array<Q, 2> = [{ a: 1., b: 2., ws: [1., 2., 3., 4.] }, { a: 3., b: 4., ws: [5., 6., 7., 8.] }];
  let acc = 0.;
  for (let i = 0; i < 2; i++) {
    const w = qs[i].ws;
    qs[i].b = 7.;
    acc += w[1];
    const q = qs[0];
    qs[1].a = 50.;
    acc += q.a;
  }
  return acc;
}`,
      1 + 2 + 1 + 6,
    );
    const run = fnText(wgsl, 'run');
    expect(run).not.toMatch(/var q: /);
    expect(run).not.toMatch(/var w: /);
    expect(run).toContain('qs[0].a');
    expect(run).toContain('qs[i].ws[1]');
  });

  it('item 4: a write that may reach the part read keeps the copy', () => {
    const { wgsl } = runs(
      `${Q}
function run(): f32 {
  let qs: array<Q, 2> = [{ a: 1., b: 2., ws: [1., 2., 3., 4.] }, { a: 3., b: 4., ws: [5., 6., 7., 8.] }];
  let acc = 0.;
  for (let i = 0; i < 2; i++) {
    const q = qs[0];
    qs[i].a = 50.;
    acc += q.a;
  }
  return acc;
}`,
      1 + 50,
    );
    expect(fnText(wgsl, 'run')).toMatch(/var q: Q = qs\[0\];/);
  });

  it('item 3: an index a call of the module computes is still bound once', () => {
    const { wgsl } = runs(
      `${Q}
function pick(k: i32): i32 { return k & 1; }
function run(): f32 {
  let qs: array<Q, 2> = [{ a: 1., b: 2., ws: [1., 2., 3., 4.] }, { a: 3., b: 4., ws: [5., 6., 7., 8.] }];
  const q = qs[pick(3)];
  return q.a + q.b;
}`,
      7,
    );
    expect(fnText(wgsl, 'run')).toMatch(/let _pl0 = pick\(3\);/);
  });
});
