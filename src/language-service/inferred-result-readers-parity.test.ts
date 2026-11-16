// The editor and the compiler read a function with no written result type alike, in every reader
// that asks whether the author wrote one (Rule 12.7).
//
// The language service writes the result type the front end inferred into the text it analyses
// (`: u32` after the parameter list), and marks it as not the author's (change 0134,
// `hasNoWrittenResult`). A reader that tests the TypeScript `type` node sees a written type where
// the author wrote none, and only the editor half then differs. #1293 fixed two such readers
// (`inferred-result-parity.test.ts`); issue #1295 asked for the rest. Each row reads both halves
// on the same source. A row that agreed before the fix stays as a neighbour.
//
// Readers that were checked and agree on every probe, so they stay as they are: a lambda handed
// as an argument (`function-args.ts`, whose projected type is the one the callee's parameter
// names), an entry's `fillReady` flag and `recordInferredReturn` (`function.ts`), the struct an
// entry's object literal names (`structs.ts`), and an arrow function's expression body that runs
// as a statement (`structs.ts`). The rows for them are neighbours below.

import { describe, expect, it } from 'vitest';
import { createTypeshadeLanguageService } from './service.js';
import { compile } from '../compiler/ts/compile.js';

const both = (source: string) => {
  const compiler = compile(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code}: ${d.message}`);
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  const editorSide = service
    .getDiagnostics('a.ts')
    .filter((d) => d.severity === 'error')
    .map((d) => `TS${String(d.code).replace(/^TS/, '')}: ${d.message}`);
  return { compiler, editorSide, service };
};

/** Both halves give one list of errors, and it matches `expected` (empty: both accept). */
const agree = (source: string, expected: RegExp | undefined): void => {
  const { compiler, editorSide } = both(source);
  if (expected === undefined) expect(compiler).toEqual([]);
  else expect(compiler.join('\n')).toMatch(expected);
  expect(editorSide).toEqual(compiler);
};

const RECURSIVE = /^TS8031: Recursive call: "[\w.]+" -> "[\w.]+"\./;

describe('a method with no written result type (class-methods.ts)', () => {
  it('the probe of #1295: both halves accept it and read the result as u32', () => {
    const source = `"use typeshade";
class C { m(a: u32) { return a / 2; } }
export function t(x: u32): u32 { return new C().m(x); }
`;
    agree(source, undefined);
    expect(compile(source).wgsl).toMatch(/fn C_m\([^)]*\) -> u32/);
    const { service } = both(source);
    expect(service.getHover('a.ts', { line: 1, character: 11 })?.contents).toContain('): u32');
  });

  // A recursive method with no written result is one mistake, TS8031. The editor read the
  // written-in `: f32` as the author's, so the recursion passed as a typed one and a second
  // mistake appeared on the caller: "declared u32, got f32".
  it('a recursive method is the one TS8031 on both halves', () => {
    agree(
      `"use typeshade";
class C { m(n: u32) { if (n > 0) { return this.m(n - 1) + 1; } return 0; } }
export function t(vi: u32): u32 { return new C().m(vi); }
`,
      RECURSIVE,
    );
  });

  it('the neighbour function with the same body gives the same on both halves', () => {
    agree(
      `"use typeshade";
function g(n: u32) { if (n > 0) { return g(n - 1) + 1; } return 0; }
export function t(vi: u32): u32 { return g(vi); }
`,
      RECURSIVE,
    );
  });

  it('a static method and a method whose result a caller types: both halves accept', () => {
    agree(
      `"use typeshade";
class C { static m() { return 5 * 2; } n() { return 5 * 2; } }
export function t(vi: u32): u32 { const a: u32 = C.m(); const b: u32 = new C().n(); return a + b + vi; }
`,
      undefined,
    );
  });
});

describe('a getter with no written result type (class-methods.ts, local-numeric-inference.ts)', () => {
  it('a recursive getter is the one TS8031 on both halves', () => {
    agree(
      `"use typeshade";
class C { v: u32 = 1; get m() { if (this.v > 0) { return this.m + 1; } return 0; } }
export function t(vi: u32): u32 { return new C().m; }
`,
      RECURSIVE,
    );
  });

  // The local inference read the getter's `type` node, so the written-in `: i32` fixed the local
  // early in the editor (the same as #1280 for a call).
  it('a local read from a getter and from a u32 gives one diagnostic list', () => {
    agree(
      `"use typeshade";
class C { get m() { return abs(~(1|2)); } }
export function t(vi: u32): u32 {
  let a = 7;
  a = new C().m;
  a /= vi;
  return u32(a);
}
`,
      /Cannot infer "a"/,
    );
  });

  it('the neighbour method gives the same on both halves', () => {
    agree(
      `"use typeshade";
class C { m() { return abs(~(1|2)); } }
export function t(vi: u32): u32 {
  let a = 7;
  a = new C().m();
  a /= vi;
  return u32(a);
}
`,
      /Cannot infer "a"/,
    );
  });

  it('a getter beside a setter, and a getter a caller reads: both halves accept', () => {
    agree(
      `"use typeshade";
class C { v: u32 = 1; get p() { return this.v * 2; } set p(x) { this.v = x; } }
export function t(vi: u32): u32 { const c = new C(); c.p = vi; return c.p; }
`,
      undefined,
    );
    agree(
      `"use typeshade";
class C { get m() { return 5 * 2; } }
export function t(vi: u32): u32 { const c = new C(); const a: u32 = c.m; return a + vi; }
`,
      undefined,
    );
  });
});

describe('a callee with no written result type under a class upcast (class-upcasts.ts)', () => {
  // The write `q.x = 5` goes to a vector, which no class owns. With no written result type the
  // callee names no type, so the receiver is unknown and the upcast is refused (`compile()`'s
  // reading of the author's text); the editor read the written-in `: vec2` and accepted it.
  const program = (callee: string, write: string): string => `"use typeshade";
class B { x: f32 = 1; get() { return this.x * 2; } }
class D extends B { w: f32 = 2; }
${callee}
function use(b: B): f32 { return b.get(); }
export function t(a: f32): f32 {
  const d = new D();
  let q = g();
  ${write}
  return use(d) + q.x;
}
`;

  it('refuses the upcast on both halves for a callee that writes no result type', () => {
    for (const write of ['q.x += 5;', 'q.x = 5;']) {
      agree(program('function g() { return vec2(1, 2) * 2; }', write), /"D" extends "B"/);
    }
  });

  it('the neighbour whose callee writes `: vec2` is read as written on both halves', () => {
    agree(program('function g(): vec2 { return vec2(1, 2) * 2; }', 'q.x = 5;'), undefined);
  });

  it('a callee that returns the derived class: both halves accept the same upcast', () => {
    agree(
      `"use typeshade";
class B { v: u32 = 1; get() { return this.v * 2; } }
class D extends B { w: u32 = 2; }
function mk() { return new D(); }
function use(b: B): u32 { return b.get(); }
export function t(x: u32): u32 { const d = mk(); return use(d); }
`,
      undefined,
    );
  });
});

describe('an exported function with no written result type (statement.ts)', () => {
  // A value with two readings (TS8003) is refused at the `return` of an exported function that
  // writes no result type. A function with another return that types it had the written-in
  // `: u32` and no refusal in the editor.
  const REFUSAL = /is 3000000000 on its u32 bits and -1294967296 in TypeScript/;

  it('refuses a returned value with two readings on both halves', () => {
    for (const body of [
      'if (vi > 0) { return vi * 2; } return (3000000000|0);',
      'if (vi > 0) { return (3000000000|0); } return vi * 2;',
      'return (3000000000|0);',
    ]) {
      agree(`"use typeshade";\nexport function t(vi: u32) { ${body} }\n`, REFUSAL);
    }
  });

  it('the edit the refusal names compiles on both halves', () => {
    agree(
      `"use typeshade";
export function t(vi: u32) { if (vi > 0) { return vi * 2; } return u32(3000000000|0); }
`,
      undefined,
    );
  });

  it('the neighbour with a written `: u32` is read as written: both halves accept it', () => {
    agree(
      `"use typeshade";
export function t(vi: u32): u32 { if (vi > 0) { return vi * 2; } return (3000000000|0); }
`,
      undefined,
    );
  });
});

describe('an entry with no written result type (function.ts, change 0136)', () => {
  // A compute entry returns nothing. The editor read the written-in `: u32` as the author's, so
  // the settling of an inferred entry result never ran and TS8021 was missing.
  it('refuses a compute entry that returns a value on both halves', () => {
    agree(
      `"use typeshade";
@compute([8]) export function cs(id: builtin<"global_invocation_id">) { return id.x * 2; }
`,
      /a compute entry returns nothing/,
    );
  });

  it('the neighbours that return nothing, or return a position, agree', () => {
    agree(
      `"use typeshade";
@compute([8]) export function cs(id: builtin<"global_invocation_id">) { }
`,
      undefined,
    );
    agree(
      `"use typeshade";
@vertex export function vs(vi: builtin<"vertex_index">) { return vec4(f32(vi) * 2); }
`,
      undefined,
    );
  });

  it('a vertex entry with no position is refused once on both halves', () => {
    agree(
      `"use typeshade";
@vertex export function vs(vi: builtin<"vertex_index">) { return vec2(f32(vi)) * 2; }
`,
      /is a vertex entry, so it returns the position/,
    );
    agree(
      `"use typeshade";
interface V { uv: vec2 }
@vertex export function vs(vi: builtin<"vertex_index">) { return { uv: vec2(f32(vi)) * 2 }; }
`,
      /has to carry the position/,
    );
  });

  it('a fragment entry that returns a struct literal, a scalar or a vector: both accept', () => {
    agree(
      `"use typeshade";
interface Color { color: vec4; n: f32 }
@fragment export function fs(p: builtin<"position">) { return { color: p * 2, n: 1 }; }
`,
      undefined,
    );
    agree(
      `"use typeshade";
@fragment export function fs(p: builtin<"position">) { return p.x * 2; }
`,
      undefined,
    );
  });

  it('a literal that matches two structs is refused on both halves', () => {
    agree(
      `"use typeshade";
interface P { color: vec4; n: f32 }
interface Q { color: vec4; n: f32 }
@fragment export function fs(p: builtin<"position">) { return { color: p * 2, n: 1 }; }
`,
      /matches "P" and "Q" alike/,
    );
  });
});

describe('a function written as an argument (function-args.ts, structs.ts)', () => {
  it('a lambda for a parameter that takes u32, u32 | undefined or vec2: both accept', () => {
    agree(
      `"use typeshade";
function apply(f: (a: u32) => u32, x: u32): u32 { return f(x); }
export function t(x: u32): u32 { return apply((a) => a / 2, x); }
`,
      undefined,
    );
    agree(
      `"use typeshade";
function each(f: (a: u32) => u32 | undefined, x: u32): u32 { const r = f(x); return r ?? 0; }
export function t(x: u32): u32 { return each((a) => a * 2, x); }
`,
      undefined,
    );
    agree(
      `"use typeshade";
function each(f: (a: vec2) => vec2, x: vec2): vec2 { return f(x); }
export function t(x: vec2): vec2 { return each((a) => a * 2, x); }
`,
      undefined,
    );
  });

  it('a lambda whose result the parameter does not take is refused alike', () => {
    agree(
      `"use typeshade";
function each(f: (a: u32) => f32, x: u32): f32 { return f(x); }
export function t(x: u32): f32 { return each((a) => i32(a) * 2, x); }
`,
      /returns f32 where its calls use it and i32 at a "return"/,
    );
  });

  it('an arrow function whose body is an assignment runs as a statement on both halves', () => {
    agree(
      `"use typeshade";
export function t(x: u32): u32 { let c: u32 = 0; const f = (a: u32) => c = a * 2; f(x); return c; }
`,
      undefined,
    );
  });
});
