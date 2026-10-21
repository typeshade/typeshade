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
