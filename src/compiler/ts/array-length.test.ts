// `xs.length`, the one spelling of what WGSL's `arrayLength(&xs)` reads on a runtime-sized storage
// array (#46, second half; the free call `arrayLength(xs)` was removed by change 0112). What the
// operand may be is what WGSL's builtin accepts, measured on Tint: a pointer to a runtime-sized
// array in storage, the binding or a trailing struct field. `unsized-array-length.test.ts`
// covers the `.length` shapes; this file covers the operand rules, the refusal of the removed
// call, and what the CPU backends compute.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const KERNEL = `"use typeshade";
declare const src: storage<array<f32>>;
declare const dst: storage<array<f32>, "read_write">;
export const main_k = compute([64, 1, 1], function main_k(gid: builtin<"global_invocation_id", vec3u>): void {
  if (gid.x >= src.length) {
    return;
  }
  dst[gid.x] = src[gid.x] * 2.;
});
`;

const errorsOf = (src: string) =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const editorOf = (src: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', src);
  return service.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${d.message}`);
};

describe('xs.length on a runtime-sized storage array', () => {
  it('spells arrayLength(&xs) on WGSL and is a u32', () => {
    const r = compile(KERNEL);
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('if ((gid.x >= arrayLength(&src))) {');
    expect(editorOf(KERNEL)).toEqual([]);
  });

  it('takes a trailing array field of a storage struct', () => {
    const src = `"use typeshade";
class Buf { n!: u32; xs!: array<f32>; }
declare const b: storage<Buf>;
export const fs = fragment(function fs(): vec4 { return vec4(f32(b.xs.length), 0., 0., 1.); });
`;
    const r = compileTsSource(src);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('arrayLength(&b.xs)');
    expect(editorOf(src)).toEqual([]);
  });

  it('follows a local that copies the binding', () => {
    const src = `"use typeshade";
declare const src: storage<array<f32>>;
export const fs = fragment(function fs(): vec4 {
  const a = src;
  return vec4(f32(a.length), 0., 0., 1.);
});
`;
    const r = compileTsSource(src);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('arrayLength(&src)');
    expect(editorOf(src)).toEqual([]);
  });

  it('has no length on an element: the pointee must be the runtime-sized array', () => {
    // Tint: `arrayLength(&src[0])` has no matching call. An element is an `f32`, which has no
    // `.length`, and the front end says what it got.
    const src = `"use typeshade";
declare const src: storage<array<f32>>;
export const fs = fragment(function fs(): vec4 { return vec4(f32(src[0].length), 0., 0., 1.); });
`;
    expect(errorsOf(src)).toEqual([
      `${TS_CODES.UNKNOWN_NAME} .length on f32 — swizzle requires vec2/vec3/vec4.`,
    ]);
    expect(editorOf(src).some((m) => m.includes('TS8022 .length on f32'))).toBe(true);
  });

  it('reads the size of a sized array as the number it is', () => {
    const src = `"use typeshade";
declare const src: storage<array<f32, 8>>;
export const fs = fragment(function fs(): vec4 { return vec4(f32(src.length), 0., 0., 1.); });
`;
    const r = compileTsSource(src);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('vec4<f32>(8.0, 0.0, 0.0, 1.0)');
    expect(r.wgsl).not.toContain('arrayLength');
    expect(editorOf(src)).toEqual([]);
  });

  it('refuses an unsized array outside storage with the fix that works for it', () => {
    const uniform = errorsOf(`"use typeshade";
declare const u: uniform<array<f32>>;
export const fs = fragment(function fs(): vec4 { return vec4(f32(u.length), 0., 0., 1.); });
`);
    // Two independent problems, so both are reported: the `.length` read below, and the
    // declaration itself — a runtime-sized array cannot live in the uniform address space at
    // all (`TS8051`, §51), which is the more fundamental of the two.
    expect(uniform).toHaveLength(2);
    expect(uniform.filter((m) => m.startsWith(TS_CODES.LAYOUT))).toHaveLength(1);
    const lengthError = uniform.filter((m) => m.startsWith(TS_CODES.UNSIZED_ARRAY_LENGTH));
    expect(lengthError).toHaveLength(1);
    expect(lengthError[0]).toContain('not known at compile time');
    expect(lengthError[0]).toContain('array<f32, 3>');
    const param = errorsOf(`"use typeshade";
function n(xs: array<f32>): u32 { return xs.length; }
`);
    // A parameter cannot hold an array with no size at all (Rule 12.6), which is the more
    // fundamental problem, and the function is not lowered past it.
    expect(param).toHaveLength(1);
    expect(param[0]).toContain(TS_CODES.FUNCTION_SHAPE);
    expect(param[0]).toContain('Parameter "xs" is array<f32>, an array with no size');
  });

  it('the removed call arrayLength(xs) is refused, whatever it is handed, on both halves', () => {
    const call = (args: string): string => `"use typeshade";
declare const src: storage<array<f32>>;
export const fs = fragment(function fs(): vec4 { return vec4(f32(arrayLength(${args})), 0., 0., 1.); });
`;
    const sentence = `${TS_CODES.UNKNOWN_FN} arrayLength was removed: write xs.length.`;
    for (const args of ['src', 'src, 1', '', 'src[0]']) {
      expect(errorsOf(call(args)), `arrayLength(${args})`).toEqual([sentence]);
      expect(editorOf(call(args)), `arrayLength(${args})`).toEqual([sentence]);
    }
  });

  it('a function the file declares with that name keeps winning the call', () => {
    // The additivity rule the §10 names follow: a removed name stays the file's own when the
    // file declares it (Rule 9.5). It is emitted as `arrayLength_`, a name WGSL does not
    // predeclare, and the call through it with that name.
    const src = `"use typeshade";
function arrayLength(x: f32): f32 { return x * 2.; }
export const fs = fragment(function fs(): vec4 { return vec4(arrayLength(1.5), 0., 0., 1.); });
`;
    const r = compileTsSource(src);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('fn arrayLength_(x: f32) -> f32 {');
    expect(r.wgsl).toContain('arrayLength_(1.5)');
    expect(r.wgsl).not.toContain('&');
    expect(editorOf(src)).toEqual([]);
  });

  it("the oracle and the CPU codegen read the bound buffer's length", () => {
    const r = compile(KERNEL);
    for (const make of [compileModule, compileModuleJs]) {
      const cm = make(r.module);
      const src = [1, 2, 3];
      const dst = [0, 0, 0, 0];
      cm.setBinding('src', src);
      cm.setBinding('dst', dst);
      for (let g = 0; g < 4; g++) cm.fns['main_k']!([g, 0, 0]);
      // Three doubled, the fourth invocation guarded out by the length it read.
      expect(dst, make.name).toEqual([2, 4, 6, 0]);
    }
  });

  it('.length lowers to the builtin arrayLength node, which no declaration stands behind', () => {
    const r = compileTsSource(KERNEL);
    const text = JSON.stringify(r.funcs[0]!.body, (key, value) =>
      key === 'span' ? undefined : value,
    );
    expect(text).toContain('"fn":"arrayLength"');
    expect(text).not.toContain('declRef');
  });
});
