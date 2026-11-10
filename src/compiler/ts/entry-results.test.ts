// An entry that writes no return type returns what its body says (Rule 8.19, change 0136).
//
// A bare result takes the attribute its stage gives the type (Rule 8.2), a struct result its
// fields' attributes, and an object literal the one struct the program declares whose fields
// are its names, a resource struct excluded (surface §16). Read twice, as every program an
// author writes is (CLAUDE.md, "A test reads both halves"): `compile()`'s diagnostics and emit,
// and the language service's diagnostics and hover on the same source, where the hover of an
// entry shows the result the compiler inferred.
//
// Verifies: Rule 8.19 (docs/language-design.md; traced in reqs/).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { migrateSource } from '../../cli/migrate.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const errorsOf = (src: string): string[] =>
  compile(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const editorErrorsOf = (src: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', src);
  return service
    .getDiagnostics('a.shade.ts')
    .filter((d) => d.severity === 'error')
    .map((d) => `${String(d.code)} ${d.message}`);
};

const hoverAt = (src: string, needle: string, offset = 0): string | undefined => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', src);
  const before = src.slice(0, src.indexOf(needle) + offset).split('\n');
  return service.getHover('a.shade.ts', {
    line: before.length - 1,
    character: before[before.length - 1]!.length,
  })?.contents;
};

const VS_OUT = `interface VsOut {
  pos: builtin<"position">;
  uv: location<0, vec2>;
}`;

