// A constant of no fixed type (change 0134 item 2; Rules 5.1 and 5.2, surface §12 and §13).
//
// `const K = 3` with no annotation takes, at each read, the type the written number `3` would
// take there. Each test below reads BOTH halves on one source: `compile()` (its diagnostics,
// the WGSL and the GLSL ES 3.00 text, and the value on the CPU oracle) and the language
// service (`getDiagnostics`), as Rule 12.7 asks.
//
// The rows of "Values that change" of the proposal are pinned first, with the value each read
// had before (the `f32` rounding) named beside the value it has now.
//
// Verifies: Rule 5.1, Rule 5.2 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { checkDocuments } from '../../language-service/check.js';

const editor = (source: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', source);
  return service.getDiagnostics('a.shade.ts').map((d) => `${String(d.code)}: ${String(d.message)}`);
};

/** Compiles `source`, requires both halves to report nothing, and returns the compile. */
const accepted = (source: string) => {
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  expect(editor(source)).toEqual([]);
  return result;
};

/** Requires both halves to report exactly `messages`, each a `TS8003`. */
const refused = (source: string, messages: readonly string[]) => {
  const result = compile(source);
  expect(result.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual(
    messages.map((m) => `TS8003: ${m}`),
  );
  expect(result.wgsl).toBeUndefined();
  expect(editor(source)).toEqual(messages.map((m) => `TS8003: ${m}`));
};

/** The fragment GLSL of a module with one helper, drawn through a fragment entry. */
const glslOf = (source: string): string => {
  const result = accepted(source);
  return `${result.glsl?.vertex ?? ''}\n${result.glsl?.fragment ?? ''}`;
};

const H = `function h(a: u32): u32 { return a; }\n`;

describe('values that change: a constant f32 does not hold exactly reads at its exact value', () => {
  it('const PRIME = 2654435761; vi * u32(PRIME) read 2654435840 and reads 2654435761', () => {
    const source = `"use typeshade";
const PRIME = 2654435761;
export function t(vi: u32): u32 { return vi * u32(PRIME); }
@fragment export function fs(vi: location<0, u32, { interpolate: "flat" }>): location<0, vec4> {
  return vec4(f32(t(vi)), 0, 0, 1);
}`;
    const result = compile(source);
    expect(result.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(result.wgsl).toContain('return (vi * 2654435761u);');
    expect(result.glsl?.fragment).toContain('return (vi * 2654435761u);');
    // The oracle agrees with the emitted text. Before: Math.fround(2654435761) = 2654435840.
    expect(result.eval('t', [1])).toBe(2654435761);
    expect(Math.fround(2654435761)).toBe(2654435840);
    expect(result.eval('t', [3])).toBe(Math.imul(3, 2654435761) >>> 0);
  });

  it('const K = 16777217; vi + u32(K) read 16777216 and reads 16777217', () => {
    const source = `"use typeshade";
const K = 16777217;
export function t(vi: u32): u32 { return vi + u32(K); }`;
    const result = accepted(source);
    expect(result.wgsl).toContain('return (vi + 16777217u);');
    expect(result.eval('t', [0])).toBe(16777217);
    expect(Math.fround(16777217)).toBe(16777216);
  });

  it('const K = -16777219; i32(K) read -16777220 and reads -16777219', () => {
    const source = `"use typeshade";
const K = -16777219;
export function t(ii: i32): i32 { return ii + i32(K); }`;
    const result = accepted(source);
    expect(result.wgsl).toContain('return (ii + -16777219);');
    expect(result.eval('t', [0])).toBe(-16777219);
    expect(Math.fround(-16777219)).toBe(-16777220);
  });

  it('class S { static K = 16777217; } with u32(S.K) read 16777216 and reads 16777217', () => {
    const source = `"use typeshade";
class S { static K = 16777217; }
export function t(vi: u32): u32 { return vi + u32(S.K); }`;
    const result = accepted(source);
    expect(result.wgsl).toContain('return (vi + 16777217u);');
    expect(result.eval('t', [0])).toBe(16777217);
  });

  it('const K = 7; x * (K / 3) beside an f64 carries the full double of 7 / 3', () => {
    const source = `"use typeshade";
const K = 7;
export function t(x: f64): f64 { return x * (K / 3); }`;
    const result = accepted(source);
    // Before: the f32 quotient, 2.3333332538604736. Now the double, split into its two words.
    expect(result.eval('t', [1])).toBe(7 / 3);
    const hi = Math.fround(7 / 3);
    expect(result.wgsl).toContain(`vec2<f32>(${String(hi)}, ${String(Math.fround(7 / 3 - hi))})`);
  });

  it('const M = K / 3 read beside an f64 carries the full double too', () => {
    const source = `"use typeshade";
const K = 7;
const M = K / 3;
export function t(x: f64): f64 { return x * M; }`;
    const result = accepted(source);
    expect(result.eval('t', [1])).toBe(7 / 3);
  });

  it('const C = 0.1 beside an f64 carries the full double, as the written x * 0.1 does', () => {
    const constant = `"use typeshade";
const C = 0.1;
export function t(x: f64): f64 { return x * C; }`;
    const written = `"use typeshade";
export function t(x: f64): f64 { return x * 0.1; }`;
    const result = accepted(constant);
    // Before: the f32 value of 0.1, 0.10000000149011612.
    expect(result.eval('t', [1])).toBe(0.1);
    expect(result.eval('t', [1])).not.toBe(Math.fround(0.1));
    const body = (wgsl: string | undefined): string => wgsl!.slice(wgsl!.indexOf('fn t('));
    expect(body(result.wgsl)).toBe(body(accepted(written).wgsl));
  });

  it('keeps the old value where the author writes the type: const K: f32 = …', () => {
    const source = `"use typeshade";
const K: f32 = 16777217;
export function t(vi: u32): u32 { return vi + u32(K); }`;
    const result = accepted(source);
    // The emitted text converts the f32 constant, whose value is 16777216, as before. The CPU
    // oracle keeps a declared constant at the double the author wrote (`ConstDecl.cpuValue`),
    // which change 0134 does not touch, so no oracle value is pinned here.
    expect(result.wgsl).toContain('const K: f32 = 16777217.0;');
    expect(result.wgsl).toContain('return (vi + u32(K));');
  });
});

describe('each read takes the type the written number would take there', () => {
  it('reads one module constant at u32, at i32 and at f32 in one function', () => {
    const source = `"use typeshade";
const K = 3;
export function t(vi: u32, ii: i32, x: f32): f32 {
  return f32(vi * K) + f32(ii * K) + x * K;
}`;
    const result = accepted(source);
    // The declaration stays, and an f32 read names it (Amendment A1 of change 0134).
    expect(result.wgsl).toContain('const K: f32 = 3.0;');
    expect(result.wgsl).toContain('return ((f32((vi * 3u)) + f32((ii * 3))) + (x * K));');
    expect(result.eval('t', [2, -2, 0.5])).toBe(6 - 6 + 1.5);
  });

  it('emits the same GLSL ES 3.00 reads', () => {
    const glsl = glslOf(`"use typeshade";
const K = 3;
function t(vi: u32, x: f32): f32 { return f32(vi * K) + x * K; }
@fragment export function fs(vi: location<0, u32, { interpolate: "flat" }>, x: location<1, f32>): location<0, vec4> {
  return vec4(t(vi, x), 0, 0, 1);
}`);
    expect(glsl).toContain('(float((vi * 3u)) + (x * K))');
    expect(glsl).toContain('const float K = 3.0;');
  });

  it('bounds a counted loop: const N = 8; for (let j = 0; j < N; j++)', () => {
    const source = `"use typeshade";
const N = 8;
export function sum(xs: array<f32, 8>): f32 {
  let a = 0;
  for (let j = 0; j < N; j++) {
    a += xs[j];
  }
  return a;
}`;
    const result = accepted(source);
    expect(result.eval('sum', [[1, 2, 3, 4, 5, 6, 7, 8]])).toBe(36);
  });

  it('reads a function-local const at two types', () => {
    const source = `"use typeshade";
${H}export function t(ii: i32): u32 {
  const k = 1;
  return h(k) + u32(ii + k);
}`;
    const result = accepted(source);
    expect(result.wgsl).toContain('(h(1u) + u32((ii + 1)))');
    expect(result.eval('t', [4])).toBe(6);
  });

  it('reads a static field that no code writes as a module constant is read', () => {
    const source = `"use typeshade";
class S { static K = 3; }
export function t(vi: u32, x: f32): f32 { return f32(vi * S.K) + x * S.K; }`;
    const result = accepted(source);
    expect(result.wgsl).toContain('return (f32((vi * 3u)) + (x * S_K));');
  });

  it('reads a constant computed from a constant: const M = K * 2', () => {
    const source = `"use typeshade";
const K = 3;
const M = K * 2;
const NEG = -K;
export function t(vi: u32, ii: i32): u32 { return vi + M + u32(ii + NEG); }`;
    const result = accepted(source);
    expect(result.wgsl).toContain('((vi + 6u) + u32((ii + -3)))');
  });

  it('reads through every position a written integer is read in', () => {
    const source = `"use typeshade";
const K = 2;
interface Q { id: u32; }
${H}export function t(vi: u32, c: bool, xs: array<f32, 8>): u32 {
  const q: Q = { id: K };
  let n: u32 = K;
  n += K;
  n <<= K;
  const a: array<u32, 2> = [K, K];
  const picked = c ? vi : K;
  return h(K) + max(K, vi) + vec3u(K, 1, 2).x + (vi >> K) + u32(xs[K]) + q.id + n + a[0] + picked;
}`;
    const result = accepted(source);
    expect(result.wgsl!.slice(result.wgsl!.indexOf('fn t('))).not.toContain('2.0');
    expect(result.wgsl).toContain('max(2u, vi)');
    expect(result.wgsl).toContain('xs[2]');
  });

  it('reads an imported constant at the type of each read', () => {
    const lib = `"use typeshade";\nexport const K = 3;\nexport const BIG = 16777217;\n`;
    const main = `"use typeshade";
import { K, BIG } from "./lib.shade";
export function t(vi: u32, x: f32): f32 { return f32(vi * K + u32(BIG)) + x * K; }`;
    const readDocument = (uri: string): string | undefined =>
      uri.includes('lib.shade') ? lib : undefined;
    const result = compile(main, { fileName: '/app/main.shade.ts', readDocument });
    expect(result.diagnostics).toEqual([]);
    expect(result.wgsl).toContain('return (f32(((vi * 3u) + 16777217u)) + (x * K));');
    const checked = checkDocuments(
      [{ path: '/app/main.shade.ts', uri: '/app/main.shade.ts', text: main }],
      { readDocument },
    );
    expect(checked.diagnostics).toEqual([]);
  });

  it('is still a constant of no fixed type in a local function that captures it', () => {
    const source = `"use typeshade";
${H}export function t(): u32 {
  const k = 3;
  const f = (): u32 => h(k);
  return f();
}`;
    expect(accepted(source).eval('t')).toBe(3);
  });

  it('converts the written number under a cast: u32(C) is u32(0.1)', () => {
    const source = `"use typeshade";
const C = 0.1;
const K = 3;
export function t(): u32 { return u32(C) + u32(K * 1.5); }`;
    expect(accepted(source).eval('t')).toBe(4);
  });
});

describe('what stays refused, in both halves', () => {
  it('a float-written constant in an integer position, as the written 0.5 is', () => {
    refused(
      `"use typeshade";
const C = 0.5;
export function t(vi: u32): u32 { return vi * C; }`,
      [
        'Type mismatch: cannot * u32 and f32 — no implicit int/float conversion. Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
      ],
    );
  });

  it('a value outside the integer type of the position, with the sentence of §13', () => {
    refused(
      `"use typeshade";
const BIG = 5000000000;
export function t(): i32 { let j: i32 = BIG; return j; }`,
      [
        'The value has to fit: 5000000000 is outside i32, which holds -2147483648 to 2147483647 (§13).',
      ],
    );
  });

  it('a constant with a written type is that type at every read', () => {
    refused(
      `"use typeshade";
const K: f32 = 3;
export function t(vi: u32): u32 { return vi * K; }`,
      [
        'Type mismatch: cannot * u32 and f32 — no implicit int/float conversion. Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
      ],
    );
  });
});

describe('the division rule for a constant (decisions Q10 and Q11, Amendment A1)', () => {
  const sentence = (name: string, type: string, written: string, value: string, by = '2'): string =>
    `"${name}" is ${type === 'u32' ? 'a u32' : 'an i32'} where another line reads it, and no ` +
    `operand of "${name} / ${by}" has a declared type, so the "/" does not say which division ` +
    `it is. Write "const ${name}: ${type} = ${written}" for the integer division, or ` +
    `"f32(${name}) / ${by}" for ${value}.`;

  // Each compiled before change 0134 (F21 of the proposal), with the emit named.
  it.each([
    ['const k = 7; h(k); return f32(k / 2);', 'emitted 3.0'],
    ['const k = 7; const r = h(k); return f32(r + k / 2);', 'emitted r + 3u'],
    ['const k = 7; h(k); return xs[k / 2];', 'emitted xs[3u]'],
  ])('refuses %s (%s)', (body) => {
    refused(
      `"use typeshade";
${H}export function t(xs: array<f32, 8>): f32 {
  ${body}
}`,
      [sentence('k', 'u32', '7', '3.5')],
    );
  });

  it('refuses const k = 7; let j: i32 = k; return f32(k / 2) + f32(j); (emitted 3.0)', () => {
    refused(
      `"use typeshade";
export function t(): f32 {
  const k = 7;
  let j: i32 = k;
  return f32(k / 2) + f32(j);
}`,
      [sentence('k', 'i32', '7', '3.5')],
    );
  });

  it('refuses const HALF = N / 2 where a loop bound reads N as an integer', () => {
    refused(
      `"use typeshade";
const N = 8;
const HALF = N / 2;
export function t(xs: array<f32, 8>): f32 {
  let a = 0;
  for (let j = 0; j < N; j++) { a += xs[j]; }
  return a * HALF;
}`,
      [sentence('N', 'i32', '8', '4')],
    );
  });

  it('accepts x / N with a declared f32 x: a float division, N an f32 at that read', () => {
    const source = `"use typeshade";
const N = 8;
export function t(xs: array<f32, 8>, x: f32): f32 {
  let a = 0;
  for (let j = 0; j < N; j++) { a += xs[j]; }
  return a + x / N;
}`;
    const result = accepted(source);
    expect(result.wgsl).toContain('(x / N)');
    expect(result.eval('t', [[0, 0, 0, 0, 0, 0, 0, 0], 4])).toBe(0.5);
  });

  it('accepts vi / k with a declared u32 vi: an integer division, as vi / 7 is', () => {
    const source = `"use typeshade";
${H}export function t(vi: u32): u32 {
  const k = 7;
  return h(k) + vi / k;
}`;
    const result = accepted(source);
    expect(result.wgsl).toContain('(vi / 7u)');
    expect(result.eval('t', [15])).toBe(9);
  });

  it('accepts K / 2 where no read makes K an integer: the ECMAScript value', () => {
    const source = `"use typeshade";
const K = 7;
export function t(x: f32): f32 { return x * (K / 2); }`;
    expect(accepted(source).eval('t', [2])).toBe(7);
  });

  it('accepts each of the two edits the sentence names', () => {
    const annotated = `"use typeshade";
${H}export function t(): f32 {
  const k: u32 = 7;
  h(k);
  return f32(k / 2);
}`;
    expect(accepted(annotated).eval('t')).toBe(3);
    const converted = `"use typeshade";
${H}export function t(): f32 {
  const k = 7;
  h(k);
  return f32(k) / 2;
}`;
    expect(accepted(converted).eval('t')).toBe(3.5);
  });
});
