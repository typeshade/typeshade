// The editor's hover on a constant of no fixed type (change 0134 item 4; Rules 5.1 and 12.7).
//
// `const K = 3` has no one type: each read takes the type the written number `3` would take in
// its place (Rule 5.1). The hover names the declaration in the language's own words (decision
// Q3), `const K = 3 (i32, u32, f32 or f64 where it is read)`, and each read at the type the
// compiler gave that read: `const K: u32` in `vi * K`.
//
// Each case reads BOTH halves on one source (`CLAUDE.md`, "A test reads both halves"): `compile()`
// (its diagnostics with code and text, and the emitted WGSL that shows the type each read took)
// and the language service (`getDiagnostics`, and `getHover`, since the type is the point).
//
// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { createTypeshadeLanguageService, type TypeshadeLanguageService } from './service.js';

/** The files of one project, by the name each is opened and imported under. */
type Files = Readonly<Record<string, string>>;

const A = '/p/a.shade.ts';
const LIB = '/p/lib.shade.ts';

/** A service with every file of `files` open. */
const opened = (files: Files): TypeshadeLanguageService => {
  const service = createTypeshadeLanguageService();
  for (const [name, text] of Object.entries(files)) service.openDocument(name, text);
  return service;
};

/** The first line of the hover in `name`, at the first `needle` after `from`, `skip` in. */
const hoverLine = (
  service: TypeshadeLanguageService,
  files: Files,
  name: string,
  needle: string,
  skip = 0,
  from = '',
): string => {
  const text = files[name]!;
  const at = text.indexOf(needle, text.indexOf(from));
  expect(at, `"${needle}" is in ${name}`).toBeGreaterThanOrEqual(0);
  const contents = service.getHover(name, service.positionAt(name, at + skip))?.contents ?? '';
  // The first section is a fenced block whose one line is the declaration line.
  return contents.split('\n')[1] ?? '';
};

/** The compiler half of `entry`, linked with what it imports. */
const compiled = (files: Files, entry: string) =>
  compile(files[entry]!, { fileName: entry, readDocument: (name) => files[name] });

/** The editor's diagnostics of `name`, as `code: message`. */
const editor = (service: TypeshadeLanguageService, name: string): string[] =>
  service.getDiagnostics(name).map((d) => `${String(d.code)}: ${String(d.message)}`);

/** Both halves accept every file of `files`; returns the open service. */
const accepted = (files: Files): TypeshadeLanguageService => {
  const service = opened(files);
  for (const name of Object.keys(files)) {
    expect(compiled(files, name).diagnostics, name).toEqual([]);
    expect(editor(service, name), name).toEqual([]);
  }
  return service;
};

const INT = 'i32, u32, f32 or f64 where it is read';
const FLOAT = 'f32 or f64 where it is read';

describe('a module constant of no fixed type', () => {
  const files = {
    [A]: `"use typeshade";
const K = 8;
const C = 0.25;
const H = 8;
export function t(vi: u32, x: f32, xs: array<f32, 8>, d: f64): f32 {
  let a = vi * K;
  let b = x * K;
  let e = xs[K - 1];
  let c = d * C;
  let s = 0.0;
  for (let i = 0; i < K; i++) { s += x * C; }
  let j: u32 = H / 2;
  return f32(a) + b + e + f32(c) + s + f32(j) + f32(u32(K)) + f32(f64(K));
}`,
  };
  const service = accepted(files);
  const wgsl = compiled(files, A).wgsl!;
  const at = (needle: string, skip = 0): string => hoverLine(service, files, A, needle, skip);

  it('names the declaration in the language words (decision Q3)', () => {
    expect(at('K = 8')).toBe(`const K = 8 (${INT})`);
    expect(at('C = 0.25')).toBe(`const C = 0.25 (${FLOAT})`);
    // The declaration the backends write is the f32 one an f32 read names (Amendment A1).
    expect(wgsl).toContain('const K: f32 = 8.0;');
  });

  it('names each read at the type the compiler gave it there', () => {
    expect(wgsl).toContain('(vi * 8u)');
    expect(at('vi * K', 5)).toBe('const K: u32');
    expect(wgsl).toContain('(x * K)');
    expect(at('x * K', 4)).toBe('const K: f32');
    expect(at('xs[K', 3)).toBe('const K: i32');
    expect(at('d * C', 4)).toBe('const C: f64');
    expect(at('i < K', 4)).toBe('const K: i32');
    expect(at('x * C', 4)).toBe('const C: f32');
  });

  it('names the read in the quotient a typed position holds, and in a conversion', () => {
    // The quotient's own read is not another read (Amendment A4): `let j: u32 = H / 2` is `4u`.
    expect(wgsl).toContain('var j: u32 = 4u;');
    expect(at('H / 2')).toBe('const H: u32');
    expect(at('u32(K)', 4)).toBe('const K: u32');
    expect(at('f64(K)', 4)).toBe('const K: f64');
  });
});

