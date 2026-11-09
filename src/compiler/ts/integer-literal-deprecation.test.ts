// The deprecation window before an integer-written literal types as i32 (§13, #148).
//
// STEP ONE ONLY, which is the whole of this change: the diagnostic exists, it is off by
// default, and the default typing has not moved. The flip is a breaking change to every module
// that leans on `let i = 0` being an `f32`, and it gets its own release, its own golden review
// and its own entry.
// #321 misc#6/#7: report only affected declarations, with a remedy that still compiles.
//
// Verifies: Rule 13.10 (docs/language-design.md; traced in reqs/). This is the window's first
// step: a warning behind the opt-in option, with no emitted byte moved.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { checkDocuments, type CheckDiagnostic } from '../../language-service/check.js';

function paired(
  source: string,
  deprecations = true,
  extraChecker: readonly Pick<
    CheckDiagnostic,
    'code' | 'message' | 'offset' | 'length' | 'severity'
  >[] = [],
) {
  const uri = '/app/deprecations.shade.ts';
  const compiled = compile(source, { fileName: uri, deprecations });
  const checked = checkDocuments([{ path: uri, uri, text: source }], { deprecations });
  expect(
    checked.diagnostics.map(({ code, message, offset, length, severity }) => ({
      code,
      message,
      offset,
      length,
      severity,
    })),
  ).toEqual([
    ...compiled.diagnostics.map(({ code, message, start, length, category }) => ({
      code,
      message,
      offset: start,
      length,
      severity: category,
    })),
    ...extraChecker,
  ]);
  const off = compile(source, { fileName: uri });
  expect(compiled.wgsl).toBe(off.wgsl);
  expect(compiled.glsl).toEqual(off.glsl);
  expect(compiled.module).toEqual(off.module);
  return compiled;
}

const SRC = `"use typeshade";
export function f(xs: array<f32, 4>): f32 {
  let i = 0;
  const K = 5;
  const n = 2 + 3;
  let x = 5.;
  let y: f32 = 7;
  return xs[i32(i)] + K + f32(n) + x + y;
}`;

const warnings = (source: string, deprecations: boolean) =>
  compile(source, { deprecations }).diagnostics.filter((d) => d.category === 'warning');

