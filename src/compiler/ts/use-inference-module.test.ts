// A module variable, a field and a function's result take their type from their uses (change
// 0134 items 1 and 4, part 4b; Rules 5.1, 8.14 and 8.19, surface §14, §24 and §26;
// `docs/owner-decisions.md` OD-7).
//
// Each case reads BOTH halves on one source (Rule 12.7): `compile()` (its diagnostics with code
// and text, the WGSL, the value on the CPU oracle) and the language service (`getDiagnostics`,
// and `getHover`, since the inferred type is the point).
//
// Verifies: Rule 5.1 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.14 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.19 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const service = (source: string) => {
  const s = createTypeshadeLanguageService();
  s.openDocument('a.shade.ts', source);
  return s;
};
const editor = (source: string): string[] =>
  service(source)
    .getDiagnostics('a.shade.ts')
    .map((d) => `${String(d.code)}: ${String(d.message)}`);
/** The first line of the editor's hover at `offset` characters into the first `needle`. */
const hover = (source: string, needle: string, offset = 0): string => {
  const s = service(source);
  const at = source.indexOf(needle) + offset;
  expect(source.indexOf(needle)).toBeGreaterThanOrEqual(0);
  const contents = String(s.getHover('a.shade.ts', s.positionAt('a.shade.ts', at))?.contents);
  return contents.split('\n')[1] ?? contents;
};

const src = (body: string): string => `"use typeshade";
function h(a: u32): u32 { return a; }
function hi(a: i32): i32 { return a; }
${body}`;

/** Both halves accept `source`; returns the compile. */
const accepted = (source: string) => {
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  expect(editor(source)).toEqual([]);
  return result;
};