describe('a function-local constant, a derived constant and a static field', () => {
  const files = {
    [A]: `"use typeshade";
const K = 3;
const M = K * 2;
class S { static Z = 4; }
function h(a: u32): u32 { return a; }
export function t(vi: u32, x: f32): f32 {
  const k = 7;
  return f32(h(k)) + x * f32(k) + f32(vi * M) + f32(vi + S.Z) + x * S.Z;
}`,
  };
  const service = accepted(files);
  const wgsl = compiled(files, A).wgsl!;
  const at = (needle: string, skip = 0): string => hoverLine(service, files, A, needle, skip);

  it('reads a function-local constant at each type (Rule 5.1)', () => {
    expect(at('k = 7')).toBe(`const k = 7 (${INT})`);
    expect(wgsl).toContain('h(7u)');
    expect(at('h(k)', 2)).toBe('const k: u32');
    expect(at('f32(k)', 4)).toBe('const k: f32');
  });

  it('reads a constant derived from another as one, and the source in it as no one type', () => {
    expect(at('M = K')).toBe(`const M = K * 2 (${INT})`);
    // `K` in `M`'s initializer is part of `M`'s value, which has no one type.
    expect(at('K * 2')).toBe(`const K = 3 (${INT})`);
    expect(wgsl).toContain('(vi * 6u)');
    expect(at('vi * M', 5)).toBe('const M: u32');
  });

  it('reads a static field that no code writes as such a constant (Rule 8.13)', () => {
    expect(at('Z = 4')).toBe(`static Z = 4 (${INT})`);
    expect(at('vi + S.Z', 7)).toBe('(property) S.Z: u32');
    expect(at('x * S.Z', 6)).toBe('(property) S.Z: f32');
  });
});

describe('a read with no one type', () => {
  it('names the declaration where a generic function reads the constant at two types', () => {
    const files = {
      [A]: `"use typeshade";
const K = 2;
function g<T extends f32 | u32>(v: T): f32 { return f32(v * K); }
export function t(vi: u32, x: f32): f32 { return g(vi) + g(x); }`,
    };
    const service = accepted(files);
    // One instance reads `2u`, the other the f32 name: no one type is the read's.
    const wgsl = compiled(files, A).wgsl!;
    expect(wgsl).toContain('(v * 2u)');
    expect(wgsl).toContain('(v * K)');
    expect(hoverLine(service, files, A, 'v * K', 4)).toBe(`const K = 2 (${INT})`);
  });
});

describe('a constant another file declares (Rule 3.9)', () => {
  const files = {
    [LIB]: `"use typeshade";
export const K = 7;
export function scale(x: f32): f32 { return x * K; }
`,
    [A]: `"use typeshade";
import { K, K as KK, scale } from "./lib.shade.ts";
export function t(vi: u32, x: f32): f32 {
  return f32(vi * K) + scale(x) * KK;
}`,
  };
  const service = accepted(files);

  it('reads each read in the importing file at the type that program gave it', () => {
    expect(compiled(files, A).wgsl).toContain('(vi * 7u)');
    expect(hoverLine(service, files, A, 'vi * K', 5)).toBe('const K: u32');
    // The name this document writes for it (the owner's decision of 2026-11-10).
    expect(hoverLine(service, files, A, '* KK', 2)).toBe('const KK: f32');
    expect(hoverLine(service, files, A, '{ K', 2)).toBe(`const K = 7 (${INT})`);
  });

  it('names the declaration in its own file, where only its importers make it an integer', () => {
    // The declaring file is analysed as `compile()` of it compiles it: nothing there decides.
    expect(hoverLine(service, files, LIB, 'K = 7')).toBe(`const K = 7 (${INT})`);
    expect(hoverLine(service, files, LIB, 'x * K', 4)).toBe('const K: f32');
  });
});

