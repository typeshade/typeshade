// Operators, switch and statements as WGSL spells them (§52, #160).
//
// The BLOCKER of the set is the shift: WGSL's only scalar overload is `e1 << e2` with
// `e2: u32`, so `x << n` with an i32 `n` emitted `(x << n)` — measured on Tint as
// `no matching overload for 'operator << (i32, i32)'` — while `x << 1u`, the one spelling it
// accepts, was refused by the front end's equal-types rule. The compound path (`y <<= n`) had
// always cast; the binary path had not.
//
// Measured on Chromium 141 (`chromium_headless_shell-1194`) for the two rows whose design
// turned on a real answer:
//   `fn f(a: f32) { a = 1.0; }`              REFUSED — `cannot assign to parameter 'a'`
//   `fn f(a: f32) { var a = a; a = 1.0; }`   REFUSED — `redeclaration of 'a'`
// so the whole-parameter write is refused with the one-line fix named, rather than shadowed:
// a WGSL function's parameters and its top-level locals share one scope, so the shadow the
// issue proposed cannot be spelled without renaming what the author wrote.
//
// Verifies: Rule 7.1, Rule 8.6 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

function compiled(source: string) {
  const c = compile(`"use typeshade"\n${source}`);
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c;
}

function diagnose(source: string): { code?: string; message: string } {
  const r = compileTsSource(`"use typeshade"\n${source}`);
  const first = r.diagnostics.find((d) => d.category === 'error');
  expect(first, 'expected a diagnostic, got none').toBeDefined();
  return { code: first!.code, message: first!.message };
}

/** The editor's diagnostics on the same source, as `[source, code, message]`. */
function editor(source: string): (string | number)[][] {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', `"use typeshade"\n${source}`);
  return service.getDiagnostics('a.ts').map((d) => [d.source, d.code, d.message]);
}

/** Both CPU engines, which have separate tables and only agree when both are right. */
function cpu(c: ReturnType<typeof compiled>, fn: string, args: readonly number[]): unknown[] {
  return [
    compileModule(c.module).fns[fn]!(...(args as never[])),
    compileModuleJs(c.module, { gpuStubs: true }).fns[fn]!(...(args as never[])),
  ];
}

describe('a shift amount is a u32 on both paths', () => {
  it('wraps an i32 shift count in u32 on WGSL and leaves GLSL alone', () => {
    const c = compiled(`export function f(x: i32, n: i32): i32 { return x << n }
@fragment export function fs(): vec4 { return vec4(f32(f(1, 3))) }`);
    expect(c.wgsl).toContain('(x << u32(n))');
    // The cast is in the IR, so GLSL carries it too, as `uint(n)` — which that spec accepts
    // (§5.9 lets the two operands of a shift have different kinds), and which is exactly what
    // the compound path has always emitted on both targets. The gate compiles it on ANGLE.
    expect(c.glsl!.fragment).toContain('(x << uint(n))');
  });

  it('accepts a u32 amount, which the equal-types rule used to refuse', () => {
    const c = compiled(`export function f(x: i32, n: u32): i32 { return x >> n }`);
    expect(c.wgsl).toContain('(x >> n)');
  });

  it('retypes a bare integer literal rather than wrapping it', () => {
    // `1 << 0` is how a bit flag is spelled, and an integer-WRITTEN literal still defaults to
    // f32 (roadmap item 25), so both sides needed retargeting before the kind check.
    const c = compiled(`export function f(x: u32): u32 { return x << 3 }`);
    expect(c.wgsl).toContain('(x << 3u)');
    expect(c.wgsl).not.toContain('u32(3');
  });

  it.each([
    ['a float amount', `export function f(x: i32, n: f32): i32 { return x << n }`],
    ['a float target', `export function f(x: f32, n: i32): f32 { return x << n }`],
  ])('refuses %s', (_what, source) => {
    expect(diagnose(source).code).toBe(TS_CODES.TYPE_MISMATCH);
  });

  it('keeps the 0..31 bound on the binary path (#71)', () => {
    expect(diagnose(`export function f(x: i32): i32 { return x << 32 }`).message).toContain(
      'must be between 0 and 31',
    );
  });

  it('shifts a vector lane-wise, the width WGSL requires', () => {
    // A shift is componentwise, so the kind check reads the ELEMENT: `vec2u << vec2u` is two
    // lanes, not a type error. WGSL's vector overload is `vecN<T> << vecN<u32>`, so a signed
    // amount takes the same conversion the scalar path gives it, one lane wider.
    const c = compiled(`export function f(x: vec2u, n: vec2u): vec2u { return x << n }
export function g(x: vec2i, n: vec2i): vec2i { return x << n }
@fragment export function fs(): vec4 {
  return vec4(f32(f(vec2u(1, 1), vec2u(1, 1)).x) + f32(g(vec2i(1, 1), vec2i(1, 1)).x))
}`);
    expect(c.wgsl).toContain('(x << n)');
    expect(c.wgsl).toContain('(x << vec2<u32>(n))');
    expect(c.glsl!.fragment).toContain('(x << n)');
    expect(c.glsl!.fragment).toContain('(x << uvec2(n))');
  });

  it('refuses a scalar amount on a vector target, which only GLSL takes', () => {
    // GLSL ES 3.00 §5.9 allows the scalar broadcast; WGSL has no such overload (Tint:
    // `no matching overload for 'operator << (vec2<u32>, u32)'`), so one source that compiles
    // on both has to splat it.
    const d = diagnose(`export function f(x: vec2u, n: u32): vec2u { return x << n }`);
    expect(d.code).toBe(TS_CODES.TYPE_MISMATCH);
    expect(d.message).toContain('vec2u(n)');
  });

  it('keeps the equality rule for & | ^', () => {
    expect(diagnose(`export function f(x: i32, y: u32): i32 { return x & y }`).message).toContain(
      'no implicit integer conversion',
    );
  });
});

