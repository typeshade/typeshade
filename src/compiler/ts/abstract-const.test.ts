// A constant of no fixed type (change 0134 item 2; Rules 5.1 and 5.2, surface §12 and §13).
//
// `const K = 3` with no annotation takes, at each read, the type the written number `3` would
// take there. Each test below reads BOTH halves on one source: `compile()` (its diagnostics,
// the WGSL and the GLSL ES 3.00 text, and the value on the CPU oracle) and the language
// service (`getDiagnostics`), as Rule 12.7 asks.
//
// The rows of "Values that change" of the proposal are pinned first, with the value each read
// had before (the `f32` rounding) named beside the value it has now. The emitted text moves,
// and the CPU oracle in 'f32' precision, which the gates hold against a device, moves with it.
// In 'f64' precision (`compile().eval`) a read of a module constant by its name carried the
// double the author wrote before this change too, so most rows read the same value there; the
// rows that move in 'f64' precision are pinned in the last test of the first block.
//
// Verifies: Rule 5.1, Rule 5.2 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { markProjectedAnnotations } from './abstract-const.js';
import { relatedSitesOf } from './diagnostic.js';
import { compileModule } from '../../core/oracle.js';
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
    // The oracle agrees with the emitted text. Before, the text multiplied by the f32 constant,
    // Math.fround(2654435761) = 2654435840.
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

  it("moves the CPU oracle in 'f32' precision with the emitted text", () => {
    // Before the change this oracle gave 16777216, 2654435840 and the f32 value of 0.1.
    const f32Oracle = (source: string, args: readonly unknown[]): unknown => {
      const cpu = compileModule(accepted(source).module, { precision: 'f32' });
      return (cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(...args);
    };
    expect(
      f32Oracle(
        `"use typeshade";\nconst K = 16777217;\nexport function t(vi: u32): u32 { return vi + u32(K); }`,
        [0],
      ),
    ).toBe(16777217);
    expect(
      f32Oracle(
        `"use typeshade";\nconst PRIME = 2654435761;\nexport function t(vi: u32): u32 { return vi * u32(PRIME); }`,
        [1],
      ),
    ).toBe(2654435761);
    expect(
      f32Oracle(
        `"use typeshade";\nconst C = 0.1;\nexport function t(x: f64): f64 { return x * C; }`,
        [1],
      ),
    ).toBe(0.1);
  });

  it("moves two rows in 'f64' precision too (the review of pull request #1184, F10)", () => {
    // `const D: f64 = C` read 0.10000000149011612 before, and `u32(K)` read 4294967040.
    const typed = `"use typeshade";
const C = 0.1;
const D: f64 = C;
export function t(x: f64): f64 { return x * D; }`;
    expect(accepted(typed).eval('t', [1])).toBe(0.1);
    const top = `"use typeshade";
const K = 4294967295;
export function t(vi: u32): u32 { return vi + u32(K); }`;
    const result = accepted(top);
    expect(result.wgsl).toContain('return (vi + 4294967295u);');
    expect(result.eval('t', [0])).toBe(4294967295);
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
  const head = (name: string, type: string, written: string): string =>
    `"${name}" is ${type === 'u32' ? 'a u32' : 'an i32'} where another line reads it, and no ` +
    `operand of "${written}" has a declared type, so the "/" does not say which division it is. `;
  /** The sentence where the quotient stands in a float position: the `/` with its constants
   *  converted. */
  const float = (name: string, type: string, written: string, remedy: string): string =>
    `${head(name, type, written)}Write "${remedy}" for the float division.`;
  /** The sentence where an integer position reads the quotient: the constant with its type. */
  const integer = (name: string, type: string, written: string, decl: string): string =>
    `${head(name, type, written)}Write "${decl}" for the integer division.`;
  const t = (body: string, pre = ''): string => `"use typeshade";
${pre}
declare const tex: texture_2d<f32>;
${H}export function t(vi: u32, x: f32, xs: array<f32, 8>): f32 {
  ${body}
}`;
  const ARGS = [1, 1, [1, 2, 3, 4, 5, 6, 7, 8]] as const;

  /** Refuses `source` with `message` in both halves; `fixed`, the source with the edit the
   *  sentence names applied, compiles clean in both halves (Rule 12.5). */
  const refusedThenFixed = (source: string, message: string, fixed: string): void => {
    refused(source, [message]);
    expect(source).not.toBe(fixed);
    accepted(fixed);
  };

  // Each compiled before change 0134 (F21 of the proposal), with the emit named.
  it('refuses const k = 7; h(k); return f32(k / 2); (emitted 3.0)', () => {
    refusedThenFixed(
      t('const k = 7; h(k); return f32(k / 2);'),
      float('k', 'u32', 'k / 2', 'f32(k) / 2'),
      t('const k = 7; h(k); return f32(f32(k) / 2);'),
    );
  });

  it('refuses const k = 7; const r = h(k); return f32(r + k / 2); (emitted r + 3u)', () => {
    refusedThenFixed(
      t('const k = 7; const r = h(k); return f32(r + k / 2);'),
      integer('k', 'u32', 'k / 2', 'const k: u32 = 7'),
      t('const k: u32 = 7; const r = h(k); return f32(r + k / 2);'),
    );
  });

  it('refuses const k = 7; h(k); return xs[k / 2]; (emitted xs[3u])', () => {
    refusedThenFixed(
      t('const k = 7; h(k); return xs[k / 2];'),
      integer('k', 'u32', 'k / 2', 'const k: u32 = 7'),
      t('const k: u32 = 7; h(k); return xs[k / 2];'),
    );
  });

  it('refuses const k = 7; let j: i32 = k; return f32(k / 2) + f32(j); (emitted 3.0)', () => {
    refusedThenFixed(
      t('const k = 7; let j: i32 = k; return f32(k / 2) + f32(j);'),
      float('k', 'i32', 'k / 2', 'f32(k) / 2'),
      t('const k = 7; let j: i32 = k; return f32(f32(k) / 2) + f32(j);'),
    );
  });

  it('refuses const HALF = N / 2 where a loop bound reads N as an integer', () => {
    const loop = 'let a = 0; for (let j = 0; j < N; j++) { a += xs[j]; } return a * HALF;';
    refusedThenFixed(
      t(loop, 'const N = 8;\nconst HALF = N / 2;'),
      float('N', 'i32', 'N / 2', 'f32(N) / 2'),
      t(loop, 'const N = 8;\nconst HALF = f32(N) / 2;'),
    );
  });

  it('names an edit that compiles for arithmetic around the constant', () => {
    const cases: [string, string, string][] = [
      ['(k + 1) / 2', '(f32(k) + 1) / 2', 'u32'],
      ['-k / 2', '-f32(k) / 2', 'u32'],
      ['(k / 2) / 3', '(f32(k) / 2) / 3', 'u32'],
    ];
    for (const [written, remedy, type] of cases) {
      refusedThenFixed(
        t(`const k = 7; h(k); return f32(${written});`),
        float('k', type, written, remedy),
        t(`const k = 7; h(k); return f32(${remedy});`),
      );
    }
    refusedThenFixed(
      t('const k = 7; h(k); return x * (k / 2);'),
      float('k', 'u32', 'k / 2', 'f32(k) / 2'),
      t('const k = 7; h(k); return x * (f32(k) / 2);'),
    );
  });

  // The owner's decision of 2026-11-10 ("거부"): a `/` that reaches the constant through an
  // operator, a builtin, a conditional or a derived constant is refused as the direct one is,
  // so no program changes its value silently through a division.
  it.each([
    ['(k % 4) / 2', '(f32(k) % 4) / 2'],
    ['max(k, 1) / 2', 'max(f32(k), 1) / 2'],
    ['abs(k) / 2', 'abs(f32(k)) / 2'],
    ['(x > 0 ? k : 1) / 2', '(x > 0 ? f32(k) : 1) / 2'],
  ])('refuses %s, which reaches the constant with no declared type between', (written, remedy) => {
    refusedThenFixed(
      t(`const k = 7; h(k); return f32(${written});`),
      float('k', 'u32', written, remedy),
      t(`const k = 7; h(k); return f32(${remedy});`),
    );
  });

  it('refuses (k | 1) / 2 in a float position with the bitwise operand converted whole', () => {
    // Amendment A3 (M1): `f32(k) | 1` is no program, so the edit converts `k | 1`.
    refusedThenFixed(
      t('const k = 7; h(k); return f32((k | 1) / 2);'),
      float('k', 'u32', '(k | 1) / 2', 'f32(k | 1) / 2'),
      t('const k = 7; h(k); return f32(f32(k | 1) / 2);'),
    );
    refusedThenFixed(
      t('const k = 7; h(k); return x + (k | 1) / 2;'),
      float('k', 'u32', '(k | 1) / 2', 'f32(k | 1) / 2'),
      t('const k = 7; h(k); return x + f32(k | 1) / 2;'),
    );
  });

  it('refuses a / over a constant derived from the one another line reads', () => {
    refusedThenFixed(
      t('const k = 7; h(k); const m = k * 2; return f32(m / 4);'),
      float('k', 'u32', 'm / 4', 'f32(m) / 4'),
      t('const k = 7; h(k); const m = k * 2; return f32(f32(m) / 4);'),
    );
    refusedThenFixed(
      t('const k = 7; h(k); const m = k; return f32(m / 2);'),
      float('k', 'u32', 'm / 2', 'f32(m) / 2'),
      t('const k = 7; h(k); const m = k; return f32(f32(m) / 2);'),
    );
  });

  // Amendment A2 of change 0134 ("거부"): the same through a `let`. `const k = 7; h(k);
  // let y = k; f32(y / 2)` computed 3 before the change and would compute 3.5 silently.
  it('refuses a / over a let that was initialized from the constant', () => {
    refusedThenFixed(
      t('const k = 7; h(k); let y = k; return f32(y / 2);'),
      float('k', 'u32', 'y / 2', 'f32(y) / 2'),
      t('const k = 7; h(k); let y = k; return f32(f32(y) / 2);'),
    );
    refusedThenFixed(
      t('const k = 7; h(k); let y = k + 1; return f32(y / 2);'),
      float('k', 'u32', 'y / 2', 'f32(y) / 2'),
      t('const k = 7; h(k); let y = k + 1; return f32(f32(y) / 2);'),
    );
  });

  it('refuses it through a second let, a builtin, and where an index reads the quotient', () => {
    refusedThenFixed(
      t('const k = 7; h(k); let y = k; let z = y + 1; return f32(z / 2);'),
      float('k', 'u32', 'z / 2', 'f32(z) / 2'),
      t('const k = 7; h(k); let y = k; let z = y + 1; return f32(f32(z) / 2);'),
    );
    refusedThenFixed(
      t('const k = 7; h(k); const m = max(k, 1); return f32(m / 2);'),
      float('k', 'u32', 'm / 2', 'f32(m) / 2'),
      t('const k = 7; h(k); const m = max(k, 1); return f32(f32(m) / 2);'),
    );
    refusedThenFixed(
      t('const k = 7; h(k); let y = k; return xs[y / 2];'),
      integer('k', 'u32', 'y / 2', 'const k: u32 = 7'),
      t('const k: u32 = 7; h(k); let y = k; return xs[y / 2];'),
    );
  });

  it('refuses y /= 2 on such a let, and names the let with its type written', () => {
    const message =
      '"k" is a u32 where another line reads it, and no operand of "y /= 2" has a declared ' +
      'type, so the "/=" does not say which division it is. Write "let y: f32 = k" for the ' +
      'float division.';
    refusedThenFixed(
      t('const k = 7; h(k); let y = k; y /= 2; return y;'),
      message,
      t('const k = 7; h(k); let y: f32 = k; y /= 2; return y;'),
    );
  });

  it('accepts the let where it has a declared type, or no line reads the constant as an integer', () => {
    expect(accepted(t('const k = 7; h(k); let y: f32 = k; return y / 2;')).eval('t', ARGS)).toBe(
      3.5,
    );
    expect(accepted(t('const k = 7; let y = k; return f32(y / 2);')).eval('t', ARGS)).toBe(3.5);
    expect(
      accepted(t('const k = 7; h(k); let y = k; return x / y + f32(y) / 2;')).eval('t', ARGS),
    ).toBe(1 / 7 + 3.5);
  });

  // Every read that types the constant an integer counts, also through a constant derived
  // from it (the review of pull request #1184, F6).
  it.each([
    ['a bitwise compound assignment', 'let n: u32 = 1; n |= K; return f32(n) + f32(K / 2);', ''],
    ['a shift compound assignment', 'let n: u32 = 1; n <<= K; return f32(n) + f32(K / 2);', ''],
    ['an and compound assignment', 'let n: u32 = 1; n &= K; return f32(n) + f32(K / 2);', ''],
    ['a typed constant', 'return f32(J) + f32(K / 2);', 'const J: u32 = K;'],
    ['a derived constant', 'return f32(h(M)) + f32(K / 2);', 'const M = K * 2;'],
    ['a conversion of arithmetic', 'return f32(u32(K + 1)) + f32(K / 2);', ''],
  ])('counts %s as a read of K as an integer', (_what, body, pre) => {
    refusedThenFixed(
      t(body, `const K = 7;\n${pre}`),
      float('K', 'u32', 'K / 2', 'f32(K) / 2'),
      t(body.replace('f32(K / 2)', 'f32(f32(K) / 2)'), `const K = 7;\n${pre}`),
    );
  });

  it('counts a texture level as a read of K as an integer', () => {
    const body = 'return textureLoad(tex, vec2i(0, 0), K).x + f32(K / 2);';
    const result = compile(t(body, 'const K = 0;'));
    expect(result.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
      `TS8003: ${float('K', 'u32', 'K / 2', 'f32(K) / 2')}`,
    ]);
    expect(editor(t(body, 'const K = 0;'))).toEqual([
      `TS8003: ${float('K', 'u32', 'K / 2', 'f32(K) / 2')}`,
    ]);
  });

  // The owner's decision of 2026-11-10 ("캐스트도 세기"): a cast is a read, so `i32(K)` and
  // `u32(K)` make the constant an integer for this rule, as an argument does.
  it.each(['u32', 'i32'])('refuses K / 2 where %s(K) reads K as an integer', (cast) => {
    refusedThenFixed(
      `"use typeshade";
const K = 7;
export function t(): f32 { return f32(${cast}(K)) + f32(K / 2); }`,
      float('K', cast, 'K / 2', 'f32(K) / 2'),
      `"use typeshade";
const K = 7;
export function t(): f32 { return f32(${cast}(K)) + f32(f32(K) / 2); }`,
    );
  });

  it('a cast to f32 or f64 alone does not make the constant an integer', () => {
    const source = `"use typeshade";
const K = 7;
export function t(d: f64): f32 { return f32(K) + f32(f64(K) + d) + K / 2; }`;
    expect(accepted(source).eval('t', [0])).toBe(7 + 7 + 3.5);
  });

  it('a float-written constant is never read as an integer: u32(C) converts 7.5', () => {
    // Compiled before the change, and gives the same 10.75 (the review of #1184, F4).
    const source = t('return f32(u32(C)) + x * (C / 2);', 'const C = 7.5;');
    expect(accepted(source).eval('t', ARGS)).toBe(7 + 3.75);
  });

  it("the quotient's own read is not another read: the written 8 / 2 is 4u there too", () => {
    // Each is what the written number gives (the review of #1184, F5).
    const cases: [string, number][] = [
      ['let j: u32 = K / 2; return f32(j);', 4],
      ['return f32(h(K / 2));', 4],
      ['return f32(vi + K / 2);', 5],
      ['return vi < K / 2 ? 1 : 0;', 1],
      ['return f32(u32(K / 2));', 4],
    ];
    for (const [body, value] of cases) {
      const constant = accepted(t(body, 'const K = 8;'));
      expect(constant.eval('t', ARGS)).toBe(value);
      const written = accepted(t(body.replace('K / 2', '8 / 2')));
      expect(written.eval('t', ARGS)).toBe(value);
    }
  });

  it('a conversion is a declared type: u32(K) / 2 is the integer division, as u32(7) / 2 is', () => {
    // Amendment A3, "먼저 별도 PR로 고치기": the fold of a scalar cast keeps its type (#1217),
    // so each row is the typed value, the same as the written number gives.
    const rows: [string, string, number][] = [
      ['const K = 7;', 'return f32(u32(K) / 2);', 3],
      ['const K = 7;', 'return f32(u32(K) * 3);', 21],
      ['const K = 7;', 'return f32(u32(K) - 8);', 4294967295],
      ['const A = 4294967295;', 'return f32(u32(A) + 1);', 0],
      ['const K = 7;', 'return f32(i32(K) * 1000000000);', -1589934592],
    ];
    const program = (pre: string, body: string) =>
      `"use typeshade";\n${pre}\nexport function t(): f32 { ${body} }\n`;
    for (const [pre, body, value] of rows) {
      expect(accepted(program(pre, body)).eval('t', [])).toBe(value);
      const written = body.replace(/\b[KA]\b/, /= (\d+)/.exec(pre)?.[1] ?? '');
      expect(accepted(program('', written)).eval('t', [])).toBe(value);
    }
  });

  it('a float-written counter against the constant keeps its f32, and K / 2 its 3.5', () => {
    // Compiled before the change, and gives the same 10.5 (the review of #1184, F3).
    const source = t(
      'let a = 0.; for (let j = 0.; j < K; j += 1.) { a += 1.; } return a + K / 2;',
      'const K = 7;',
    );
    const result = accepted(source);
    expect(result.wgsl).toContain('var j: f32 = 0.0;');
    expect(result.eval('t', ARGS)).toBe(10.5);
  });

  it('accepts x / N with a declared f32 x: a float division, N an f32 at that read', () => {
    const source = t(
      'let a = 0; for (let j = 0; j < N; j++) { a += xs[j]; } return a + x / N;',
      'const N = 8;',
    );
    const result = accepted(source);
    expect(result.wgsl).toContain('(x / N)');
    expect(result.eval('t', [0, 4, [0, 0, 0, 0, 0, 0, 0, 0]])).toBe(0.5);
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
    expect(accepted(t('return x * (K / 2);', 'const K = 7;')).eval('t', [1, 2, []])).toBe(7);
  });

  it('refuses the / on the read in the importing file that makes it one, with the / as its site', () => {
    // The owner's decision of 2026-11-10 ("편집기를 컴파일러에 맞춤"): a read in another file
    // counts, and the editor shows what `compile()` of the importing file reports. The library
    // alone does not refuse the `/`, so the refusal stands on the read that makes it one, in
    // the importing file, with the `/` as its related site (#1186, `program-refusals.ts`).
    const lib = `"use typeshade";
export const K = 7;
export function half(x: f32): f32 { return x * (K / 2); }
`;
    const main = `"use typeshade";
import { K, half } from "./lib.shade";
export function t(vi: u32, x: f32): f32 { return f32(vi * K) + half(x); }
`;
    const read = (uri: string): string | undefined =>
      uri.includes('lib.shade') ? lib : uri.includes('main.shade') ? main : undefined;
    const message = float('K', 'u32', 'K / 2', 'f32(K) / 2');
    const compiled = compile(main, { fileName: '/app/main.shade.ts', readDocument: read });
    expect(compiled.diagnostics.map((d) => `${d.fileName} ${d.code}: ${d.message}`)).toEqual([
      `/app/main.shade.ts TS8003: ${message}`,
    ]);
    const [refusal] = compiled.diagnostics;
    expect(main.slice(refusal!.start, refusal!.start + refusal!.length)).toBe('K');
    expect(refusal!.start).toBe(main.indexOf('vi * K') + 'vi * '.length);
    expect(
      relatedSitesOf(refusal!).map(
        (r) => `${r.fileName} ${lib.slice(r.start, r.start + r.length)}`,
      ),
    ).toEqual(['/app/lib.shade.ts K / 2']);
    // The library alone compiles: no line of it reads K as an integer.
    expect(compile(lib, { fileName: '/app/lib.shade.ts' }).diagnostics).toEqual([]);
    const docs = [
      { path: '/app/main.shade.ts', uri: '/app/main.shade.ts', text: main },
      { path: '/app/lib.shade.ts', uri: '/app/lib.shade.ts', text: lib },
    ];
    for (const order of [docs, [...docs].reverse(), [docs[0]!]]) {
      const checked = checkDocuments(order, { readDocument: read });
      expect(checked.diagnostics.map((d) => `${d.file} ${d.code}: ${d.message}`)).toEqual([
        `/app/main.shade.ts TS8003: ${message}`,
      ]);
    }
    // The editor shows it on the importing document, with the `/` as related information.
    const open = createTypeshadeLanguageService({ readDocument: read });
    open.openDocument('/app/lib.shade.ts', lib);
    open.openDocument('/app/main.shade.ts', main);
    expect(open.getDiagnostics('/app/lib.shade.ts')).toEqual([]);
    const shown = open.getDiagnostics('/app/main.shade.ts');
    expect(shown.map((d) => `${String(d.code)}: ${d.message}`)).toEqual([`TS8003: ${message}`]);
    expect(shown[0]!.relatedInformation?.map((r) => r.location.uri)).toEqual(['/app/lib.shade.ts']);
  });
});