describe('an entry with no return type returns what its body says (Rule 8.19)', () => {
  it('emits a bare vec4 vertex result as the position, and a bare fragment result at location 0', () => {
    const src = `"use typeshade";
@vertex export function vs(vi: builtin<"vertex_index">) {
  return vec4(f32(vi), 0., 0., 1.);
}
@fragment export function fs() {
  return vec3(1., 0., 0.);
}
`;
    expect(errorsOf(src)).toEqual([]);
    expect(editorErrorsOf(src)).toEqual([]);
    const written = compile(
      src.replace('fs() {', 'fs(): vec3 {').replace('u32>) {', 'u32>): vec4 {'),
    );
    const inferred = compile(src);
    expect(inferred.wgsl).toContain('-> @builtin(position) vec4<f32>');
    expect(inferred.wgsl).toContain('-> @location(0) vec3<f32>');
    expect(inferred.wgsl).toBe(written.wgsl);
    expect(inferred.glsl).toEqual(written.glsl);
    expect(hoverAt(src, 'function fs', 9)).toContain('fs(): vec3');
  });

  it('takes a struct value as its result, and a literal the struct its names match', () => {
    const src = `"use typeshade";
${VS_OUT}
@vertex export function vs(vi: builtin<"vertex_index">) {
  const x = f32(vi);
  return { pos: vec4(x, x, 0., 1.), uv: vec2(x, x) };
}
@vertex export function vs2(vi: builtin<"vertex_index">) {
  const o: VsOut = { pos: vec4(0., 0., 0., 1.), uv: vec2(f32(vi), 0.) };
  return o;
}
@fragment export function fs(v: VsOut): vec4 {
  return vec4(v.uv, 0., 1.);
}
`;
    expect(errorsOf(src)).toEqual([]);
    expect(editorErrorsOf(src)).toEqual([]);
    expect(compile(src).wgsl).toContain('fn vs(@builtin(vertex_index) vi: u32) -> VsOut {');
    expect(compile(src).wgsl).toContain('fn vs2(@builtin(vertex_index) vi: u32) -> VsOut {');
    expect(hoverAt(src, 'function vs(', 9)).toContain('): VsOut');
    expect(hoverAt(src, 'function vs2', 9)).toContain('): VsOut');
    // A field of the literal reads the struct's type, not TypeScript's `any` (the review of
    // change 0136 found `uv: any`).
    expect(hoverAt(src, 'uv: vec2(x', 0)).toContain('uv: vec2');
    // And the entry's parameter shows the compiler's type.
    expect(hoverAt(src, 'fs(v', 3)).toContain('v: VsOut');
  });

  it('finds a struct the program names nowhere else, and never a resource struct', () => {
    const example = readFileSync(
      fileURLToPath(new URL('../../../examples/loops-over-data.shade.ts', import.meta.url)),
      'utf8',
    );
    // The example with both entries' return types left off and `while (true)` written `for
    // (;;)`: `Color` is named nowhere else, and the emit is the example's.
    const after = example
      .replace(
        'function vs(vi: builtin<"vertex_index">): VsOut {',
        'function vs(vi: builtin<"vertex_index">) {',
      )
      .replace('function fs(v: VsOut): Color {', 'function fs(v: VsOut) {')
      .replace('while (true) {', 'for (;;) {');
    expect(after).not.toBe(example);
    expect(errorsOf(after)).toEqual([]);
    expect(editorErrorsOf(after)).toEqual([]);
    expect(compile(after).wgsl).toBe(compile(example).wgsl);
    expect(compile(after).glsl).toEqual(compile(example).glsl);
    expect(hoverAt(after, 'function fs', 9)).toContain('fs(v: VsOut): Color');
    // `Frame` is a uniform's struct: a literal of its fields is no entry's result.
    const frame = `"use typeshade";
interface Frame { steps: i32; depth: i32 }
declare const frame: uniform<Frame>;
@fragment export function fs() {
  return { steps: frame.steps, depth: 1 };
}
`;
    const refusal =
      'TS8022 Object literal { steps, depth } matches no struct an entry can return, so the ' +
      "entry's result is not known: write the return type.";
    expect(errorsOf(frame)).toEqual([refusal]);
    expect(editorErrorsOf(frame)).toContain(refusal);
  });

  it('says nothing of the literal a refused arrow entry returns as its expression body (change 0140)', () => {
    // An entry written as an arrow function through a stage call is refused (Rule 8.1). Its
    // literal is still read against the struct an entry returns, so the refusal of the call is
    // the one diagnostic for it in both halves (Rule 12.4).
    const src = `"use typeshade";
${VS_OUT}
interface Color { color: location<0, vec4> }
export const vs = vertex((i: builtin<"vertex_index">) => ({ pos: vec4(f32(i), 0., 0., 1.), uv: vec2(0., 0.) }));
export const fs = fragment((v: VsOut) => ({ color: vec4(v.uv, 0., 1.) }));
`;
    const refusals = [
      'TS8028 a stage is an attribute on the function declaration: write "@vertex export function vs(…)", or run "tshc migrate" (change 0130)',
      'TS8028 a stage is an attribute on the function declaration: write "@fragment export function fs(…)", or run "tshc migrate" (change 0130)',
    ];
    expect(errorsOf(src)).toEqual(refusals);
    expect(editorErrorsOf(src)).toEqual(refusals);
    // The declarations `tshc migrate` writes return the same literals, with no diagnostic.
    const migrated = migrateSource(src).text;
    expect(errorsOf(migrated)).toEqual([]);
    expect(editorErrorsOf(migrated)).toEqual([]);
    expect(compile(migrated).wgsl).toContain('-> Color {');
    expect(hoverAt(migrated, 'function fs', 9)).toContain('): Color');
  });

  it("refuses a literal two structs match, and keeps a helper's literal on the used struct", () => {
    // The used `P` beside an unused twin `Q` builds a `P` in a helper, as before the change.
    const helper = `"use typeshade";
interface P { a: f32; b: f32 }
interface Q { a: f32; b: f32 }
function sum(p: P): f32 { return p.a + p.b; }
export function f(x: f32): f32 {
  const o = { a: x, b: 2. };
  return sum(o);
}
`;
    expect(errorsOf(helper)).toEqual([]);
    expect(editorErrorsOf(helper)).toEqual([]);
    expect(compile(helper).eval('f', [1])).toBe(3);
    // An entry's literal that matches both is the one TS8022.
    const entry = `"use typeshade";
interface P { a: location<0, vec4>; b: location<1, vec4> }
interface Q { a: location<0, vec4>; b: location<1, vec4> }
function first(p: P): vec4 { return p.a; }
@fragment export function fs() {
  return { a: first({ a: vec4(1.), b: vec4(0.) }), b: vec4(0.) };
}
`;
    const refusal =
      'TS8022 Object literal { a, b } matches "P" and "Q" alike, so the entry\'s result is not ' +
      'known: write the return type.';
    expect(errorsOf(entry)).toEqual([refusal]);
    expect(editorErrorsOf(entry)).toContain(refusal);
  });

  it('refuses what a written return type cannot say either', () => {
    // A vertex entry that returns nothing has no position: one diagnostic, not the three the
    // missing return type gave before (issue #1129).
    const nothing = `"use typeshade";
@vertex export function vs(vi: builtin<"vertex_index">) {
  const x = f32(vi);
}
`;
    expect(errorsOf(nothing)).toEqual([
      'TS8020 "vs" is a vertex entry, so it returns the position: a vec4, which is the position on its own, or a struct with a field typed builtin<"position">. It returns nothing.',
    ]);
    // A compute entry returns nothing.
    const compute = `"use typeshade";
@compute([64]) export function k(gid: builtin<"global_invocation_id">) {
  return f32(gid.x);
}
`;
    const said =
      'TS8021 Entry function "k" is a compute entry, and a compute entry returns nothing (WGSL): it returns f32. Write the value to a storage binding.';
    expect(errorsOf(compute)).toEqual([said]);
    expect(editorErrorsOf(compute)).toContain(said);
  });
});