describe('the unary operators WGSL has, and the one it does not', () => {
  it('lowers ~ and refuses unary minus on u32', () => {
    const c = compiled(`export function f(x: i32): i32 { return ~x }
export function g(x: u32): u32 { return ~x }`);
    expect(c.wgsl).toContain('return ~x;');
    // The same text on GLSL ES 3.00, which is why the INTRINSICS row exists at all: the
    // fall-through writes `name(args)`, and `~x` is not that shape on either target.
    expect(c.glsl!.fragment).toContain('return ~x;');
    // The complement is the bit pattern, so the two integer kinds read it differently — and
    // both CPU engines route it by the static kind, as they do for the other bit builtins.
    expect(cpu(c, 'f', [5])).toEqual([-6, -6]);
    expect(cpu(c, 'g', [5])).toEqual([4294967290, 4294967290]);

    const d = diagnose(`export function f(u: u32): u32 { return -u }`);
    expect(d.code).toBe(TS_CODES.TYPE_MISMATCH);
    expect(d.message).toBe(
      'Unary "-" is not defined on u32; WGSL has no negation for an unsigned integer. ' +
        'Write 0u - x to wrap, or i32(x) to change kind first.',
    );
  });

  it('takes unary + as the identity it is', () => {
    const c = compiled(`export function f(x: f32): f32 { return +x }`);
    expect(c.wgsl).toContain('return x;');
    expect(c.wgsl).not.toContain('+x');
  });

  it('refuses ~ on a float and + on a bool', () => {
    expect(diagnose(`export function f(x: f32): f32 { return ~x }`).message).toContain(
      'requires an i32 or u32 operand',
    );
    expect(diagnose(`export function f(b: bool): bool { return +b }`).message).toContain(
      'requires a numeric operand',
    );
  });
});