describe('one conservative mark (Amendment A3, "보수적 추적 규칙")', () => {
  const H2 = `function h(a: u32): u32 { return a; }\n`;
  const t = (body: string, pre = ''): string => `"use typeshade";
${pre}
${H2}export function t(vi: u32, x: f32, xs: array<f32, 8>): f32 {
  ${body}
}`;
  const message = (subject: string, written: string, remedy: string, op = '/'): string =>
    `"${subject}" is a u32 where another line reads it, and no operand of "${written}" has a ` +
    `declared type, so the "${op}" does not say which division it is. Write "${remedy}" for ` +
    `the float division.`;
  const refusedThenFixed = (source: string, sentence: string, fixed: string): void => {
    refused(source, [sentence]);
    accepted(fixed);
  };

  // A value carries the origin of the constant through every expression and binding, and a
  // call of a function, a method, a getter or a closure that returns it carries it too. Each of
  // these was an integer division on `main` (3) and computed 3.5 without a diagnostic at
  // `1abf8fbb`.
  it.each([
    [
      'a function result',
      'function g() { const k = 7; h(k); return k; }',
      'return f32(g() / 2);',
      'g() / 2',
      'f32(g()) / 2',
    ],
    [
      'a method result',
      'class A { get() { const k = 7; h(k); return k; } }',
      'const a = new A(); return f32(a.get() / 2);',
      'a.get() / 2',
      'f32(a.get()) / 2',
    ],
    [
      'a static method result',
      'class A { static get() { const k = 7; h(k); return k; } }',
      'return f32(A.get() / 2);',
      'A.get() / 2',
      'f32(A.get()) / 2',
    ],
    [
      'a getter',
      'class A { get v() { const k = 7; h(k); return k; } }',
      'const a = new A(); return f32(a.v / 2);',
      'a.v / 2',
      'f32(a.v) / 2',
    ],
    [
      'a result through a let',
      'function g() { const k = 7; h(k); let y = k; y += 1; return y; }',
      'return f32(g() / 3);',
      'g() / 3',
      'f32(g()) / 3',
    ],
  ])('refuses a / over %s', (_what, pre, body, written, remedy) => {
    refusedThenFixed(
      t(body, pre),
      message('k', written, remedy),
      t(body.replace(written, remedy), pre),
    );
  });

  it.each([
    ['a closure', 'const g = () => k; return f32(g() / 2);', 'g() / 2', 'f32(g()) / 2'],
    [
      'Math.max',
      'return f32(Math.max(k, 1) / 2);',
      'Math.max(k, 1) / 2',
      'Math.max(f32(k), 1) / 2',
    ],
    [
      'select',
      'return f32(select(1, k, x > 0) / 2);',
      'select(1, k, x > 0) / 2',
      'select(1, f32(k), x > 0) / 2',
    ],
    ['a swizzle', 'return f32(vec2(k, 1).x / 2);', 'vec2(k, 1).x / 2', 'vec2(f32(k), 1).x / 2'],
    ['a non-null assertion', 'return f32(k! / 2);', 'k! / 2', 'f32(k)! / 2'],
    ['a power of written numbers', 'return f32(k / 2 ** 1);', 'k / 2 ** 1', 'f32(k) / 2 ** 1'],
  ])('refuses a / through %s', (_what, body, written, remedy) => {
    refusedThenFixed(
      t(`const k = 7; h(k); ${body}`),
      message('k', written, remedy),
      t(`const k = 7; h(k); ${body.replace(written, remedy)}`),
    );
  });

  it('loses the mark at a declared type: a declared result, a declared parameter, a cast', () => {
    expect(
      accepted(
        t('return f32(g() / 2);', 'function g(): f32 { const k = 7; h(k); return k; }'),
      ).eval('t', [1, 1, []]),
    ).toBe(3.5);
    expect(
      accepted(t('const k = 7; h(k); const g = (a: f32) => a; return f32(g(k) / 2);')).eval('t', [
        1,
        1,
        [],
      ]),
    ).toBe(3.5);
  });

  it('a counter started by a local constant keeps the type main gave it from declared uses', () => {
    // On `main`, `const k = 3; h(k);` made `k` a `u32`, and the counter took it: `xs[j]` compiled.
    const source = t(
      'const k = 3; h(k); let a = 0.; for (let j = k; j < 8; j++) { a += xs[j]; } return a;',
    );
    const result = accepted(source);
    // The counted loop is unrolled with `u32` indices.
    expect(result.wgsl).toContain('xs[3u]');
    expect(result.eval('t', [1, 1, [1, 2, 3, 4, 5, 6, 7, 8]])).toBe(4 + 5 + 6 + 7 + 8);
  });

  it('a counter started by an expression over a local constant keeps its type on main', () => {
    // The owner's decision of 2026-11-10, "`main`과 같이 u32 유지": each start that carries
    // the mark of `k`, a `u32` on `main` from `h(k)`, gives a `u32` counter, as it did there.
    // Each value is the one `main` gave.
    const XS = [1, 2, 3, 4, 5, 6, 7, 8];
    const starts: [string, string, number][] = [
      ['k + 1', '', 4],
      ['(k - 1)', '', 2],
      ['k * 2', '', 6],
      ['k + k', '', 6],
      ['k | 1', '', 3],
      ['k >> 1', '', 1],
      ['k % 2', '', 1],
      ['Math.max(k, 1)', '', 3],
      ['max(k, 1)', '', 3],
      ['clamp(k, 0, 7)', '', 3],
      ['abs(k)', '', 3],
      ['x > 0 ? k : 1', '', 3],
      ['select(1, k, x > 0)', '', 3],
      ['k!', '', 3],
      ['kk', 'const kk = k + 1; ', 4],
      ['kk + 1', 'const kk = k + 1; ', 5],
    ];
    for (const [start, pre, first] of starts) {
      const body = (use: string) =>
        `const k = 3; h(k); ${pre}let a = 0.; ` +
        `for (let j = ${start}; j < 8; j++) { ${use} } return a;`;
      // The counter is a `u32`: it indexes, and a comparison with a `u32` reads it as one.
      const indexed = accepted(t(body('a += xs[j];')));
      const sum = XS.slice(first).reduce((s, v) => s + v, 0);
      expect(indexed.eval('t', [1, 1, XS])).toBe(sum);
      const cpu = compileModule(indexed.module, { precision: 'f32' });
      expect((cpu.fns['t'] as (...a: readonly unknown[]) => unknown)(1, 1, XS)).toBe(sum);
      const compared = accepted(t(body('if (j < vi) { a += 1.; }')));
      expect(compared.wgsl).toMatch(/var j(_\d+)?: u32|\(\d+u < vi\)/);
      expect(compared.eval('t', [6, 1, XS])).toBe(Math.max(0, 6 - first));
      // A `/` over it is refused: the counter carries the mark, and `h(k)` reads `k` as an
      // integer (A3).
      refused(t(body('a += f32(j / 2);')), [message('k', 'j / 2', 'f32(j) / 2')]);
    }
    // A loop that is not unrolled writes the `u32` counter in the WGSL and the GLSL.
    const open = `"use typeshade";
${H2}export function t(vi: u32): f32 {
  const k = 3; h(k); let a = 0.; for (let j = Math.max(k, 1) + 1; j < vi; j++) { a += 1.; } return a;
}
@fragment export function fs(vi: location<0, u32, { interpolate: "flat" }>): location<0, vec4> {
  return vec4(t(vi), 0, 0, 1);
}`;
    const emitted = accepted(open);
    expect(emitted.wgsl).toContain('for (var j: u32 = 4u; (j < vi); j = (j + 1u))');
    expect(emitted.glsl?.fragment).toContain('for (uint j = 4u; (j < vi); j = (j + 1u))');
  });

  it('a start that main refused keeps the type it has here', () => {
    // `-k` of a `u32`, `k ** 2`, `k + 0.5` and `K + k` were refused on `main`; each counter
    // is the f32 the written number gives, and the read of `k` keeps its value.
    for (const [start, pre, value] of [
      ['-k', '', 8 + 3],
      ['k + 0.5', '', 5],
      ['K + k', 'const K = 1;', 4],
    ] as const) {
      const result = accepted(
        t(
          `const k = 3; h(k); let a = 0.; for (let j = ${start}; j < 8; j++) { a += 1.; } return a;`,
          pre,
        ),
      );
      expect(result.wgsl).toMatch(/: f32 = /);
      expect(result.eval('t', [1, 1, []])).toBe(value);
    }
  });

  it('a counter started by the constant keeps its f32, as on main, and carries the mark', () => {
    // Each gave the same value on `main` (the counter was an f32 there).
    const plain = t(
      'let a = 0.; for (let j = K; j < 8; j++) { a += f32(j / 2); } return a;',
      'const K = 3;',
    );
    const result = accepted(plain);
    expect(result.wgsl).toContain('var j: f32 = K;');
    expect(result.eval('t', [1, 1, []])).toBe(12.5);
    // With another read of K as an integer, the `/` over the counter is refused.
    refused(
      t(
        'let a = 0.; for (let j = K; j < 8; j++) { a += f32(j / 2); } return a + f32(h(K));',
        'const K = 3;',
      ),
      [message('K', 'j / 2', 'f32(j) / 2')],
    );
  });
});