/** Both halves report exactly `messages`, each a `TS8003`. */
const refused = (source: string, messages: readonly string[]) => {
  const result = compile(source);
  expect(result.diagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual(
    messages.map((m) => `TS8003: ${m}`),
  );
  expect(result.wgsl).toBeUndefined();
  expect(editor(source)).toEqual(messages.map((m) => `TS8003: ${m}`));
};

const division = (subject: string, written: string, edit: string, kind = 'float') =>
  `"${subject}" is a u32 where another line reads it, and no operand of "${written}" has a ` +
  `declared type, so the "${written.includes('/=') ? '/=' : '/'}" does not say which division ` +
  `it is. Write "${edit}" for the ${kind} division.`;

describe('a module variable (surface §24)', () => {
  it('let n = 0 with n += vi is a u32 (refused before)', () => {
    const source = src(`let n = 0;
export function t(vi: u32): u32 { n += vi; n += vi; return n; }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('var<private> n: u32 = 0u;');
    expect(hover(source, 'let n', 4)).toBe('let n: u32');
    expect(result.eval('t', [5])).toBe(10);
  });

  it('one whose uses decide nothing stays an f32', () => {
    const source = src(`let n = 0;
export function t(x: f32): f32 { n += x; return n; }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('var<private> n: f32 = 0.0;');
    expect(hover(source, 'let n', 4)).toBe('let n: f32');
    expect(result.eval('t', [0.5])).toBe(0.5);
  });

  it('uses that require i32 and u32 are refused at the declaration', () => {
    refused(
      src(`let n = 0;
export function t(vi: u32, ii: i32): u32 { h(n); hi(n); return vi; }`),
      // The uses stay refused beside the declaration, as for a function's `let` on `main`.
      [
        'Cannot infer "n": its uses require i32 and u32. Write an explicit type annotation on ' +
          '"n" and cast the uses that need another type.',
        'Argument 1 of "h" type mismatch.',
        'Argument 1 of "hi" type mismatch.',
      ],
    );
  });

  it('a / over it is refused, with the edit that compiles (decisions Q6 and Q11)', () => {
    refused(
      src(`let n = 7;
export function t(x: f32): f32 { h(n); return f32(n / 2); }`),
      [division('n', 'n / 2', 'f32(n) / 2')],
    );
    refused(
      src(`let n = 7;
export function t(x: f32): f32 { h(n); n /= 2; return f32(n); }`),
      [division('n', 'n /= 2', 'let n: u32 = 7', 'integer')],
    );
  });

  it('a static field that code writes is such a variable (Rule 8.13)', () => {
    const source = src(`class S { static n = 0; static add(v: u32): void { S.n += v; } }
export function t(vi: u32): u32 { S.add(vi); S.add(vi); return S.n; }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('var<private> S_n: u32 = 0u;');
    expect(hover(source, 'static n', 7)).toBe('(property) S.n: u32');
    expect(result.eval('t', [5])).toBe(10);
    refused(
      src(`class S { static n = 7; static add(v: u32): void { S.n += v; } }
export function t(x: f32): f32 { S.add(1); h(S.n); return f32(S.n / 2); }`),
      [division('n', 'S.n / 2', 'f32(S.n) / 2')],
    );
  });
});

describe('a class field (Rule 8.14, surface §26)', () => {
  it('m = 0 with this.m += v is a u32 (refused before)', () => {
    const source = src(`class C { m = 0; bump(v: u32): u32 { this.m += v; return this.m; } }
export function t(vi: u32): u32 { const c = new C(); c.bump(vi); return c.bump(vi); }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('m: u32,');
    expect(hover(source, 'm = 0')).toBe('(property) C.m: u32');
    expect(hover(source, 'this.m', 5)).toBe('(property) C.m: u32');
    expect(result.eval('t', [5])).toBe(10);
  });

  it('one whose uses decide nothing stays an f32', () => {
    const source = src(`class C { m = 0; bump(v: f32): f32 { this.m += v; return this.m; } }
export function t(x: f32): f32 { const c = new C(); return c.bump(x); }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('m: f32,');
    expect(hover(source, 'm = 0')).toBe('(property) C.m: f32');
    expect(result.eval('t', [0.5])).toBe(0.5);
  });

  it('a / or a /= over it is refused, in both halves', () => {
    refused(
      src(`class C { n = 7; }
export function t(x: f32): f32 { const c = new C(); h(c.n); return f32(c.n / 2); }`),
      [division('n', 'c.n / 2', 'f32(c.n) / 2')],
    );
    refused(
      src(`class C { n = 7; m(): void { this.n /= 2; } }
export function t(x: f32): f32 { const c = new C(); h(c.n); c.m(); return f32(c.n); }`),
      [division('n', 'this.n /= 2', 'n: u32 = 7', 'integer')],
    );
  });
});

describe("a function's result its callers decide (Rule 8.19, surface §14)", () => {
  it('callers that ask one type give the function that type (refused before)', () => {
    const source = src(`function g() { return 1; }
export function t(vi: u32): u32 { return vi + g(); }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('fn g() -> u32 {');
    expect(hover(source, 'function g', 9)).toBe('function g(): u32');
    expect(hover(source, 'vi + g', 5)).toBe('function g(): u32');
    expect(result.eval('t', [5])).toBe(6);
  });

  it('callers that ask two types get a copy each, and each copy infers its own locals (A1)', () => {
    const source = src(`function g() { let k = 0; k += 1; return k; }
export function a(v: u32): u32 { return v + g(); }
export function b(x: f32): f32 { return x * g(); }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('fn g() -> f32 {\n  var k: f32 = 0.0;');
    expect(result.wgsl).toContain('fn g_u32() -> u32 {\n  var k: u32 = 0u;');
    expect(result.wgsl).toContain('return (v + g_u32());');
    expect(result.wgsl).toContain('return (x * g());');
    expect(result.glsl?.vertex).toContain('uint g_u32() {');
    expect(hover(source, 'function g', 9)).toBe('function g() (u32 or f32 where it is called)');
    expect(hover(source, 'v + g', 4)).toBe('function g(): u32');
    expect(hover(source, 'x * g', 4)).toBe('function g(): f32');
    expect(hover(source, 'let k', 4)).toBe('let k (u32 or f32 where "g" is called)');
    expect(hover(source, 'k += 1')).toBe('let k (u32 or f32 where "g" is called)');
    expect(result.eval('a', [3])).toBe(4);
    expect(result.eval('b', [2.5])).toBe(2.5);
  });

  it('a call in a copy decides its own callee, so a chain is copied too', () => {
    const source = src(`function g() { return 7; }
function f() { return g(); }
export function t(vi: u32, x: f32): f32 { return f32(vi + f()) + x * f(); }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('fn f_u32() -> u32 {\n  return g_u32();');
    expect(result.wgsl).toContain('fn f() -> f32 {\n  return g();');
    expect(hover(source, 'function f', 9)).toBe('function f() (u32 or f32 where it is called)');
    expect(result.eval('t', [1, 2])).toBe(22);
  });

  it('a result no caller decides stays an f32, also past 2^24 (decision Q5, F19)', () => {
    const source = src(`function g() { return 16777217; }
export function t(): u32 { return u32(g()); }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('fn g() -> f32 {');
    expect(hover(source, 'function g', 9)).toBe('function g(): f32');
    // The `f32` result rounds on a device; the `'f64'` precision oracle reads the written
    // double, as on `main` (record of change 0134, part 3, M5).
    expect(result.wgsl).toContain('return 16777217.0;');
    expect(result.eval('t', [])).toBe(16777217);
    const host = src(`export function g() { return 3; }`);
    expect(accepted(host).wgsl).toContain('fn g() -> f32 {');
    expect(hover(host, 'function g', 9)).toBe('function g(): f32');
  });

  it('an exported function keeps the f32 the host reads beside its copies', () => {
    const source = src(`export function g() { return 3; }
export function t(vi: u32, ii: i32): i32 { return i32(vi + g()) + ii * g(); }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('fn g() -> f32 {');
    expect(result.wgsl).toContain('fn g_u32() -> u32 {');
    expect(result.wgsl).toContain('fn g_i32() -> i32 {');
    expect(hover(source, 'function g', 9)).toBe(
      'function g() (i32, u32 or f32 where it is called)',
    );
    expect(result.eval('t', [1, 2])).toBe(10);
  });

  it('a / over its call is refused where an integer result reaches it (decision Q11)', () => {
    refused(
      src(`function g() { return 7; }
export function t(x: f32): f32 { h(g()); const q = g() / 2; return f32(q); }`),
      [division('g()', 'g() / 2', 'f32(g()) / 2')],
    );
    // A declared operand keeps the integer division, as `vi / 7` does.
    const kept = src(`function g() { return 7; }
export function t(vi: u32): u32 { h(g()); return vi / g(); }`);
    expect(accepted(kept).eval('t', [15])).toBe(2);
  });
});