describe('a switch clause may carry several selectors', () => {
  const SRC = `export function pick(k: i32): i32 {
  switch (k) {
    case 0:
    case 1: return 10
    case 2: return 20
    default: return 99
  }
}
@fragment export function fs(): vec4 { return vec4(f32(pick(1))) }`;

  it('shares a switch clause between selectors on both targets', () => {
    const c = compiled(SRC);
    // WGSL joins the selectors into one label list; GLSL ES 3.00 has no such list and stacks
    // empty labels, which its own spec allows ("Fall through labels are allowed").
    expect(c.wgsl).toContain('case 0, 1: {');
    expect(c.glsl!.fragment).toContain('case 0: case 1: {');
    const sw = c.module.funcs.find((f) => f.name === 'pick')!.body.find((s) => s.s === 'switch')!;
    expect(sw.s === 'switch' && sw.cases.map((x) => x.values)).toEqual([[0, 1], [2]]);
  });

  it('runs the shared body for every selector on both CPU engines', () => {
    const c = compiled(SRC);
    for (const [k, want] of [
      [0, 10],
      [1, 10],
      [2, 20],
      [3, 99],
    ] as const) {
      expect(cpu(c, 'pick', [k]), `pick(${String(k)})`).toEqual([want, want]);
    }
  });

  it("refuses an empty selector that would share the default's body", () => {
    const d = diagnose(`export function f(k: i32): i32 {
  switch (k) { case 0: return 1; case 2: default: return 0 }
}`);
    expect(d.code).toBe(TS_CODES.SWITCH_CASE);
    expect(d.message).toContain('sits above "default:"');
  });

  it('refuses an empty "default:" that a clause follows', () => {
    // The mirror image, and the same silent miscompile the other way: TypeScript falls the
    // empty default through into the clause below, both targets run nothing, and the emit
    // used to be `default: { }` with no diagnostic.
    const d = diagnose(`export function f(k: i32): i32 {
  switch (k) { case 1: return 1; default: case 2: return 0 }
}`);
    expect(d.code).toBe(TS_CODES.SWITCH_CASE);
    expect(d.message).toContain('has no body of its own and a clause follows it');
    // An empty default as the LAST clause runs nothing in either language, so it stays legal.
    expect(
      compiled(`export function f(k: i32): i32 {
  switch (k) { case 1: return 1; default: }
  return 9
}`).wgsl,
    ).toContain('default: {');
  });

  it('refuses a trailing selector with no body at all', () => {
    const d = diagnose(`export function f(k: i32): i32 {
  switch (k) { default: return 0; case 2: }
}`);
    expect(d.code).toBe(TS_CODES.SWITCH_CASE);
  });
});

describe('the statements that now say what is wrong', () => {
  it('shadows nothing and refuses a written parameter, naming the line to add', () => {
    const d = diagnose(`export function f(a: f32): f32 { a = 1.; return a }`);
    expect(d.code).toBe(TS_CODES.ASSIGN_TARGET);
    expect(d.message).toBe(
      'Cannot assign to "a" — a parameter is a value, not a variable. Copy it into a local ' +
        'first: "let a_ = a;", then write that.',
    );
    // …and the fix the message names does compile.
    expect(
      compiled(`export function f(a: f32): f32 { let a_ = a; a_ = 1.; return a_ }`).wgsl,
    ).toContain('var a_: f32 = a;');
  });

  it('refuses calling an entry point', () => {
    const d = diagnose(`@fragment export function fs(): vec4 { return vec4(0.) }
export function g(): vec4 { return fs() }`);
    expect(d.message).toBe(
      '"fs" is a fragment entry point and cannot be called; the pipeline invokes it. ' +
        'Move the body into a plain function and call that from both.',
    );
  });

  it('takes _ = f() as the phony assignment it is', () => {
    const c = compiled(`export function g(x: f32): f32 { return x }
@fragment export function fs(): vec4 { _ = g(1.); return vec4(0.) }`);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    // `g` is pure and its result is dropped, so the optimizer removes the call outright —
    // what `_ =` buys the author is that the LINE is accepted, not text in the emit.
    expect(c.wgsl).not.toContain('g(1.0)');
    // A callee that writes survives, and then the emit is the bare call: WGSL takes a user
    // function's dropped result without the phony assignment, which `emit.ts` reserves for a
    // `@must_use` builtin (issue #47).
    const live = compiled(`declare const dst: storage<array<f32>, "read_write">
export function g(x: f32): f32 { dst[0] = x; return x }
@compute([64, 1, 1]) export function cs() { _ = g(1.); }`);
    expect(live.wgsl).toContain('  g(1.0);');
    expect(live.wgsl).not.toContain('_ = g(1.0);');
    // A program cannot declare its own `_` any more: #103's reserved-name rule refuses it,
    // because `_` is WGSL's phony target and not an identifier, so there is no second meaning
    // for `_ =` to have.
    expect(diagnose(`export function f(): f32 { let _ = 0.; _ = 1.; return _ }`).message).toContain(
      '"_" is WGSL\'s phony assignment target',
    );
    expect(diagnose(`export function f(): f32 { _ = 1.; return 0. }`).message).toContain(
      'is not one, so there is nothing to drop',
    );
  });

  it('refuses a literal no f32 can hold', () => {
    const d = diagnose(`export function f(): f32 { return 1e40 }`);
    expect(d.code).toBe(TS_CODES.TYPE_MISMATCH);
    expect(d.message).toContain('outside the range of f32');
    // The largest finite f32 is not — the writer spells it in its own exponent form.
    expect(compiled(`export function f(): f32 { return 3.4e38 }`).wgsl).toContain('3.4e+38');
  });

  it('refuses ++ on a parameter, the same way a whole write is refused', () => {
    // `lowerUpdate` builds its own target rather than going through `lowerLValue`, so this
    // emitted `a = (a + 1);` — `cannot assign to parameter 'a'` on Tint — with no diagnostic.
    for (const src of [
      'export function f(a: i32): i32 { a++; return a }',
      'export function f(a: i32): i32 { ++a; return a }',
      'export function f(a: i32): i32 { a--; return a }',
      'export function f(a: i32): i32 { for (let i = 0; i < 3; a += 1) {} return a }',
    ]) {
      const d = diagnose(src);
      expect(d.code, src).toBe(TS_CODES.ASSIGN_TARGET);
      expect(d.message, src).toContain('a parameter is a value, not a variable');
    }
    // A local counter is untouched.
    expect(compiled('export function f(): i32 { let i: i32 = 0; i++; return i }').wgsl).toContain(
      'i = (i + 1);',
    );
  });

  it.each([
    [
      'do…while',
      `export function f(): f32 { let a = 0.; let i = 0; do { a = a + 1.; i = i + 1 } while (i < 3); return a }`,
      /the IR has one loop shape, a top-tested "for"/,
    ],
    [
      'a labelled statement',
      `export function f(): f32 { let a = 0.; outer: for (let i = 0; i < 3; i++) { break outer } return a }`,
      /neither WGSL nor GLSL ES 3\.00 has a label/,
    ],
  ])('refuses %s with its own reason, not the catch-all', (_what, source, match) => {
    expect(diagnose(source).message).toMatch(match);
  });
});