describe('the integer-literal deprecation, behind its flag', () => {
  it('says nothing at all by default', () => {
    expect(warnings(SRC, false)).toEqual([]);
    // And nothing is an error either: the program compiles today exactly as it did.
    expect(compile(SRC).diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  });

  it('names the declaration and the fix while the flag is on', () => {
    const found = warnings(SRC, true);
    expect(found.map((d) => d.code)).toEqual([
      TS_CODES.INT_LITERAL_DEPRECATION,
      TS_CODES.INT_LITERAL_DEPRECATION,
      TS_CODES.INT_LITERAL_DEPRECATION,
    ]);
    expect(found[0]!.message).toBe(
      '"i" is written as an integer and types as f32 today; it will type as i32 ' +
        '(§13, #148). Write "i = 0." to keep f32, or leave it and take i32.',
    );
    // A TREE of integer literals has no one-character fix, so it is told to annotate.
    expect(found[2]!.message).toContain('Annotate it — "n: f32 = 2 + 3"');
    // It points at the declaration the author wrote, not at the file.
    expect(found.map((d) => d.line)).toEqual([3, 4, 5]);
  });

  it('leaves a float-written literal and an annotated declaration alone', () => {
    // `let x = 5.` is an f32 today and an f32 after the flip; `let y: f32 = 7` declares its
    // type, so the literal is already decided and the flip does not move it.
    for (const name of ['"x"', '"y"']) {
      expect(
        warnings(SRC, true).some((d) => d.message.includes(name)),
        name,
      ).toBe(false);
    }
  });

  it('moves no emitted byte, which is what makes it safe to turn on', () => {
    const off = compile(SRC);
    const on = compile(SRC, { deprecations: true });
    expect(on.wgsl).toBe(off.wgsl);
    expect(on.glsl).toEqual(off.glsl);
  });

  it('reaches a module-scope const as well as a local', () => {
    const found = warnings(
      `"use typeshade";
const LEVELS = 4;
export function f(): f32 { return LEVELS; }`,
      true,
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('"LEVELS"');
  });

  it.each([
    ['0', '4', 'i32'],
    ['0', 'u32(4)', 'u32'],
    ['-1', '4', 'i32'],
    ['0 + 1', '4', 'i32'],
  ])('does not warn for an already-integer loop counter (%s; %s)', (start, bound, type) => {
    const source = `"use typeshade";
declare const out: storage<array<i32>, "read_write">;
export const cs = compute([1], function cs() {
  for (let i = ${start}; i < ${bound}; i++) out[u32(i + 1)] = i32(i);
});`;
    const result = paired(source);
    expect(result.diagnostics).toEqual([]);
    const loop = result.module.funcs
      .find((fn) => fn.name === 'cs')
      ?.body.find((s) => s.s === 'for');
    expect(loop?.init).toMatchObject({ s: 'var', type: { kind: 'scalar', scalar: type } });
    expect(result.wgsl).toContain('@compute');
  });

  it('still warns for a float-typed local declared inside a loop', () => {
    const source = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
export const cs = compute([1], function cs() {
  for (let i = 0; i < 4; i++) { let x = 3; x += 1.; out[i] = x; }
});`;
    const result = paired(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain('"x" is written as an integer');
    const loop = result.module.funcs
      .find((fn) => fn.name === 'cs')
      ?.body.find((s) => s.s === 'for');
    expect(loop?.init).toMatchObject({ s: 'var', type: { kind: 'scalar', scalar: 'i32' } });
  });

  it.each(['0x10', '0X10', '0o10', '0O10', '0b10', '0B10', '0x1_0'])(
    'offers a compiling annotation for a radix literal %s',
    (literal) => {
      const source = `"use typeshade";
export const fs = fragment(function fs(): location<0, vec4> {
  const x = ${literal};
  return vec4(x);
});`;
      const result = paired(source);
      expect(result.diagnostics).toHaveLength(1);
      const fix = `x: f32 = ${literal}`;
      expect(result.diagnostics[0]!.message).toBe(
        '"x" is written as an integer and types as f32 today; it will type as i32 ' +
          `(§13, #148). Annotate it — "${fix}" — to keep f32, or leave it and take i32.`,
      );
      const corrected = paired(source.replace(`x = ${literal}`, fix));
      expect(corrected.diagnostics).toEqual([]);
      expect(corrected.wgsl).toBe(result.wgsl);
      expect(corrected.glsl).toEqual(result.glsl);
      expect(result.wgsl).toContain('@fragment');
      expect(result.glsl?.fragment).toContain('void main()');
      expect(paired(source, false).diagnostics).toEqual([]);
    },
  );

  it('uses the same radix remedy for a module constant', () => {
    const source = `"use typeshade";
const K = 0xff;
export const fs = fragment(function fs(): location<0, vec4> { return vec4(K); });`;
    const result = paired(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain('Annotate it — "K: f32 = 0xff"');
    const corrected = paired(source.replace('K = 0xff', 'K: f32 = 0xff'));
    expect(corrected.diagnostics).toEqual([]);
    expect(corrected.wgsl).toBe(result.wgsl);
  });

  it.each(['10', '1_000'])('keeps the compiling decimal-point remedy for %s', (literal) => {
    const source = `"use typeshade";
export const fs = fragment(function fs(): location<0, vec4> {
  const x = ${literal}; return vec4(x);
});`;
    const result = paired(source);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain(`Write "x = ${literal}."`);
    const corrected = paired(source.replace(`x = ${literal}`, `x = ${literal}.`));
    expect(corrected.diagnostics).toEqual([]);
    expect(corrected.wgsl).toBe(result.wgsl);
    expect(corrected.glsl).toEqual(result.glsl);
  });

  // Change 0136 made `let i = 0, j = 1; i < 4; i++` and `let i = 0; i < 4;` open loops that
  // compile, and `const i = 0; i < 4; i++` a write to a `const` that the compiler and
  // TypeScript's TS2588 report on the same `i++`, as one diagnostic (Rule 12.4); the header that
  // stays refused for its own sake is `for (let i = 0; ; i++)`, a loop that never ends.
  it.each(['let i = 0; ; i++'])(
    'does not hide the existing reports for an invalid loop header (%s)',
    (header) => {
      const source = `"use typeshade";
export function f(): void { for (${header}) {} }`;
      const off = compile(source, { fileName: '/app/deprecations.shade.ts' });
      const on = paired(source, true, []);
      expect(on.diagnostics.filter((d) => d.category === 'error')).toEqual(off.diagnostics);
      expect(on.diagnostics.filter((d) => d.code === TS_CODES.INT_LITERAL_DEPRECATION)).not.toEqual(
        [],
      );
      expect(on.wgsl).toBeUndefined();
    },
  );
});
