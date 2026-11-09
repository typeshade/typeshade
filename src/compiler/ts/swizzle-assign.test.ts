// Verifies: Rule 7.1, Rule 7.2 (docs/language-design.md; traced in reqs/).
// ═══ A multi-component swizzle as an assignment target (change 0106) ═══
//
// `v.xy = r` and `v.xy op= r` read every old component the operation needs into one `let`, then
// write each destination component from it (`splitSwizzleWrite`, src/compiler/ts/lower/
// statement.ts). The writes are one-component writes, so WGSL needs no `swizzle_assignment`
// extension and GLSL ES 3.00 and the CPU oracle evaluate the same IR (decisions D1, D2). A
// swizzle that names a component twice stays `TS8018`. Each case reads both halves: compile()
// and the language service on the same source (Rule 12.7).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const source = (body: string): string => `"use typeshade";\n${body}\n`;

/** The compiler's and the editor's diagnostics of one source, which must be the same list. */
function bothHalves(body: string): { compiled: string[]; result: ReturnType<typeof compile> } {
  const src = source(body);
  const result = compile(src, { fileName: 'sw.shade.ts' });
  const compiled = result.diagnostics.map((d) => `${d.code} ${d.message}`);
  const service = createTypeshadeLanguageService();
  service.openDocument('sw.shade.ts', src);
  const edited = service.getDiagnostics('sw.shade.ts').map((d) => `${String(d.code)} ${d.message}`);
  expect(edited, 'the editor reads the program as the compiler does').toEqual(compiled);
  return { compiled, result };
}

/** Runs `fn` on both CPU tiers and returns the oracle's answer, after checking they agree. */
function run(result: ReturnType<typeof compile>, fn: string, ...args: unknown[]): unknown {
  const oracle = compileModule(result.module).fns[fn]!(...(args as never[]));
  const js = compileModuleJs(result.module).fns[fn]!(...(args as never[]));
  expect(js, 'the two CPU tiers agree').toEqual(oracle);
  return oracle;
}

/** The body of `fn` in a WGSL or GLSL text. */
const fnText = (text: string, head: string): string => {
  const at = text.indexOf(head);
  expect(at, `"${head}" is in the emitted text`).toBeGreaterThanOrEqual(0);
  return text.slice(at, text.indexOf('\n}\n', at) + 2);
};