// Rule 7.1: the lowering checked that two operands have ONE type and stopped there, so two
// operands of one type and of a kind WGSL has no such operator for reached Tint. Each row below
// compiled on main with no diagnostic and was measured as Tint's `no matching overload`
// (`operator + (A, A)`, `operator < (bool, bool)`, `operator & (A, A)`, `operator ==
// (mat3x3<f32>, mat3x3<f32>)`, `operator - (DF64Mat3)`, `operator += (DF64Mat3, DF64Mat3)`,
// `operator + (texture_2d<f32>, texture_2d<f32>)`), or, for `+`/`-` and `&` on a matrix of
// doubles, as a span-less `TS8015` from the fp64 pass. Now each is one `TS8003` on the line,
// naming the operator and the type as written, and the editor shows that one sentence alone:
// TypeScript's TS2365, TS2362, TS2363 or TS2447 on the same operator, and the TS2322 its
// `number` result draws, give way to it (Rule 12.4). A float under `& | ^` is `lowerBinary`'s
// own refusal, pinned in `ts-syntax.test.ts`.
describe('an operator takes the kinds of operand WGSL gives it (Rule 7.1)', () => {
  const A = 'class A { x: f32 = 0; }\n';
  it.each([
    [
      '+ on two class instances',
      `${A}export function k(a: A, b: A): A { return a + b }`,
      'Cannot + A: WGSL has no arithmetic on a struct. Write it field by field.',
    ],
    [
      // Two `new A()` with one set of fields are one value (the optimizer folds them into one
      // `_cse0`), so TypeScript's question, the same object?, has no answer here either.
      '=== on two built instances',
      `${A}export function k(): bool { const a = new A(); const b = new A(); return a === b }`,
      'Cannot === A: a struct is a value with no identity here, and WGSL compares scalars ' +
        'and vectors only. Compare its fields one by one.',
    ],
    [
      '< on two class instances',
      `${A}export function k(a: A, b: A): bool { return a < b }`,
      'Cannot < A: WGSL orders numbers and vectors of numbers, not a struct. Compare one of ' +
        'its fields.',
    ],
    [
      '+ on two arrays',
      'export function k(a: array<f32, 3>): array<f32, 3> { return a + a }',
      'Cannot + array<f32, 3>: WGSL has no arithmetic on an array. Write it element by element.',
    ],
    [
      '!== on two arrays',
      'export function k(a: array<f32, 3>, b: array<f32, 3>): bool { return a !== b }',
      'Cannot !== array<f32, 3>: WGSL compares scalars and vectors, not an array. Compare it ' +
        'element by element.',
    ],
    [
      '< on two bools',
      'export function k(a: bool, b: bool): bool { return a < b }',
      'Cannot < bool: a bool has no order in WGSL. Compare it with === or !==.',
    ],
    [
      '* on two bools',
      'export function k(a: bool, b: bool): bool { return a * b }',
      'Cannot * bool: WGSL has no arithmetic on a bool. Convert it to a number first, e.g. u32(a).',
    ],
    [
      '+ on two vectors of bools',
      'export function k(a: vec3b, b: vec3b): vec3b { return a + b }',
      'Cannot + vec3b: WGSL has no arithmetic on a vector of bools. Convert it to numbers ' +
        'first, e.g. vec3u(a).',
    ],
    [
      '- on a vector of bools and the bool it broadcasts',
      'export function k(a: vec2b, b: bool): vec2b { return a - b }',
      'Cannot - vec2b: WGSL has no arithmetic on a vector of bools. Convert it to numbers ' +
        'first, e.g. vec2u(a).',
    ],
    [
      '^ on two bools',
      'export function k(a: bool, b: bool): bool { return a ^ b }',
      "Cannot ^ bool: WGSL's ^ takes integers, not a bool. Write a !== b, which is the same.",
    ],
    [
      '& on two class instances',
      `${A}export function k(a: A, b: A): A { return a & b }`,
      "Cannot & A: WGSL's & takes integers and bools, not a struct.",
    ],
    [
      '| on two matrices',
      'export function k(m: mat3, n: mat3): mat3 { return m | n }',
      "Cannot | mat3x3: WGSL's | takes integers and bools, not a matrix.",
    ],
    [
      '^ on two arrays',
      'export function k(a: array<f32, 2>, b: array<f32, 2>): array<f32, 2> { return a ^ b }',
      "Cannot ^ array<f32, 2>: WGSL's ^ takes integers, not an array.",
    ],
    [
      '^ on two vectors of bools',
      'export function k(a: vec3b, b: vec3b): vec3b { return a ^ b }',
      "Cannot ^ vec3b: WGSL's ^ takes integers, not a vector of bools. Write a !== b, which is " +
        'the same.',
    ],
    [
      '& on two matrices of doubles',
      'export function k(m: mat3<f64>, n: mat3<f64>): mat3<f64> { return m & n }',
      "Cannot & mat3x3<f64>: WGSL's & takes integers and bools, not a matrix.",
    ],
    [
      '< on two arrays',
      'export function k(a: array<f32, 2>, b: array<f32, 2>): bool { return a < b }',
      'Cannot < array<f32, 2>: WGSL orders numbers and vectors of numbers, not an array. ' +
        'Compare one of its elements.',
    ],
    [
      '=== on two matrices',
      'export function k(m: mat3, n: mat3): bool { return m === n }',
      'Cannot === mat3x3: WGSL compares scalars and vectors, not a matrix. Compare it column ' +
        'by column, all(m[0] === n[0]).',
    ],
    [
      '=== on two matrices of doubles, whose columns cannot be indexed',
      'export function k(m: mat3<f64>, n: mat3<f64>): bool { return m === n }',
      'Cannot === mat3x3<f64>: WGSL compares scalars and vectors, not a matrix.',
    ],
    [
      '< on two matrices',
      'export function k(m: mat2, n: mat2): bool { return m < n }',
      'Cannot < mat2x2: WGSL orders numbers and vectors of numbers, not a matrix.',
    ],
    [
      '- on two matrices of doubles',
      'export function k(m: mat3<f64>): mat3<f64> { return m - m }',
      'Cannot - mat3x3<f64>: the fp64 pass lowers only * and transpose on a matrix of ' +
        'doubles. Declare the matrix mat3x3 where you need -.',
    ],
    [
      '== on two samplers',
      'declare const s: sampler\n' +
        'export function k(): bool { return s === s }\n' +
        '@fragment export function fs(): vec4 { return vec4(select(0., 1., k())) }',
      'Cannot === sampler: WGSL compares scalars and vectors, not a texture or a sampler.',
    ],
    [
      '+ on two textures',
      'declare const t: texture_2d<f32>\n' +
        '@fragment export function fs(): vec4 { return textureLoad(t + t, vec2i(0), 0) }',
      'Cannot + texture_2d<f32>: WGSL has no arithmetic on a texture or a sampler.',
    ],
    [
      // Refused by type, as a local the optimizer would drop is: written into a read, it is
      // Tint's `no matching overload for 'operator * (sampler, sampler)'`.
      '* on two samplers',
      'declare const s: sampler\n' +
        'export function k(): f32 { const u = s * s; return 0. }\n' +
        '@fragment export function fs(): vec4 { return vec4(k()) }',
      'Cannot * sampler: WGSL has no arithmetic on a texture or a sampler.',
    ],
    [
      '< on two samplers',
      'declare const s: sampler\n' +
        'export function k(): bool { return s < s }\n' +
        '@fragment export function fs(): vec4 { return vec4(select(0., 1., k())) }',
      'Cannot < sampler: WGSL orders numbers and vectors of numbers, not a texture or a sampler.',
    ],
    [
      'unary - on a bool',
      'export function k(b: bool): bool { return -b }',
      'Unary "-" is not defined on bool; WGSL has no negation for a bool. Write !x for its ' +
        'logical not.',
    ],
    [
      'unary - on a vector of bools',
      'export function k(b: vec4b): vec4b { return -b }',
      'Unary "-" is not defined on vec4b; WGSL has no negation for a vector of bools. Write !x ' +
        'for its logical not.',
    ],
    [
      'unary - on a matrix',
      'export function k(m: mat3): mat3 { return -m }',
      'Unary "-" is not defined on mat3x3; WGSL has no negation for a matrix. Write x * -1. to ' +
        'negate each entry.',
    ],
    [
      'unary - on a matrix of doubles',
      'export function k(m: mat4<f64>): mat4<f64> { return -m }',
      'Unary "-" is not defined on mat4x4<f64>; WGSL has no negation for a matrix.',
    ],
    [
      'unary - on a texture',
      'declare const t: texture_2d<f32>\n' +
        'export function k(): f32 { const u = -t; return 0. }\n' +
        '@fragment export function fs(): vec4 { return vec4(k()) }',
      'Unary "-" is not defined on texture_2d<f32>; WGSL has no negation for a texture or a ' +
        'sampler.',
    ],
    [
      'unary - on a class instance',
      `${A}export function k(a: A): A { return -a }`,
      'Unary "-" is not defined on A; WGSL has no negation for a struct. Negate its fields one ' +
        'by one.',
    ],
    [
      'unary - on an array',
      'export function k(a: array<f32, 2>): array<f32, 2> { return -a }',
      'Unary "-" is not defined on array<f32, 2>; WGSL has no negation for an array. Negate its ' +
        'elements one by one.',
    ],
    [
      '+= on a class instance',
      `${A}export function k(b: A): A { let a = b; a += b; return a }`,
      'Cannot += A: WGSL has no arithmetic on a struct. Write it field by field.',
    ],
    [
      '+= on a struct field',
      `${A}class O { i: A = new A(); j: A = new A(); }
export function k(): f32 { let o = new O(); o.i += o.j; return o.i.x }`,
      'Cannot += A: WGSL has no arithmetic on a struct. Write it field by field.',
    ],
    [
      '*= on a bool',
      'export function k(a: bool, b: bool): bool { let c = a; c *= b; return c }',
      'Cannot *= bool: WGSL has no arithmetic on a bool. Convert it to a number first, e.g. ' +
        'u32(a).',
    ],
    [
      '-= on a vector of bools',
      'export function k(b: vec3b): vec3b { let a = b; a -= b; return a }',
      'Cannot -= vec3b: WGSL has no arithmetic on a vector of bools. Convert it to numbers ' +
        'first, e.g. vec3u(a).',
    ],
    [
      '+= on a matrix of doubles',
      'export function k(m: mat3<f64>): mat3<f64> { let p = m; p += m; return p }',
      'Cannot += mat3x3<f64>: the fp64 pass lowers only * and transpose on a matrix of ' +
        'doubles. Declare the matrix mat3x3 where you need +=.',
    ],
    [
      '*= on a matrix of doubles, whose product the pass has no compound form of',
      'export function k(m: mat3<f64>, n: mat3<f64>): mat3<f64> { let p = m; p *= n; return p }',
      'Cannot *= mat3x3<f64>: the fp64 pass lowers the product of two matrices of doubles and ' +
        'not its compound assignment. Write m = m * n.',
    ],
  ])('refuses %s, once, on the line', (_what, source, message) => {
    const r = compileTsSource(`"use typeshade"\n${source}`);
    expect(r.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [TS_CODES.TYPE_MISMATCH, message],
    ]);
    expect(editor(source)).toEqual([['typeshade', TS_CODES.TYPE_MISMATCH, message]]);
  });

  it('shows the editor one diagnostic for + on two class instances, where TypeScript had TS2365', () => {
    // TypeScript's `Operator '+' cannot be applied to types 'A' and 'A'` was the only
    // diagnostic before the compiler refused the operator; it gives way to the compiler's.
    expect(
      editor(
        `${A}export function k(): f32 { const a = new A(); const b = new A(); return (a + b).x }`,
      ),
    ).toEqual([
      [
        'typeshade',
        TS_CODES.TYPE_MISMATCH,
        'Cannot + A: WGSL has no arithmetic on a struct. Write it field by field.',
      ],
    ]);
  });

  it('keeps & | ^ on two whole numbers the front end folds, as bit flags', () => {
    // `const A = 1` is an f32 by Rule 5.1's default, and a module constant and a `case` label
    // fold `A | B` to the number (surface §12), so these reach neither target as an operator.
    const source = `const A = 1
const B = 2
const AB = A | B
const MASK = 1 | 4
const F: u32 = 1 | 2
const C = A ^ B
const M = 0xff ^ 0x0f
export function k(x: i32, u: u32): f32 {
  switch (x) {
    case 1 | 2: return f32(AB + MASK + C + M)
    case A & B: return 2.
    default: return f32(u & F)
  }
}`;
    const c = compiled(source);
    expect(c.wgsl).toContain('const AB: f32 = 3.0;');
    expect(c.wgsl).toContain('const F: u32 = 3u;');
    expect(c.wgsl).toContain('const M: f32 = 240.0;');
    expect(c.wgsl).toContain('case 3: {');
    expect(c.wgsl).toContain('case 0: {');
    expect(editor(source)).toEqual([]);
  });

  it('keeps every operator WGSL and the fp64 pass have, with the WGSL it had', () => {
    // `&` and `|` on a bool are WGSL's non-short-circuiting logical operators, and `===` takes
    // any scalar or vector; a matrix of doubles keeps its product.
    const c = compiled(`export function b(a: bool, c: bool): bool { return (a & c) | (a === c) }
export function v(a: vec3b, c: vec3b): vec3b { return (a & c) | (a !== c) }
export function n(x: vec3i, y: vec3i): vec3i { return (-x & y) ^ ~y }
export function m(p: mat3, q: mat3): mat3 { return p + q - p * q }
export function d(p: mat3<f64>, q: mat3<f64>, s: f64): f64 { const r = p * q; return -s }`);
    expect(c.wgsl).toContain('return ((a & c) | (a == c));');
    expect(c.wgsl).toContain('return ((a & c) | (a != c));');
    expect(c.wgsl).toContain('return (((-x) & y) ^ ~y);');
    expect(c.wgsl).toContain('return ((p + q) - (p * q));');
  });

  it('compiles every remedy the refusals name', () => {
    compiled(`${A}export function a(x: A, y: A): f32 { return x.x + y.x }
export function b(a: bool, c: bool): u32 { return u32(a) + u32(c) }
export function v(a: vec3b): vec3u { return vec3u(a) }
export function x(a: bool, c: bool): bool { return a !== c }
export function e(m: mat3, n: mat3): bool { return all(m[0] === n[0]) }
export function o(m: mat3): mat3 { return m * -1. }
export function p(m: mat3<f64>, n: mat3<f64>): mat3<f64> { let q = m; q = q * n; return q }`);
  });
});