describe('a value whose "/" is refused (decision Q6)', () => {
  it('hovers the type inference gave it, and both halves give the one sentence at the "/"', () => {
    const files = {
      [A]: `"use typeshade";
function h(a: u32): u32 { return a; }
export function t(x: f32): f32 {
  let k = 7;
  h(k);
  return x + f32(k / 2);
}`,
    };
    const service = opened(files);
    const sentence =
      'TS8003: "k" is a u32 where another line reads it, and no operand of "k / 2" has a ' +
      'declared type, so the "/" does not say which division it is. Write "f32(k) / 2" for ' +
      'the float division.';
    const result = compiled(files, A);
    expect(result.diagnostics.map((d) => `${String(d.code)}: ${d.message}`)).toEqual([sentence]);
    expect(editor(service, A)).toEqual([sentence]);
    expect(hoverLine(service, files, A, 'let k', 4)).toBe('let k: u32');
  });
});

describe('a read the front end folds to the type where it stands (review of #1260)', () => {
  it('names a loop step at the counter type it is folded to', () => {
    const files = {
      [A]: `"use typeshade";
const K = 2;
export function t(vi: u32, ii: i32): f32 {
  let s = 0.0;
  for (let i = 0; i < ii; i += K) { s += 1.0; }
  for (let j = vi; j < 100; j += K) { s += 1.0; }
  return s;
}`,
    };
    const service = accepted(files);
    const wgsl = compiled(files, A).wgsl!;
    expect(wgsl).toContain('i += 2)');
    expect(hoverLine(service, files, A, 'i += K', 5)).toBe('const K: i32');
    expect(wgsl).toContain('j += 2u)');
    expect(hoverLine(service, files, A, 'j += K', 5)).toBe('const K: u32');
  });

  it('names a switch label at the type of its selector', () => {
    const files = {
      [A]: `"use typeshade";
const K = 3;
export function t(vi: u32, ii: i32): f32 {
  let x = 0.0;
  switch (vi) { case K: { x = 1.0; break; } default: { break; } }
  switch (ii) { case K: { x = 2.0; break; } default: { break; } }
  return x;
}`,
    };
    const service = accepted(files);
    const wgsl = compiled(files, A).wgsl!;
    expect(wgsl).toContain('case 3u:');
    expect(hoverLine(service, files, A, 'case K', 5, 'switch (vi)')).toBe('const K: u32');
    expect(wgsl).toMatch(/case 3:/);
    expect(hoverLine(service, files, A, 'case K', 5, 'switch (ii)')).toBe('const K: i32');
  });
});

describe('a generic instance a lookahead lowers first (review of #1260)', () => {
  // The bound of a counted `for` is read ahead of its counter's type, and that read is where the
  // program first calls `g` with a `u32`, so the `u32` instance is made and kept there.
  const generic = (body: string): Files => ({
    [A]: `"use typeshade";
const K = 3;
function g<T extends f32 | u32>(v: T): f32 { return f32(v * K); }
export function t(vi: u32, x: f32): f32 {
  ${body}
}`,
  });
  for (const [order, body] of [
    [
      'the bound first',
      'let s = 0.0;\n  for (let i = u32(0); i < u32(g(vi)); i++) { s += 1.0; }\n  return s + g(x);',
    ],
    [
      'the f32 call first',
      'let s = g(x);\n  for (let i = u32(0); i < u32(g(vi)); i++) { s += 1.0; }\n  return s;',
    ],
  ] as const) {
    it(`names the declaration where the two instances read it apart (${order})`, () => {
      const files = generic(body);
      const service = accepted(files);
      const wgsl = compiled(files, A).wgsl!;
      expect(wgsl).toContain('(v * 3u)');
      expect(wgsl).toContain('(v * K)');
      expect(hoverLine(service, files, A, 'v * K', 4)).toBe(`const K = 3 (${INT})`);
    });
  }
});

describe('a name an import gives the constant (review of #1260)', () => {
  it('marks the alias at the import, and names each read by the name the file writes', () => {
    const files = {
      [LIB]: `"use typeshade";
export const K = 4;
`,
      [A]: `"use typeshade";
import { K as Q } from "./lib.shade.ts";
export function t(vi: u32): u32 {
  return vi * Q;
}`,
    };
    const service = accepted(files);
    expect(compiled(files, A).wgsl).toContain('(vi * 4u)');
    expect(hoverLine(service, files, A, 'as Q', 3)).toBe(`(alias) const Q = 4 (${INT})`);
    expect(hoverLine(service, files, A, 'K as', 0)).toBe(`const K = 4 (${INT})`);
    expect(hoverLine(service, files, A, 'vi * Q', 5)).toBe('const Q: u32');
  });
});
