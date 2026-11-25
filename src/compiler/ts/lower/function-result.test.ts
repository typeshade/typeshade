import { describe, expect, it } from 'vitest';
import { bothHalves } from '../../../core/testing/both-halves.js';
import { uninlined } from '../../../core/testing/keep-helpers.js';

const program = (head: string, value: string, before = ''): string =>
  `"use typeshade"\n${head}\n@fragment export function fs(): vec4 { ${before} return vec4(${value}, 0., 0., 1.); }\n`;

const read = (source: string) => uninlined(() => bothHalves(source));

const wgslOf = (source: string): string => {
  const h = read(source);
  expect(h.compiler).toEqual([]);
  expect(h.editor).toEqual([]);
  return h.result.wgsl ?? '';
};

const cycle = (path: string): string =>
  `typeshade TS8031: Recursive call: ${path}. WGSL has no call stack, so a function must not take part in a call cycle.`;

const bothSayExactly = (source: string, lines: readonly string[]): void => {
  const h = read(source);
  expect(h.compiler).toEqual(lines);
  expect(h.editor).toEqual(lines);
};

describe('a return type the body says (Rule 8.19)', () => {
  it('is known to a call before the callee has had its turn', () => {
    const wgsl = wgslOf(
      program(
        `function twice(x: f32) { return a(x) * 2. }
function a(x: f32) { return x + 1. }`,
        'twice(1.)',
      ),
    );
    expect(wgsl).toContain('fn twice(x: f32) -> f32 {');
    expect(wgsl).toContain('fn a(x: f32) -> f32 {');
    expect(wgsl.indexOf('fn a(')).toBeLessThan(wgsl.indexOf('fn twice('));
  });

  it('is the body of a local function a call needs first', () => {
    const wgsl = wgslOf(
      program(
        `function bump(x: f32) { return x + 1. }`,
        'f(1.)',
        'const f = (x: f32) => bump(x) * 2.;',
      ),
    );
    expect(wgsl).toContain('fn fs_f(x: f32) -> f32 {');
    expect(wgsl).toContain('fn bump(x: f32) -> f32 {');
  });

  it('is nothing for an arrow whose value is an assignment or a call of a void function', () => {
    const wgsl = wgslOf(
      program(
        `let a = 0.
function bump() { a += 1. }
const inc = () => a += 1.
const quiet = () => bump()
const val = (x: f32) => x * 2.`,
        'val(2.)',
        'inc(); quiet();',
      ),
    );
    expect(wgsl).toContain('fn inc() {');
    expect(wgsl).toContain('fn quiet() {');
    expect(wgsl).toContain('fn val(x: f32) -> f32 {');
  });

  it('cannot be waited on by a default, which is lowered before any body', () => {
    bothSayExactly(
      program(
        `function f(a: f32, b: f32 = g()): f32 { return a + b }
function g() { return 1. }`,
        'f(1.)',
      ),
      [
        'typeshade TS8020: "g" says what it returns in its body, and a default is lowered before any body: write the return type on "g" (Rule 8.19).',
      ],
    );
  });

  it('is T | undefined when a path returns undefined, falls through, or returns a value', () => {
    const wgsl = wgslOf(
      program(
        `function early(x: f32) { if (x > 0.) { return 1. } return undefined }
function open(x: f32) { if (x > 0.) { return 1. } }`,
        '(early(1.) ?? 0.) + (open(1.) ?? 0.)',
      ),
    );
    expect(wgsl).toContain('fn early_into(_dst: ptr<function, _opt_f32_>, x: f32) {');
    expect(wgsl).toContain('fn open_into(_dst: ptr<function, _opt_f32_>, x: f32) {');
    expect(wgsl.match(/\(\*_dst\) = _opt_f32_\(0\.0, false\);/g)).toHaveLength(2);
  });

  it('is refused when every path returns undefined and nothing says what T is', () => {
    const source = program('function pos(x: f32) { return undefined }', 'pos(1.) ?? 0.');
    const sentence =
      'typeshade TS8021: "pos" returns undefined and no value, so nothing says what its result is: write a result type, ": T | undefined", or return a value on another path (Rule 8.19).';
    bothSayExactly(source, [sentence]);
  });

  it('is said once when the body did not lower, and its callers hear nothing more', () => {
    const source = program('function f() { const x: Nope = 1.; return x }', 'f()');
    bothSayExactly(source, [
      'typeshade TS8002: Unknown type "Nope". Declare it in this file, or import it from another shader module.',
    ]);
  });

  it('is the getter of a setter whose value writes no type', () => {
    const wgsl = wgslOf(
      program(
        `class C {
  n: f32 = 1.
  get v() { return this.n * 2. }
  set v(x) { this.n = x }
}`,
        'c.v',
        'const c = new C(); c.v = 3.;',
      ),
    );
    expect(wgsl).toContain('fn C_set_v(self_: ptr<function, C>, x: f32) {');
    expect(wgsl).toContain('fn C_get_v(self_: ptr<function, C>) -> f32 {');
  });

  it('is refused at the declaration of a setter that has no getter', () => {
    const source = program(
      `class C { n: f32 = 1.; set v(x) { this.n = x } }`,
      'c.n',
      'const c = new C(); c.v = 3.;',
    );
    const sentence =
      'typeshade TS8002: The setter "C.v" needs a type for "x": write "set v(x: T)".';
    const h = read(source);
    expect(h.compiler).toEqual([sentence]);
    expect(h.editor).toContain(sentence);
  });
});