describe('a float-written operand makes a float division (Amendment A3, "실수 나눗셈으로 허용")', () => {
  // `N` is read as an integer by the loop bound in each; each was refused at `1abf8fbb`.
  const loop = 'let a = 0.; for (let j = 0; j < N; j++) { a += xs[j]; }';
  it.each([
    ['const STEP = 6.283185307179586 / N;', 'return a * STEP;'],
    ['const TAU = 6.283185307179586;', 'return a * (TAU / N);'],
    ['const W = N;', 'return a * (1.0 / W);'],
    ['', 'return a * ((N * 0.5) / 2);'],
    ['const H2 = N * 0.5;', 'return a * (H2 / 2);'],
    ['', 'let y = N * 0.5; return a * (y / 2);'],
    ['', 'return a * (N / 2.0);'],
  ])('accepts %s %s', (pre, body) => {
    const source = `"use typeshade";
const N = 8;
${pre}
export function t(xs: array<f32, 8>): f32 {
  ${loop}
  ${body}
}`;
    accepted(source);
  });
});

describe('the named edit (Amendment A3, M1 and M4)', () => {
  it('a typed integer position names the declaration with the type it asks', () => {
    const t = (body: string): string => `"use typeshade";
${H}export function t(xs: array<f32, 8>): f32 {
  ${body}
}`;
    const message =
      '"k" is a u32 where another line reads it, and no operand of "(k % 4) / 2" has a declared ' +
      'type, so the "/" does not say which division it is. Write "const k: u32 = 7" for the ' +
      'integer division.';
    for (const position of [
      'let j: u32 = (k % 4) / 2; return f32(j);',
      'return f32(h((k % 4) / 2));',
    ]) {
      refused(t(`const k = 7; h(k); ${position}`), [message]);
      accepted(t(`const k: u32 = 7; h(k); ${position}`));
    }
  });

  it('names the constant as the / reads it across an import: L.K and KK', () => {
    const lib = `"use typeshade";\nexport const K = 7;\n`;
    const read = (uri: string): string | undefined => (uri.includes('lib.shade') ? lib : undefined);
    for (const [head, name] of [
      ['import * as L from "./lib.shade";', 'L.K'],
      ['import { K as KK } from "./lib.shade";', 'KK'],
    ] as const) {
      const main = `"use typeshade";
${head}
${H}export function t(): f32 { return f32(h(${name})) + f32(${name} / 2); }`;
      const sentence =
        `"${name}" is a u32 where another line reads it, and no operand of "${name} / 2" has a ` +
        `declared type, so the "/" does not say which division it is. Write "f32(${name}) / 2" ` +
        `for the float division.`;
      const compiled = compile(main, { fileName: '/app/main.shade.ts', readDocument: read });
      expect(compiled.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
        `TS8003: ${sentence}`,
      ]);
      const checked = checkDocuments(
        [{ path: '/app/main.shade.ts', uri: '/app/main.shade.ts', text: main }],
        { readDocument: read },
      );
      expect(checked.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([
        `TS8003: ${sentence}`,
      ]);
      const fixed = main.replace(`f32(${name} / 2)`, `f32(f32(${name}) / 2)`);
      expect(
        compile(fixed, { fileName: '/app/main.shade.ts', readDocument: read }).diagnostics,
      ).toEqual([]);
    }
  });

  it('checkDocuments and compile() agree where the library raises a mismatch alone (M6)', () => {
    const lib = `"use typeshade";
export const K = 7;
export function lf(v: u32): u32 { return v + K / 2; }
`;
    const main = `"use typeshade";
import { K, lf } from "./lib.shade";
export function t(vi: u32): f32 { return f32(lf(vi)) + f32(vi * K); }
`;
    const read = (uri: string): string | undefined => (uri.includes('lib.shade') ? lib : undefined);
    const compiled = compile(main, { fileName: '/app/main.shade.ts', readDocument: read });
    const checked = checkDocuments(
      [{ path: '/app/main.shade.ts', uri: '/app/main.shade.ts', text: main }],
      { readDocument: read },
    );
    expect(checked.diagnostics.map((d) => `${d.file} ${d.code}: ${d.message}`)).toEqual(
      compiled.diagnostics.map((d) => `${d.fileName} ${d.code}: ${d.message}`),
    );
    expect(compiled.diagnostics).toHaveLength(1);
    // The refusal stands on the read in the importing file; the library's own mismatch around
    // the `/` is the same mistake, and the editor shows it once too.
    expect(compiled.diagnostics[0]!.fileName).toBe('/app/main.shade.ts');
    const open = createTypeshadeLanguageService({ readDocument: read });
    open.openDocument('/app/lib.shade.ts', lib);
    expect(open.getDiagnostics('/app/lib.shade.ts')).toHaveLength(1);
    open.openDocument('/app/main.shade.ts', main);
    expect(open.getDiagnostics('/app/lib.shade.ts')).toHaveLength(0);
    expect(open.getDiagnostics('/app/main.shade.ts')).toHaveLength(1);
  });
});

