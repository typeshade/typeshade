// Verifies: Rule 4.1 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 7.8 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
//
// Key types (change 0081, part 1): a union of string literal types is a closed set of names,
// each a u32 id in the order of its members' UTF-16 code units. Each spelling and each refusal is
// read by the compiler and by the editor on the same source (Rule 12.7), and the host passes and
// gets the members as strings (Rule 8.21).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compile } from './compile.js';
import { hostFace } from './host-face.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const editor = (source: string): string[] => {
  const s = createTypeshadeLanguageService();
  s.openDocument('a.ts', source);
  return s.getDiagnostics('a.ts').map((d) => `${String(d.code)} ${d.message}`);
};

const compiler = (source: string): string[] =>
  compile(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

/** Both halves on one source: the same list, refusals and acceptance alike (Rule 12.7). */
const both = (source: string): string[] => {
  const c = compiler(source);
  expect(editor(source)).toEqual(c);
  return c;
};

const PICK = `"use typeshade";
type Channel = "r" | "g" | "b";
class P { c: Channel; w: f32; }
function gain(c: Channel): f32 { return c === "g" ? 2. : 1.; }
export function pick(c: Channel, x: f32): f32 {
  let d: Channel = "g";
  d = c;
  const p = new P();
  p.c = "r";
  if ("b" !== d) { return x * gain(d) * gain("r"); }
  switch (c) {
    case "g":
      return x + 1.;
    default:
      return 0.;
  }
}
export function brightest(r: f32, g: f32, b: f32): Channel {
  if (r >= g && r >= b) { return "r"; }
  return g >= b ? "g" : "b";
}
`;

describe('a key type in the shader (change 0081)', () => {
  it('compiles in both halves, each member its id in code-unit order', () => {
    expect(both(PICK)).toEqual([]);
    const wgsl = compile(PICK).wgsl!;
    // "b" < "g" < "r": b is 0, g is 1, r is 2.
    expect(wgsl).toContain('fn pick(c: u32, x: f32) -> f32');
    expect(wgsl).toContain('var d: u32 = 1u;');
    expect(wgsl).toContain('p.c = 2u;');
    expect(wgsl).toContain('(0u != d)');
    expect(wgsl).toContain('case 1u:');
  });

  it('gives two spellings of one union the same ids', () => {
    const a = compile(`"use typeshade";
export function f(c: "r" | "g" | "b"): f32 { return c === "r" ? 1. : 0.; }`).wgsl!;
    const b = compile(`"use typeshade";
type C = "b" | "r" | "g";
export function f(c: C): f32 { return c === "r" ? 1. : 0.; }`).wgsl!;
    expect(a).toContain('(c == 2u)');
    expect(b).toContain('(c == 2u)');
  });

  it('refuses a string outside the union, in both halves', () => {
    expect(
      both(`"use typeshade";
type Channel = "r" | "g" | "b";
export function f(c: Channel): f32 { return c === "q" ? 1. : 0.; }`),
    ).toEqual([
      'TS8003 "q" is not a member of "b" | "g" | "r", so it has no id there. Write one of ' +
        'the members.',
    ]);
  });

  it('refuses every operator but === and !== on a key, in both halves', () => {
    expect(
      both(`"use typeshade";
type Channel = "r" | "g" | "b";
export function f(c: Channel): f32 { return c < "g" ? 1. : 0.; }`),
    ).toEqual([
      'TS8003 A value of "b" | "g" | "r" is one of its members, and "<" has nothing to do with ' +
        'one: compare it with === or !==, or switch over it.',
    ]);
  });

  it('refuses two key types compared, in both halves', () => {
    expect(
      both(`"use typeshade";
type Channel = "r" | "g" | "b";
export function f(c: Channel, o: "r" | "x"): f32 { return c === o ? 1. : 0.; }`),
    ).toEqual([
      'TS8003 "===" compares "b" | "g" | "r" with "r" | "x", and the two have no value in ' +
        'common. Compare a key with a member of its own union.',
    ]);
  });

  it('refuses a u32 where a key is due, and a key where a u32 is, in both halves', () => {
    expect(
      both(`"use typeshade";
type Channel = "r" | "g" | "b";
export function f(x: u32): f32 { const c: Channel = x; return 1.; }`),
    ).toEqual([
      'TS8003 "x" is u32, and a place of "b" | "g" | "r" holds one of its members. Write a ' +
        'member as a string.',
    ]);
    expect(
      both(`"use typeshade";
type Channel = "r" | "g" | "b";
export function f(c: Channel): u32 { const n: u32 = c; return n; }`),
    ).toEqual([
      'TS8003 "c" is "b" | "g" | "r", a key and not a number, and this place is u32. Compare ' +
        'it with a member, or switch over it.',
    ]);
    expect(
      both(`"use typeshade";
type Channel = "r" | "g" | "b";
export function f(): f32 { let c: Channel = "r"; c = 1; return 1.; }`),
    ).toEqual([
      'TS8003 "1" is a number, and a place of "b" | "g" | "r" holds one of its members. Write ' +
        'a member as a string.',
    ]);
  });

  it('refuses a number as the case of a switch over a key', () => {
    expect(
      both(`"use typeshade";
type Channel = "r" | "g" | "b";
export function f(c: Channel): f32 {
  switch (c) {
    case 1:
      return 1.;
    default:
      return 0.;
  }
}`),
    ).toEqual([
      'TS8003 "1" is a number, and a place of "b" | "g" | "r" holds one of its members. Write ' +
        'a member as a string.',
    ]);
  });

  it('keeps string refused', () => {
    expect(
      both(`"use typeshade";
export function f(s: string): f32 { return 1.; }`),
    ).toEqual([
      'TS8002 A string has no GPU representation: there is nothing for it to be at run time. ' +
        'Text that picks between cases is a key type, a union of string literals such as ' +
        '"a" | "b", whose values the GPU holds as ids.',
    ]);
  });
});

describe('a key type on the host (change 0081, Rule 8.21)', () => {
  const face = () => {
    const f = hostFace(PICK, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
    expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    return f as Required<typeof f>;
  };

  it('types the parameter and the result as the members', () => {
    const view = face().view;
    expect(view).toContain('pick(c: "b" | "g" | "r", x: number)');
    expect(view).toContain('brightest(r: number, g: number, b: number): "b" | "g" | "r";');
  });

  it('takes and gives the strings, and refuses one outside the union', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-key-types-'));
    dirs.push(dir);
    const file = join(dir, 'm.shade.mjs');
    writeFileSync(file, face().code);
    const m = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<
      string,
      (...a: unknown[]) => Promise<unknown>
    >;
    expect(await m.pick!('g', 3)).toBe(6);
    expect(await m.pick!('b', 3)).toBe(0);
    expect(await m.brightest!(0.1, 0.9, 0.2)).toBe('g');
    expect(() => m.pick!('q', 3)).toThrow(
      'pick(): parameter "c" ("b" | "g" | "r"): got the string "q", which is not one of ' +
        '"b" | "g" | "r".',
    );
  });
});

const BOOST = `"use typeshade";
type Channel = "r" | "g" | "b";
const GAIN: Record<Channel, f32> = { r: 1.5, g: 1.0, b: 0.5 };
export function boost(c: Channel, x: f32, by: Record<Channel, f32>): f32 {
  let t: Record<Channel, u32> = { b: 3, r: 1, g: 2 };
  t.g = 7;
  t[c] = t["b"] + 1;
  return x * GAIN[c] * by[c] * by.r * f32(t.g);
}
export function scaled(by: Record<Channel, f32>, k: f32): Record<Channel, f32> {
  return { r: by.r * k, g: by.g * k, b: by["b"] * k };
}
`;

describe('Record over a key type (change 0081, section 2)', () => {
  it('is an array in id order, indexed by the key, in both halves', () => {
    expect(both(BOOST)).toEqual([]);
    const wgsl = compile(BOOST).wgsl!;
    expect(wgsl).toContain('const GAIN: array<f32, 3> = array<f32, 3>(0.5, 1.0, 1.5);');
    expect(wgsl).toContain('fn boost(c: u32, x: f32, by: array<f32, 3>) -> f32');
    expect(wgsl).toContain('var t: array<u32, 3> = array<u32, 3>(3u, 2u, 1u);');
    expect(wgsl).toContain('t[1u] = 7u;');
    expect(wgsl).toContain('t[c] = (t[0u] + 1u);');
  });

  const refused: readonly (readonly [string, string, string])[] = [
    [
      'a name that is no key',
      'export function f(by: Record<Channel, f32>): f32 { return by.q; }',
      'TS8022 "q" is not a key of this Record, whose keys are "b" | "g" | "r".',
    ],
    [
      'length',
      'export function f(by: Record<Channel, f32>): f32 { return f32(by.length); }',
      'TS8022 "length" is not a key of this Record, whose keys are "b" | "g" | "r".',
    ],
    [
      'a number as the index',
      'export function f(by: Record<Channel, f32>): f32 { return by[0]; }',
      'TS8003 A Record is indexed by one of its keys, "b" | "g" | "r", and "0" is a number.',
    ],
    [
      'a missing key',
      'export function f(): f32 { const t: Record<Channel, f32> = { r: 1., g: 2. }; return t.r; }',
      'TS8003 This Record has no value for "b": a Record holds one value for each of its keys.',
    ],
    [
      'an extra key',
      'export function f(): f32 { const t: Record<Channel, f32> = { r: 1., g: 2., b: 3., q: 4. }; return t.r; }',
      'TS8010 "q" is not a key of this Record, whose keys are "b" | "g" | "r".',
    ],
    [
      'an open key type',
      'export function f(t: Record<u32, f32>): f32 { return 1.; }',
      'TS8002 The key K of a Record<K, V> is a union of string literals, a closed set of names ' +
        'whose ids index the table; "u32" is none. An array or a Map is the type for an open ' +
        'set of keys.',
    ],
  ];
  for (const [what, body, message] of refused) {
    it(`refuses ${what}, in both halves`, () => {
      expect(
        both(`"use typeshade";
type Channel = "r" | "g" | "b";
${body}`),
      ).toEqual([message]);
    });
  }

  it('is an object of its keys on the host', async () => {
    const f = hostFace(BOOST, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
    expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(f.view).toContain(
      'boost(c: "b" | "g" | "r", x: number, by: { readonly "b": number; readonly "g": number; ' +
        'readonly "r": number }): number',
    );
    expect(f.view).toContain('): { "b": number; "g": number; "r": number };');
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-record-'));
    dirs.push(dir);
    const file = join(dir, 'm.shade.mjs');
    writeFileSync(file, f.code!);
    const m = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<
      string,
      (...a: unknown[]) => unknown
    >;
    // t.g is 7, then t[c] = t.b + 1 = 4 with c = "g": x * GAIN.g * by.g * by.r * t.g is
    // 2 * 1 * 3 * 2 * 4.
    expect(m.boost!('g', 2, { r: 2, g: 3, b: 4 })).toBe(48);
    expect(m.scaled!({ g: 2, b: 3, r: 1 }, 2)).toEqual({ b: 6, g: 4, r: 2 });
    expect(() => m.boost!('g', 2, { r: 2, g: 3 })).toThrow(
      'boost(): parameter "by" (Record<"b" | "g" | "r", f32>): at .b, the key is missing.',
    );
    expect(() => m.boost!('g', 2, { r: 2, g: 3, b: 4, q: 1 })).toThrow(
      'boost(): parameter "by" (Record<"b" | "g" | "r", f32>): at .q, the key is none of ' +
        '"b" | "g" | "r".',
    );
  });
});