describe('a setter beside a getter that returns nothing', () => {
  it('has no type for its value, said at the declaration', () => {
    const sentence =
      'typeshade TS8002: The getter "C.v" returns nothing, so the setter has no type for "x": write "set v(x: T)".';
    const h = read(
      program(
        'class C { n: f32 = 1.; get v() { this.n = 2. } set v(x) { this.n = 1. } }',
        'c.n',
        'const c = new C();',
      ),
    );
    expect(h.compiler).toEqual([sentence]);
    expect(h.editor).toContain(sentence);
  });
});

describe('a call cycle', () => {
  it('through plain functions is named once at the call that closes it', () => {
    bothSayExactly(
      program(
        `function f(n: f32) { return g(n) }
function g(n: f32) { return f(n) }`,
        'f(1.)',
      ),
      [cycle('"f" -> "g" -> "f"')],
    );
  });

  it('through methods, which no identifier call names, is named by the lowered calls', () => {
    bothSayExactly(
      program(
        `class C {
  n: f32 = 1.
  ping(k: f32) { return this.pong(k) }
  pong(k: f32) { return this.ping(k) }
}`,
        'new C().ping(1.)',
      ),
      [cycle('"C.ping" -> "C.pong" -> "C.ping"')],
    );
  });

  it('through getters is named too', () => {
    bothSayExactly(
      program(
        `class C {
  n: f32 = 1.
  get v() { return this.w }
  get w() { return this.v }
}`,
        'new C().v',
      ),
      [cycle('"C.v" -> "C.w" -> "C.v"')],
    );
  });

  it('through a function that waits on its own return type is said once', () => {
    bothSayExactly(
      program(
        `function f(x: f32) { return g(x) }
function g(x: f32) { return x > 0. ? f(x - 1.) : 1. }`,
        'f(1.)',
      ),
      [cycle('"f" -> "g" -> "f"')],
    );
  });
});

describe('a function that says it returns nothing', () => {
  it('is refused on each return that carries a value, at that return', () => {
    const source = `"use typeshade";
function h(x: f32): void {
  if (x > 1.) { return 1.; }
  return 2.;
}
@fragment export function fs(): vec4 { h(1.); return vec4(0.); }
`;
    const h = read(source);
    const lines = h.result.diagnostics.map((d) => d.line);
    expect(h.compiler).toHaveLength(2);
    expect(new Set(lines).size).toBe(2);
    expect(h.editor.filter((l) => l.includes('TS8003'))).toHaveLength(2);
  });

  it('is refused for a bare void return of a value in a stub that infers nothing', () => {
    const h = read(
      program('function h(x: f32): void { return x }', 'h(1.)').replace(
        'vec4(h(1.), 0., 0., 1.)',
        'vec4(0.)',
      ),
    );
    expect(h.compiler).toHaveLength(1);
    expect(h.compiler[0]).toContain('Function "h" returns void but returns a value of type f32');
    expect(h.editor).toEqual(h.compiler);
  });
});