describe('the minor findings of the second review', () => {
  it('n ^= K with a value the target cannot hold is refused with the sentence of §13', () => {
    refused(
      `"use typeshade";
const K = 4294967295;
export function t(ii: i32): f32 { let n: i32 = ii; n ^= K; return f32(n); }`,
      [
        'The value has to fit: 4294967295 is outside i32, which holds -2147483648 to 2147483647 (§13).',
      ],
    );
  });

  it('n ^= C with a float-written constant stays refused as on main', () => {
    const source = `"use typeshade";
const C = 7.5;
export function t(vi: u32): f32 { let n: u32 = vi; n ^= C; return f32(n); }`;
    expect(compile(source).diagnostics.map((d) => d.code)).toEqual(['TS8003']);
    expect(compile(source).wgsl).toBeUndefined();
  });

  it('u32(-C) with C = 0.1 is 0u, not -0u', () => {
    const result = accepted(`"use typeshade";
const C = 0.1;
export function t(): u32 { return u32(-C); }`);
    expect(result.wgsl).toContain('return 0u;');
    expect(Object.is(result.eval('t'), -0)).toBe(false);
  });
});

describe('each path the second review found unpinned (its surviving mutants)', () => {
  const t = (body: string, pre = ''): string => `"use typeshade";
${pre}
${H}function hi(a: i32): i32 { return a; }
export function t(vi: u32, ii: i32, xs: array<f32, 8>): f32 {
  ${body}
}`;
  const ARGS3 = [2, 2, [1, 2, 3, 4, 5, 6, 7, 8]] as const;

  it('a value outside the integer the peer asks stays a mismatch, never a literal the writer refuses', () => {
    refused(t('return f32(vi + BIG);', 'const BIG = 5000000000;'), [
      'Type mismatch: cannot + u32 and f32 — no implicit int/float conversion. Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
    ]);
  });

  it('a static field read through super is a read of the constant', () => {
    const result = accepted(`"use typeshade";
class A { static K = 7; }
class B extends A { static f(vi: u32): u32 { return vi * super.K; } }
export function t(vi: u32): u32 { return B.f(vi); }`);
    expect(result.wgsl).toContain('return (vi * 7u);');
    expect(result.eval('t', [2])).toBe(14);
  });

  it('a call of a declared function has the declared result: h(k) / 2 divides integers', () => {
    expect(accepted(t('const k = 7; h(k); return f32(h(k) / 2);')).eval('t', ARGS3)).toBe(3);
  });

  it('a float-written constant is never read as an integer, also when its value is whole', () => {
    refused(t('let n: u32 = vi; n |= C; return f32(n);', 'const C = 8.0;'), [
      'Type mismatch: cannot |= u32 and f32 — no implicit int/float conversion. Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
    ]);
    refused(t('return f32(vi * M);', 'const M = 2 + 1.0;'), [
      'Type mismatch: cannot * u32 and f32 — no implicit int/float conversion. Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
    ]);
  });

  it('a hexadecimal literal with an e is integer-written: 0x1e', () => {
    expect(accepted(t('return f32(vi * H);', 'const H = 0x1e;')).eval('t', ARGS3)).toBe(60);
  });

  it('a negated read is the negated written number: ii + -K', () => {
    const result = accepted(t('return f32(ii + -K);', 'const K = 3;'));
    expect(result.wgsl).toContain('(ii + -3)');
    expect(result.eval('t', ARGS3)).toBe(-1);
  });

  it('a read inside the / and the quotient read around it are not other reads', () => {
    expect(accepted(t('return f32((K | 1) / 2);', 'const K = 7;')).eval('t', ARGS3)).toBe(3.5);
    expect(
      accepted(t('let j: u32 = E / 2 + 1; return f32(j);', 'const E = 8;')).eval('t', ARGS3),
    ).toBe(5);
  });

  it('names the first constant the / reaches that another line reads as an integer', () => {
    refused(t('h(A); h(B); return f32((A + B) / 2);', 'const A = 7;\nconst B = 3;'), [
      '"A" is a u32 where another line reads it, and no operand of "(A + B) / 2" has a declared ' +
        'type, so the "/" does not say which division it is. Write "(f32(A) + f32(B)) / 2" for ' +
        'the float division.',
    ]);
  });

  it('names a static field by its short name and its keyword', () => {
    const source = t('h(S.K); return xs[S.K / 2];', 'class S { static K = 7; }');
    refused(source, [
      '"S.K" is a u32 where another line reads it, and no operand of "S.K / 2" has a declared ' +
        'type, so the "/" does not say which division it is. Write "static K: u32 = 7" for the ' +
        'integer division.',
    ]);
    accepted(source.replace('static K = 7;', 'static K: u32 = 7;'));
  });

  it('the innermost position decides the type of the edit', () => {
    // `hi` asks an `i32`, then the index; `h(K)` reads `K` as a `u32`, so no declaration fits.
    refused(t('h(K); return xs[hi(K / 2)];', 'const K = 7;'), [
      '"K" is a u32 where another line reads it, and no operand of "K / 2" has a declared ' +
        'type, so the "/" does not say which division it is. Write "i32(K) / 2" for the integer ' +
        'division.',
    ]);
  });

  it('an element of a value that carries the mark carries it', () => {
    refused(t('const k = 7; h(k); return f32(vec2(k, 1)[0] / 2);'), [
      '"k" is a u32 where another line reads it, and no operand of "vec2(k, 1)[0] / 2" has a ' +
        'declared type, so the "/" does not say which division it is. Write ' +
        '"vec2(f32(k), 1)[0] / 2" for the float division.',
    ]);
  });

  it('an imported constant is not declared in the importing file: the edit converts', () => {
    const lib = `"use typeshade";\nexport const K = 7;\n`;
    const main = `"use typeshade";
import { K } from "./lib.shade";
${H}export function t(xs: array<f32, 8>): f32 { h(K); return xs[K / 2]; }`;
    const read = (uri: string): string | undefined => (uri.includes('lib.shade') ? lib : undefined);
    const compiled = compile(main, { fileName: '/app/main.shade.ts', readDocument: read });
    expect(compiled.diagnostics.map((d) => d.message)).toEqual([
      '"K" is a u32 where another line reads it, and no operand of "K / 2" has a declared ' +
        'type, so the "/" does not say which division it is. Write "u32(K) / 2" for the ' +
        'integer division.',
    ]);
  });

  it('a second compile of one source file forgets the divisions of the first', () => {
    // The same file compiles differently when the language service marks `: f32` as its own
    // annotation (a constant of no fixed type) and then as the author's (an `f32` field).
    const source = `"use typeshade";
class S { static K: f32 = 7; }
${H}export function t(): f32 { return f32(h(S.K)) + f32(S.K / 2); }`;
    const sf = ts.createSourceFile('a.ts', source, ts.ScriptTarget.Latest, true);
    markProjectedAnnotations(sf, [source.indexOf(': f32 = 7')]);
    expect(
      compileTsSource(source, { sourceFile: sf, emit: false }).diagnostics.map((d) => d.code),
    ).toEqual(['TS8003']);
    markProjectedAnnotations(sf, []);
    expect(
      compileTsSource(source, { sourceFile: sf, emit: false }).diagnostics.map((d) => d.message),
    ).toEqual(['Argument 1 of "h" type mismatch.']);
  });

  it('a second compile of the same source file reports each / once', () => {
    const source = t('const k = 7; h(k); return f32(k / 2);');
    const sf = ts.createSourceFile('a.ts', source, ts.ScriptTarget.Latest, true);
    compileTsSource(source, { sourceFile: sf, emit: false });
    expect(compileTsSource(source, { sourceFile: sf, emit: false }).diagnostics).toHaveLength(1);
  });

  it('a refusal two importing files give stands once in each, on its own read', () => {
    const lib = `"use typeshade";\nexport const K = 7;\nexport function half(x: f32): f32 { return x * (K / 2); }\n`;
    const main = (n: string): string => `"use typeshade";
import { K, half } from "./lib.shade";
export function ${n}(vi: u32, x: f32): f32 { return f32(vi * K) + half(x); }
`;
    const docs = [
      { path: '/app/a.shade.ts', uri: '/app/a.shade.ts', text: main('a') },
      { path: '/app/b.shade.ts', uri: '/app/b.shade.ts', text: main('b') },
    ];
    const read = (uri: string): string | undefined => (uri.includes('lib.shade') ? lib : undefined);
    expect(checkDocuments(docs, { readDocument: read }).diagnostics.map((d) => d.file)).toEqual([
      '/app/a.shade.ts',
      '/app/b.shade.ts',
    ]);
    const open = createTypeshadeLanguageService({ readDocument: read });
    open.openDocument('/app/lib.shade.ts', lib);
    for (const d of docs) open.openDocument(d.uri, d.text);
    expect(open.getDiagnostics('/app/lib.shade.ts')).toHaveLength(0);
    for (const d of docs) expect(open.getDiagnostics(d.uri)).toHaveLength(1);
  });
});

