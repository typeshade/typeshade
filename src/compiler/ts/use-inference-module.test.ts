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

  it('an exported function keeps the f32 the host reads, also where its calls ask one type', () => {
    // The owner's decision of 2026-11-11, "export는 f32 유지" (Amendment A5).
    const source = src(`export function g() { return 3; }
export function t(vi: u32): u32 { return vi + g(); }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('fn g() -> f32 {');
    expect(result.wgsl).toContain('return (vi + g_u32());');
    expect(hover(source, 'function g', 9)).toBe('function g() (u32 or f32 where it is called)');
    expect(hover(source, 'vi + g', 5)).toBe('function g(): u32');
    expect(result.eval('g', [])).toBe(3);
    expect(result.eval('t', [1])).toBe(4);
  });

  it('a / over a call of a function with an integer copy is refused, whichever copy it takes', () => {
    // The owner's decision of 2026-11-11, "거부 유지": the `/` here would take the f32 copy that
    // `x * g()` makes, and its meaning must not depend on that other line (A2).
    refused(
      src(`function g() { return 7; }
export function t(vi: u32, x: f32): f32 { return f32(vi + g()) + f32(g() / 2) + x * g(); }`),
      [division('g()', 'g() / 2', 'f32(g()) / 2')],
    );
  });

  it('two functions of one short name decide apart (review finding 1)', () => {
    const source = src(`namespace N { export function g() { return 3; } }
function g() { return 4; }
export function t(vi: u32, x: f32): f32 { return f32(vi + g()) + x * N.g(); }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('fn g() -> u32 {');
    expect(result.wgsl).toContain('fn N_g() -> f32 {');
    expect(result.wgsl).not.toContain('_u32()');
    expect(result.eval('t', [1, 2])).toBe(11);
  });

  it('a result that two returns give two types says so without claiming a declaration', () => {
    refused(
      src(`function g(c: bool) { if (c) { return 3; } return 0.5; }
export function t(vi: u32): u32 { return vi + g(true); }`),
      [
        'Function "g" returns u32 where its calls use it and f32 at a "return"; a function ' +
          'returns one type (Rule 8.19): make them agree, or write the return type.',
      ],
    );
  });

  it('a chain of sixteen links is followed, one pass a link', () => {
    const links = Array.from({ length: 16 }, (_, i) =>
      i === 15 ? `function f16() { return 3; }` : `function f${i + 1}() { return f${i + 2}(); }`,
    ).join('\n');
    const result = accepted(
      src(`${links}
export function t(vi: u32): u32 { return vi + f1(); }`),
    );
    expect(result.eval('t', [1])).toBe(4);
  });
});