describe('a multi-component swizzle target (change 0106)', () => {
  const REGRESSIONS = `export function f(): vec4f {
  let d = vec2f(2., 3.);
  d.xy *= d.yx;
  let e = vec2f(2., 3.);
  e.yx *= vec2f(0.5, 2.);
  return vec4f(d, e);
}
export const fs = fragment(function fs(): vec4f {
  return f();
});`;

  it('reads the old components before any write: d.xy *= d.yx is (6, 6), e.yx *= … is (4, 1.5)', () => {
    const { compiled, result } = bothHalves(REGRESSIONS);
    expect(compiled).toEqual([]);
    expect(run(result, 'f')).toEqual([6, 6, 4, 1.5]);
  });

  it('emits a let and one write per component on WGSL and GLSL ES 3.00, with no extension', () => {
    const { result } = bothHalves(REGRESSIONS);
    const wgsl = result.wgsl ?? '';
    expect(wgsl).not.toContain('swizzle_assignment');
    const f = fnText(wgsl, 'fn f(');
    expect(f).not.toMatch(/\.(xy|yx)\s*[*+\-/]?=/);
    expect(f).toMatch(/let (_sw\w*) = \(d\.xy \* d\.yx\);\s*d\.x = \1\.x;\s*d\.y = \1\.y;/);
    expect(f).toMatch(
      /let (_sw\w*) = \(e\.yx \* vec2<f32>\(0\.5, 2\.0\)\);\s*e\.y = \1\.x;\s*e\.x = \1\.y;/,
    );
    const glsl = result.glsl?.fragment ?? '';
    const g = fnText(glsl, 'vec4 f(');
    expect(g).not.toMatch(/\.(xy|yx)\s*[*+\-/]?=/);
    expect(g).toMatch(/d\.x = \w+\.x;/);
  });

  it('takes = and each compound operator, with a vector or a scalar on the right', () => {
    const { compiled, result } = bothHalves(`export function f(): vec4f {
  let a = vec4f(1., 2., 3., 4.);
  a.zx = vec2f(10., 20.);
  a.yw += vec2f(1., 2.);
  a.xyz -= 1.;
  a.wz *= 2.;
  a.xy /= vec2f(2., 4.);
  return a;
}`);
    expect(compiled).toEqual([]);
    // (1,2,3,4) → zx=(10,20): (20,2,10,4) → yw+=(1,2): (20,3,10,6) → xyz-=1: (19,2,9,6)
    // → wz*=2: (19,2,18,12) → xy/=(2,4): (9.5,0.5,18,12)
    expect(run(result, 'f')).toEqual([9.5, 0.5, 18, 12]);
  });

  it('takes the compound form on an integer vector', () => {
    // A bitwise op= on a vector is refused for the whole vector too (TS8003, "needs an i32 or u32
    // target"); change 0106 does not widen it.
    const { compiled, result } = bothHalves(`export function f(): vec3u {
  let a = vec3u(12, 10, 7);
  a.zy += u32(1);
  a.xz -= vec2u(2, 3);
  return a;
}`);
    expect(compiled).toEqual([]);
    // zy+=1: (12,11,8) → xz-=(2,3): (10,11,5)
    expect(run(result, 'f')).toEqual([10, 11, 5]);
  });

  it('writes a swizzle of a field and of an element of a local array', () => {
    const { compiled, result } = bothHalves(`interface P { pos: vec3f; w: f32 }
export function f(k: u32): vec4f {
  let p: P = { pos: vec3f(1., 2., 3.), w: 0. };
  p.pos.zx = vec2f(7., 8.);
  let a: array<vec2f, 2> = [vec2f(1., 2.), vec2f(3., 4.)];
  a[k].yx += vec2f(10., 20.);
  return vec4f(p.pos.x, p.pos.z, a[1].x, a[1].y);
}`);
    expect(compiled).toEqual([]);
    expect(run(result, 'f', 1)).toEqual([8, 7, 23, 14]);
  });

  it('reads an index that calls once, before the right-hand side', () => {
    const { compiled, result } = bothHalves(`function next(@inout n: u32): u32 {
  n = n + 1;
  return n - 1;
}
export function f(): vec4f {
  let n: u32 = 0;
  let a: array<vec2f, 2> = [vec2f(1., 2.), vec2f(3., 4.)];
  a[next(n)].xy += vec2f(f32(n), 10.);
  return vec4f(a[0], f32(n), a[1].x);
}`);
    expect(compiled).toEqual([]);
    // next(n) runs once: the index is 0 and n is 1 when the right-hand side reads it.
    expect(run(result, 'f')).toEqual([2, 12, 1, 3]);
    const f = fnText(result.wgsl ?? '', 'fn f(');
    expect(f.match(/\bnext\(/g)?.length, 'next is called once').toBe(1);
  });

  it('writes through a storage<…, "read_write"> element and a workgroup vector', () => {
    const { compiled, result } = bothHalves(`declare const buf: storage<array<vec4f>, "read_write">;
let shared: workgroup<vec2f>;
export const main = compute([1], function main(gid: builtin<"global_invocation_id", vec3u>) {
  buf[gid.x].wy = vec2f(5., 6.);
  shared.yx = vec2f(1., 2.);
  buf[gid.x].xz += shared;
});`);
    expect(compiled).toEqual([]);
    const main = fnText(result.wgsl ?? '', 'fn main(');
    expect(main).toMatch(/buf\[(\w+)\]\.w = [^;]+;\s*buf\[\1\]\.y = /);
    expect(main).not.toMatch(/\.(wy|yx|xz)\s*[+]?=/);
  });

  it('lets a kernel function write a swizzle of its element, on the GPU and the CPU tier', () => {
    const { compiled, result } = bothHalves(`export function swap(v: array<vec2f>) {
  for (let i: u32 = 0; i < v.length; i++) {
    v[i].yx = v[i];
  }
}`);
    expect(compiled, 'the proof accepts the component stores').toEqual([]);
    const v = [
      [1, 2],
      [3, 4],
    ];
    compileModule(result.module).fns['swap']!(v as never);
    expect(v).toEqual([
      [2, 1],
      [4, 3],
    ]);
  });
});

describe('what stays refused (change 0106)', () => {
  it('refuses a swizzle that names a component twice, naming it, on both halves', () => {
    const { compiled } = bothHalves(`export function f(a: vec2f): vec3f {
  let d = vec3f(1., 2., 3.);
  d.xx = a;
  d.yxy += vec3f(1.);
  return d;
}`);
    expect(compiled).toEqual([
      `${TS_CODES.ASSIGN_TARGET} Cannot assign to the swizzle ".xx" — it names ".x" twice, so two writes would land on one component. Name each component once.`,
      `${TS_CODES.ASSIGN_TARGET} Cannot assign to the swizzle ".yxy" — it names ".y" twice, so two writes would land on one component. Name each component once.`,
    ]);
  });

  it('keeps a repeated swizzle TS8018 on a read binding, and a valid one TS8005', () => {
    // The compiler half only: on a read binding the editor also reports TypeScript's own
    // read-only error before compile() runs (surface §7, TS2540 / TS2542).
    const result = compile(
      source(`declare const ro: storage<array<vec2f>>;
export const main = compute([1], function main(gid: builtin<"global_invocation_id", vec3u>) {
  ro[gid.x].xx = vec2f(1.);
  ro[gid.x].xy = vec2f(1.);
});`),
      { fileName: 'sw.shade.ts' },
    );
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      TS_CODES.ASSIGN_TARGET,
      TS_CODES.CONST_ASSIGN,
    ]);
  });

  it('keeps an emulated-double lane no place', () => {
    const { compiled } = bothHalves(`export function f(): vec2f64 {
  let d = vec2f64(f64(1), f64(2));
  d.yx = vec2f64(f64(3), f64(4));
  return d;
}`);
    expect(compiled).toHaveLength(1);
    expect(compiled[0]!.startsWith(TS_CODES.ASSIGN_TARGET)).toBe(true);
  });
});