describe('non-division arithmetic keeps the written number (decided 2026-11-10)', () => {
  // The owner's decision ("규칙대로 두고 기록"): these changed value with item 2 and stay.
  it('const k = 7; h(k); f32(k - 8) is -1 (4294967295 before, a u32 subtraction)', () => {
    const source = `"use typeshade";
${H}export function t(): f32 { const k = 7; h(k); return f32(k - 8); }`;
    const result = accepted(source);
    expect(result.wgsl).toContain('return f32(-1.0);');
    expect(result.eval('t')).toBe(-1);
  });

  it('const k = 7; h(k); f32(k * 1000000000) is 7000000000 (a wrapped u32 before)', () => {
    const source = `"use typeshade";
${H}export function t(): f32 { const k = 7; h(k); return f32(k * 1000000000); }`;
    expect(accepted(source).eval('t')).toBe(7000000000);
  });

  it('k % 8 takes the type of its read: xs[k % 8] is xs[7], as before', () => {
    const source = `"use typeshade";
${H}export function t(xs: array<f32, 8>): f32 { const k = 7; h(k); return xs[k % 8]; }`;
    const result = accepted(source);
    expect(result.wgsl).toContain('return xs[7];');
    expect(result.eval('t', [[1, 2, 3, 4, 5, 6, 7, 8]])).toBe(8);
  });
});