describe('every kind of function its callers decide (Amendment A5, "이 PR에서 모두 구현")', () => {
  it('a method and a getter', () => {
    const source = src(`class C { m() { let k = 0; k += 1; return k; } get g() { return 2; } }
export function t(vi: u32, x: f32): f32 {
  const c = new C();
  return f32(vi + c.m()) + x * c.m() + f32(vi + c.g) + x * c.g;
}`);
    const result = accepted(source);
    expect(result.wgsl).toContain(
      'fn C_m_u32(self_: ptr<function, C>) -> u32 {\n  var k: u32 = 0u;',
    );
    expect(result.wgsl).toContain('fn C_m(self_: ptr<function, C>) -> f32 {\n  var k: f32 = 0.0;');
    expect(hover(source, 'm() {')).toBe('(method) C.m() (u32 or f32 where it is called)');
    expect(hover(source, 'vi + c.m', 7)).toBe('(method) C.m(): u32');
    expect(hover(source, 'let k', 4)).toBe('let k (u32 or f32 where "C.m" is called)');
    expect(hover(source, 'get g', 4)).toBe('(getter) C.g (u32 or f32 where it is called)');
    expect(hover(source, 'vi + c.g', 7)).toBe('(getter) C.g: u32');
    expect(result.eval('t', [1, 2])).toBe(11);
  });

  it('a static function', () => {
    const source = src(`class C { static s() { return 3; } }
export function t(vi: u32): u32 { return vi + C.s(); }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('fn C_s() -> u32 {');
    expect(result.eval('t', [1])).toBe(4);
  });

  it('a local and an arrow function', () => {
    const source = src(`const f = () => 5;
export function t(vi: u32, x: f32): f32 {
  function h() { return 4; }
  return f32(vi + f()) + x * f() + f32(vi + h());
}`);
    const result = accepted(source);
    expect(result.wgsl).toContain('fn f_u32() -> u32 {');
    expect(result.wgsl).toContain('fn f() -> f32 {');
    expect(result.wgsl).toContain('fn t_h() -> u32 {');
    expect(hover(source, 'const f', 6)).toBe('const f: () => (u32 or f32 where it is called)');
    expect(hover(source, 'vi + f', 5)).toBe('const f: () => u32');
    expect(result.eval('t', [1, 2])).toBe(21);
  });

  it("a generic function's instance, with copies per instance (Rule 8.9)", () => {
    const source = src(`function id<T>(a: T) { return 3; }
export function t(vi: u32, x: f32, ii: i32): f32 {
  return f32(vi + id(x)) + x * id(x) + f32(ii + id(vi));
}`);
    const result = accepted(source);
    expect(result.wgsl).toContain('fn id_f32(a: f32) -> f32 {');
    expect(result.wgsl).toContain('fn id_f32_u32(a: f32) -> u32 {');
    expect(result.wgsl).toContain('fn id_u32(a: u32) -> i32 {');
    expect(result.eval('t', [1, 2, 3])).toBe(16);
  });

  it('a write to a static field records what it stores (review finding 2)', () => {
    for (const write of ['S.n += vi;', 'S.n = vi;']) {
      const source = src(`class S { static n = 0; }
export function t(vi: u32): f32 { ${write} return f32(S.n); }`);
      const result = accepted(source);
      expect(result.wgsl).toContain('var<private> S_n: u32 = 0u;');
      expect(result.eval('t', [5])).toBe(5);
    }
  });

  it("a copy has its own local functions, whose captures take the copy's types", () => {
    const source = src(`function g() { let k = 0; const inc = () => { k += 1; }; inc(); return k; }
export function t(vi: u32, x: f32): f32 { return f32(vi + g()) + x * g(); }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('fn g_u32_inc(k: ptr<function, u32>) {');
    expect(result.wgsl).toContain('fn g_inc(k: ptr<function, f32>) {');
    expect(result.eval('t', [1, 2])).toBe(4);
  });
});

describe('the second review of #1264 (fdf1364e)', () => {
  const chain = (n: number, tail: string, use: string): string => {
    const links = Array.from({ length: n }, (_, i) =>
      i === n - 1
        ? `function g${i}() { return ${tail}; }`
        : `function g${i}() { return g${i + 1}(); }`,
    ).join('\n');
    return src(
      `${links}\nfunction k() { return 7; }\nexport function t(vi: u32, x: f32): f32 { return ${use}; }`,
    );
  };

  it('a chain that asks only f32 uses up no pass, and leaves another function decided (1)', () => {
    for (const n of [10, 20]) {
      const result = accepted(chain(n, '3', 'x * g0() + f32(vi + k())'));
      expect(result.wgsl).toContain('fn k() -> u32 {');
      expect(result.eval('t', [2, 0.5])).toBe(10.5);
    }
  });

  it('the cap switches off only the links no call decided, and names the first of them (1, 6)', () => {
    const links = Array.from({ length: 17 }, (_, i) =>
      i === 16 ? `function g${i}() { return 3; }` : `function g${i}() { return g${i + 1}(); }`,
    ).join('\n');
    const source = src(`${links}
function k() { return 7; }
export function t(vi: u32): u32 { return vi + g0() + k(); }`);
    const message =
      'Function "g15" returns u32 where its calls use it and f32 at a "return"; a function ' +
      'returns one type (Rule 8.19): make them agree, or write the return type. "g16" returns ' +
      'the f32 the compiler chose: its result passes through more functions whose calls decide ' +
      'it than the compiler follows. Write its result type, for example "function g16(): u32".';
    refused(source, [message]);
  });

  it('an export clause keeps the f32 the host reads (2)', () => {
    for (const clause of ['export { g };', 'export { g as h };']) {
      const source = src(`function g() { return 3; }
export function t(vi: u32): u32 { return vi + g(); }
${clause}`);
      const result = accepted(source);
      expect(result.wgsl).toContain('fn g() -> f32 {');
      expect(result.wgsl).toContain('return (vi + g_u32());');
      expect(hover(source, 'function g', 9)).toBe('function g() (u32 or f32 where it is called)');
    }
  });

  it("a copy's local functions take a name no function of the module has (3)", () => {
    const source = src(`function g_u32_inc(a: u32): u32 { return a * 100; }
function g() { let b = 1; function inc() { return b + 1; } return inc(); }
export function t(vi: u32, x: f32): f32 { return f32(vi + g()) + x * g() + f32(g_u32_inc(vi)); }`);
    const result = accepted(source);
    expect(result.wgsl).toContain('fn g_u32_1() -> u32 {');
    expect(result.wgsl).toContain('fn g_u32_1_inc(');
    expect(result.eval('t', [2, 0.5])).toBe(205);
  });

  it('one call that decides a method, a getter, an arrow or a local hovers as that type (4)', () => {
    const cases: [string, string, string, string][] = [
      [
        'class C { m() { return 3; } }',
        'const c = new C(); return vi + c.m();',
        'm()',
        '(method) C.m(): u32',
      ],
      [
        'class C { get m() { return 3; } }',
        'const c = new C(); return vi + c.m;',
        'm()',
        '(getter) C.m: u32',
      ],
      ['const m = () => 3;', 'return vi + m();', 'm =', 'const m: () => u32'],
      ['', 'function m() { return 3; } return vi + m();', 'm()', '(local function) m(): u32'],
    ];
    for (const [head, body, at, line] of cases) {
      const source = src(`${head}
export function t(vi: u32): u32 { ${body} }`);
      const result = accepted(source);
      expect(result.wgsl).toMatch(/-> u32 \{\n\s+return 3u;/);
      expect(hover(source, at)).toBe(line);
      expect(hover(source, 'vi + ', 5 + (body.includes('c.m') ? 2 : 0))).toBe(line);
    }
    const generic = src(`function g<T>(a: T) { return 3; }
export function t(vi: u32, x: f32): f32 { return f32(vi + g<f32>(x)) + x * g<f32>(x); }`);
    accepted(generic);
    expect(hover(generic, 'vi + g', 5)).toBe('function g<f32>(a: f32): u32');
    expect(hover(generic, 'x * g', 4)).toBe('function g<f32>(a: f32): f32');
  });

  it('a captured variable that the copies cannot type apart is named, with the fix (5)', () => {
    for (const fn of ['function inc() { return base + 1; }', 'const inc = () => base + 1;']) {
      refused(
        src(
          `export function t(vi: u32, x: f32): f32 { let base = 2; ${fn} return f32(vi + inc()) + x * inc(); }`,
        ),
        [
          'Function "inc" returns f32 where its calls use it and u32 at a "return" that reads ' +
            '"base", a variable of the function around it: every copy of "inc" reads the one ' +
            '"base", which has one type (Rule 8.19). Write the type of "base", or the return ' +
            'type of "inc".',
        ],
      );
    }
  });

  it("a getter's refused / names the read as written (6)", () => {
    refused(
      src(`class C { get m() { return 7; } }
export function t(vi: u32): f32 { const c = new C(); return f32(vi + c.m) + c.m / 2; }`),
      [division('c.m', 'c.m / 2', 'f32(c.m) / 2')],
    );
  });
});

describe('the third review of #1264 (574b1dc1)', () => {
  const links = (n: number): string =>
    Array.from({ length: n }, (_, i) =>
      i === n - 1 ? `function g${i}() { return 3; }` : `function g${i}() { return g${i + 1}(); }`,
    ).join('\n');

  it("a generic instance's call shows its type arguments and parameter types (2)", () => {
    const two = src(`function m<T>(a: T) { return 3; }
export function t(vi: u32, x: f32): f32 { return f32(vi + m<f32>(x)) + x * m<f32>(x); }`);
    accepted(two);
    expect(hover(two, 'vi + m', 5)).toBe('function m<f32>(a: f32): u32');
    expect(hover(two, 'x * m', 4)).toBe('function m<f32>(a: f32): f32');
    const one = src(`function m<T>(a: T) { return 3; }
export function t(vi: u32, x: f32): u32 { return vi + m(x); }`);
    accepted(one);
    expect(hover(one, 'vi + m', 5)).toBe('function m(a: f32): u32');
  });

  it('the cap does not switch off a function whose calls asked only f32 (3)', () => {
    refused(
      src(`${links(17)}
function m() { return 3; }
function q() { return m(); }
export function t(vi: u32, x: f32): f32 { return f32(vi + g0()) + x * q() + f32(vi + m()); }`),
      [
        'Function "g15" returns u32 where its calls use it and f32 at a "return"; a function ' +
          'returns one type (Rule 8.19): make them agree, or write the return type. "g16" ' +
          'returns the f32 the compiler chose: its result passes through more functions whose ' +
          'calls decide it than the compiler follows. Write its result type, for example ' +
          '"function g16(): u32".',
      ],
    );
  });

  it('the passes are shared: a 16-link chain beside another inferred value compiles (4)', () => {
    const result = accepted(
      src(`${links(16)}
export function t(vi: u32): u32 { let a = 3; let b: u32 = a + vi; return vi + g0() + b; }`),
    );
    expect(result.eval('t', [1])).toBe(8);
  });

  it('a call inside a body another call fixed asks for its own copy (5)', () => {
    const one = src(`function m() { return 3; }
function q() { return m(); }
export function t(vi: u32, x: f32): f32 { return x * q() + f32(vi + m()); }`);
    const a = accepted(one);
    expect(a.wgsl).toContain('fn q() -> f32 {\n  return m();');
    expect(a.wgsl).toContain('return ((x * q()) + f32((vi + m_u32())));');
    expect(a.eval('t', [1, 2])).toBe(10);
    const other = src(`function m() { return 3; }
function q() { return m(); }
export function t(vi: u32, x: f32): f32 { return f32(vi + q()) + x * m(); }`);
    const b = accepted(other);
    expect(b.wgsl).toContain('fn q() -> u32 {\n  return m_u32();');
    expect(b.eval('t', [1, 2])).toBe(10);
  });
});

describe('the fourth review of #1264 (dbec4ba1)', () => {
  it('the f32 ask passes through every link that forwards a call (1)', () => {
    const two =
      src(`function m() { return 3; } function r() { return m(); } function q() { return r(); }
export function t(vi: u32, x: f32): f32 { return x * q() + f32(vi + m()); }`);
    const a = accepted(two);
    expect(a.wgsl).toContain('fn m() -> f32 {');
    expect(a.wgsl).toContain('fn r() -> f32 {');
    expect(a.wgsl).toContain('fn q() -> f32 {');
    expect(a.wgsl).toContain('fn m_u32() -> u32 {');
    expect(a.eval('t', [1, 2])).toBe(10);
    const middle =
      src(`function m() { return 3; } function r() { return m(); } function q() { return r(); }
export function t(vi: u32, x: f32): f32 { return x * q() + f32(vi + r()); }`);
    expect(accepted(middle).eval('t', [1, 2])).toBe(10);
    const three = src(`function m() { return 3; } function s() { return m(); }
function r() { return s(); } function q() { return r(); }
export function t(vi: u32, x: f32): f32 { return x * q() + f32(vi + s()); }`);
    const b = accepted(three);
    expect(b.wgsl).toContain('fn s_u32() -> u32 {');
    expect(b.eval('t', [1, 2])).toBe(10);
    const mixed =
      src(`function m() { return 3; } function r() { return m(); } function q() { return r(); }
export function t(vi: u32, k: i32, x: f32): f32 { return f32(vi + q()) + f32(k + r()) + x * m(); }`);
    const c = accepted(mixed);
    expect(c.wgsl).toContain('fn r_i32() -> i32 {');
    expect(c.wgsl).toContain('fn m_u32() -> u32 {');
    expect(c.eval('t', [1, 2, 2])).toBe(15);
  });

  it('a call of a function an imported file declares hovers as the copy it takes (2)', () => {
    const lib = '/p/b.shade.ts';
    const main = '/p/a.shade.ts';
    for (const [declares, name] of [
      ['export function g() { return 3; }', 'g'],
      ['function g() { return 3; }\nexport function k() { return g(); }', 'k'],
    ] as const) {
      const files: Record<string, string> = {
        [lib]: `"use typeshade";\n${declares}\n`,
        [main]: `"use typeshade";\nimport { ${name} } from './b.shade.ts';\nexport function t(vi: u32, x: f32): f32 { return f32(vi + ${name}()) + x * ${name}(); }\n`,
      };
      const result = compile(files[main]!, { fileName: main, readDocument: (n) => files[n] });
      expect(result.diagnostics).toEqual([]);
      expect(result.wgsl).toContain(`(vi + ${name}_u32())`);
      expect(result.eval('t', [1, 2])).toBe(10);
      const service = createTypeshadeLanguageService({ readDocument: (u) => files[u] });
      for (const [uri, text] of Object.entries(files)) service.openDocument(uri, text);
      expect(service.getDiagnostics(main)).toEqual([]);
      const at = (needle: string): string => {
        const offset = files[main]!.indexOf(needle) + needle.length;
        const contents = String(service.getHover(main, service.positionAt(main, offset))?.contents);
        return contents.split('\n')[1] ?? contents;
      };
      expect(at('vi + ')).toBe(`function ${name}(): u32`);
      expect(at('x * ')).toBe(`function ${name}(): f32`);
    }
  });
});