describe('a constant in a declared f64 position carries the full double', () => {
  it.each([
    ['a declared local', 'let q: f64 = C; return q * x;'],
    ['a return', 'return C;'],
    ['an argument', 'return wide(C) * x;'],
    ['a compound assignment', 'let q: f64 = x; q *= C; return q;'],
  ])('%s: %s', (_what, body) => {
    const source = `"use typeshade";
const C = 0.1;
function wide(a: f64): f64 { return a; }
export function t(x: f64): f64 { ${body} }`;
    const result = accepted(source);
    expect(result.wgsl).toContain('vec2<f32>(0.10000000149011612, -1.4901161415892261e-9)');
    expect(result.eval('t', [1])).toBe(0.1);
  });

  it('a typed f64 constant from a constant: const D: f64 = C', () => {
    const source = `"use typeshade";
const C = 0.1;
const D: f64 = C;
export function t(x: f64): f64 { return x * D; }`;
    expect(accepted(source).eval('t', [1])).toBe(0.1);
  });
});

describe('the third review of #1184', () => {
  const H3 = `function h(a: u32): u32 { return a; }\nfunction id<T>(a: T): T { return a; }\n`;
  const t = (body: string, pre = ''): string => `"use typeshade";
${pre}
${H3}export function t(vi: u32, x: f32, xs: array<f32, 8>): f32 {
  ${body}
}`;
  const XS = [1, 2, 3, 4, 5, 6, 7, 8];
  const EDIT =
    /^"(.+?)" is (?:a u32|an i32) where another line reads it, and no operand of "(.+)" has a declared type, so the "\/=?" does not say which division it is\. Write "(.+)" for the (?:integer|float) division\.$/s;

  /** Requires one refusal of a `/` in both halves, the same text in each, and returns the
   *  source with the edit it names made. */
  const editOf = (source: string): string => {
    const result = compile(source);
    const lines = result.diagnostics.map((d) => `${d.code}: ${d.message}`);
    expect(lines).toHaveLength(1);
    expect(editor(source)).toEqual(lines);
    const d = result.diagnostics[0]!;
    const m = EDIT.exec(d.message);
    expect(m).not.toBeNull();
    const [, , written, edit] = m!;
    if (/^(const|let|static) /.test(edit!))
      return source.replace(edit!.replace(/: (u32|i32|f32)/, ''), edit!);
    const at = source.indexOf(written!);
    expect(at).toBeGreaterThanOrEqual(0);
    return source.slice(0, at) + edit + source.slice(at + written!.length);
  };

  it('F1: a closure or a local function that captures a marked let carries its origin', () => {
    for (const body of [
      'const k = 7; h(k); let y = k; const g = () => y; return f32(g() / 2);',
      'const k = 7; h(k); let y = k; const g = () => f32(y / 2); return g();',
      'const k = 7; h(k); let y = k; function g() { return y; } return f32(g() / 2);',
      'const k = 7; h(k); let y = k; const g = () => { y /= 2; }; g(); return f32(y);',
    ]) {
      // Each was 3.5, silently, at 345d3ae8 (base: the integer division 3).
      accepted(editOf(t(body)));
    }
  });

  it('F2: the editor refuses a / over a local function result as compile() does', () => {
    for (const body of [
      'const k = 7; h(k); const g = () => k + 1; return f32(g() / 2);',
      'const k = 7; h(k); const g = () => { return k + 1; }; return f32(g() / 2);',
      'const k = 7; h(k); function g() { return k + 1; } return f32(g() / 2);',
      'const k = 7; h(k); const g = () => x > 0 ? k : 1; return f32(g() / 2);',
    ]) {
      accepted(editOf(t(body)));
    }
    // A method and a getter, whose result type the projection writes too.
    accepted(
      editOf(
        t(
          'const c = new C(); return f32(c.m() / 2) + f32(h(K));',
          'const K = 7;\nclass C { m() { return K + 1; } }',
        ),
      ),
    );
    // A recursive function is one mistake in both halves (F8).
    const recursive = t(
      'return f32(g(2) / 2);',
      'function g(n: u32) { const k = 7; h(k); if (n > 0) { return g(n - 1); } return k; }',
    );
    const lines = compile(recursive).diagnostics.map((d) => `${d.code}: ${d.message}`);
    expect(lines.map((l) => l.slice(0, 6))).toEqual(['TS8031']);
    expect(editor(recursive)).toEqual(lines);
  });

  it('F3: the named edit compiles where the quotient stands', () => {
    for (const body of [
      'const k = 7; h(k); return f32(-k / 2);',
      'const k = 7; h(k); return f32(Math.trunc(k) / 2);',
      'const k = 7; h(k); return f32(sign(k) / 2);',
      'const k = 7; h(k); return f32(vec3(k, 1, 2).x / 2);',
      'const k = 7; h(k); let w = 3; return f32((k + w) / 2);',
      'const k = 7; h(k); const [a, b] = [k, 1]; return f32(a / 2 + b);',
    ]) {
      accepted(editOf(t(body)));
    }
    // A static field the projection annotates: the declaration edit replaces that type.
    accepted(editOf(t('return xs[S.K / 2] + f32(h(S.K));', 'class S { static K = 7; }')));
    // A field the projection annotates from the constant: the editor checks the edit on the
    // author's text, as compile() does, and names the same edit.
    accepted(editOf(t('h(k); return xs[A.n / 2];', 'const k = 7;\nclass A { static n = k; }')));
    // Where no edit compiles, the program holds a second mistake (an `f32` sum passed to a `u32`
    // parameter; a `u32` sum returned from an `f32` function, which `main` reported): the edit
    // that adds fewest errors is named, and a mismatch around the `/` stays only where that edit
    // leaves it. One diagnostic each, as on `main` (Rule 12.4, the owner's decision of
    // 2026-11-11, "12.4: 진단 하나").
    for (const body of [
      'const k = 7; h(k); return f32(h(x + k / 2));',
      'const k = 7; h(k); return vi + k / 2;',
      'const k = 7; h(k); return xs[-k / 2];',
      'const k = 7; h(k); return f32(h(-k / 2));',
      'const k = 7; h(k); return f32(vi + -k / 2);',
      'const k = 7; h(k); let j: u32 = -k / 2; return f32(j);',
    ]) {
      const source = t(body);
      const lines = compile(source).diagnostics.map((d) => d.message);
      expect(lines).toEqual([
        expect.stringContaining('Write "const k: u32 = 7" for the integer division.'),
      ]);
      expect(editor(source).map((l) => l.replace(/^TS\d+: /, ''))).toEqual(lines);
    }
  });

  it('each named edit compiles alone (the fifth review, finding 1)', () => {
    // `const k: u32 = 7` would make `x * (k / 3)` multiply an f32 by a u32: the first `/` names
    // the conversion, as checking each edit alone does.
    const source = t('const k = 7; h(k); return f32(vi + k / 2) + x * (k / 3);');
    expect(compile(source).diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('Write "u32(k) / 2" for the integer division.'),
      expect.stringContaining('Write "f32(k) / 3" for the float division.'),
    ]);
    expect(editor(source).map((l) => l.replace(/^TS\d+: /, ''))).toEqual(
      compile(source).diagnostics.map((d) => d.message),
    );
    for (const edited of [
      source.replace('vi + k / 2', 'vi + u32(k) / 2'),
      source.replace('x * (k / 3)', 'x * (f32(k) / 3)'),
    ]) {
      const lines = compile(edited).diagnostics.map((d) => d.message);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('does not say which division it is');
    }
  });

  it('a counter started by u32(…) of an untyped constant counts in u32 (#1235, deviation 13)', () => {
    // Each gave this value on `main`, and was refused here until #1235 (`2fae525a`) made an
    // integer conversion that starts a counter declare its type.
    const program = (body: string) => `"use typeshade";
function h(a: u32): u32 { return a; }
function hi(a: i32): i32 { return a; }
const KM = 3;
export function t(vi: u32): f32 {
  ${body}
  return s;
}`;
    for (const [body, value] of [
      ['const k = 3; h(k); let s = 0.; for (let j = u32(k); j < 8; j++) { s += f32(h(j)); }', 25],
      ['const k = 3; h(k); let s = 0.; for (let j = u32(k); j < vi; j++) { s += f32(j); }', 7],
      ['const k = 3; h(k); let s = 0.; for (let j = u32(k); j < 8; j++) { s += f32(j + vi); }', 50],
      ['const k = 3; hi(k); let s = 0.; for (let j = i32(k); j < 8; j++) { s += f32(hi(j)); }', 25],
      ['const k = 3; let s = 0.; for (let j = u32(k); j < 8; j++) { s += f32(h(j)); }', 25],
      ['let s = 0.; for (let j = u32(KM); j < 8; j++) { s += f32(h(j)); }', 25],
      [
        'const k = 3; h(k); let s = 0.; for (let j = u32(k + 1); j < 8; j++) { s += f32(h(j)); }',
        22,
      ],
    ] as const) {
      expect(accepted(program(body)).eval('t', [5])).toBe(value);
    }
  });

  it('an f32 edit leaves an index and a shift amount integers (the fourth review, finding 3)', () => {
    for (const [body, edit] of [
      ['const k = 1; h(k); return f32(vec2(k, 5)[k] / 2);', 'vec2(f32(k), 5)[k] / 2'],
      ['const k = 1; h(k); return f32((k << k) / 2);', 'f32(k << k) / 2'],
    ] as const) {
      const source = t(body);
      expect(compile(source).diagnostics.map((d) => d.message)).toEqual([
        expect.stringContaining(`Write "${edit}" for the float division.`),
      ]);
      accepted(editOf(source));
    }
  });

  it('F4: a typed constructor declares its type and ends the origin (Amendment A4)', () => {
    for (const body of [
      'const k = 7; h(k); return f32(vec3u(k, 1, 2).x / 2);',
      'const k = 7; h(k); return f32((vec3u(k, 3, 1) / 2).x);',
      'const k = 7; h(k); return f32(vec2<u32>(k, 1).x / 2);',
    ]) {
      expect(accepted(t(body)).eval('t', [1, 1, XS])).toBe(3);
    }
  });

  it('an annotated counter declares its type', () => {
    // The third review's F6 (a conversion start declares the counter's type) is its own bug fix
    // (the owner's decision of 2026-11-11, "별도 버그 수정 PR로 분리").
    // An annotated counter declares its type: a `/` over it is the typed division.
    expect(
      accepted(
        t(
          'const k = 3; h(k); let a = 0.; for (let j: u32 = k; j < 8; j++) { a += f32(j / 2); } return a;',
        ),
      ).eval('t', [1, 1, XS]),
    ).toBe(1 + 2 + 2 + 3 + 3);
  });

  it('F7: a pattern binding carries the origin of the element it reads', () => {
    expect(
      accepted(t('const k = 7; h(k); const [a, b] = [k, 1]; return f32(b / 2);')).eval('t', [
        1,
        1,
        XS,
      ]),
    ).toBe(0.5);
    accepted(editOf(t('const k = 7; h(k); const [a, b] = [k, 1]; return f32(a / 2);')));
  });

  it('F10: a generic parameter declares no type, so id(k) / 2 is refused (Amendment A4)', () => {
    accepted(editOf(t('const k = 7; h(k); return f32(id(k) / 2);')));
  });

  it('a float-written value through a function result makes a float division', () => {
    // Pins `noteCarriedReturn`'s float (mutant X14).
    expect(
      accepted(
        t('return f32(g() / 2) + f32(h(K));', 'const K = 7;\nfunction g() { return K * 0.5; }'),
      ).eval('t', [1, 1, XS]),
    ).toBe(1.75 + 7);
    // A let of written numbers alone adds no origin and declares no type: a float-written one
    // makes a float division.
    expect(
      accepted(t('const k = 7; h(k); let w = 3.5; return f32((k + w) / 2);')).eval('t', [1, 1, XS]),
    ).toBe(5.25);
  });

  it('a counter whose start holds a / is refused once', () => {
    // Pins `containsDivision` (mutant C01): the start is not lowered a second time.
    const source = t(
      'const k = 7; h(k); let a = 0.; for (let j = k / 2; j < 8; j++) { a += 1.; } return a;',
    );
    accepted(editOf(source));
  });
});
