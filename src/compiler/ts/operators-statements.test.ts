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
// Verifies: Rule 8.6 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { TS_CODES } from './codes.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

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

describe('a case body does not fall through (Rule 7.3, #202)', () => {
  const FELL = (label: string): string =>
    `${label} falls through into the next case: TypeScript runs both bodies, and WGSL runs ` +
    `only this one. End it with "break", or repeat the shared statements in each case.`;

  /** Every error, as `line:character code message` over the source as written (line 1 is the
   *  directive `diagnose` and `compiled` prepend). */
  function errors(source: string): string[] {
    return compileTsSource(`"use typeshade"\n${source}`)
      .diagnostics.filter((d) => d.category === 'error')
      .map((d) => `${String(d.line)}:${String(d.character)} ${d.code ?? ''} ${d.message}`);
  }

  it('refuses a case that runs on into the next body, at its label', () => {
    // The issue's program: TypeScript gives k = 0 the value 3, and the emit, which has no
    // fall-through, gave 1 with no diagnostic.
    expect(
      errors(`export function f(k: i32): f32 {
  let x: f32 = 0.;
  switch (k) {
    case 0: x = 1.
    case 1: x += 2.; break
  }
  return x
}`),
    ).toEqual([`5:10 ${TS_CODES.SWITCH_CASE} ${FELL('switch case 0')}`]);
  });

  it('refuses a default above a case, and names the label as written', () => {
    expect(
      errors(`const MODE: i32 = 2
export function f(k: i32): f32 {
  let x: f32 = 0.;
  switch (k) {
    case MODE: x = 1.
    case 3:
    case 4: x = 2.; break
    default: x = 3.
    case 5: x = 4.
  }
  return x
}`),
    ).toEqual([
      `6:10 ${TS_CODES.SWITCH_CASE} ${FELL('switch case MODE')}`,
      `9:5 ${TS_CODES.SWITCH_CASE} ${FELL('"default:"')}`,
    ]);
  });

  it('refuses a body that leaves on one path only', () => {
    // An `if` with no `else` leaves only when its condition holds, and a `break` inside a loop
    // leaves the loop, not the switch: TypeScript's own reachability, which `tsc` applies with
    // `noFallthroughCasesInSwitch`.
    expect(
      errors(`export function f(k: i32, c: bool): f32 {
  let x: f32 = 0.;
  switch (k) {
    case 0:
      if (c) { break }
      x = 1.
    case 1:
      for (let i: i32 = 0; i < 3; i++) { x += 1.; break }
    case 2: x = 2.; break
  }
  return x
}`).map((e) => e.split(' ').slice(0, 2).join(' ')),
    ).toEqual([`5:10 ${TS_CODES.SWITCH_CASE}`, `8:10 ${TS_CODES.SWITCH_CASE}`]);
  });

  it('takes every way a case can end, and a last case with no break', () => {
    const c = compiled(`export function f(k: i32, flag: i32): f32 {
  let x: f32 = 0.;
  for (let i: i32 = 0; i < 2; i++) {
    switch (k) {
      case 0: x = 1.; break
      case 1: return 2.
      case 2: x += 1.; continue
      case 3: if (flag > 0) { x = 3.; break } else { return 4. }
      case 4: { x = 5.; break }
      case 5:
        for (let j: i32 = 0; j < 2; j++) { x += 1.; break }
        break
      default: x = 9.
    }
  }
  return x
}`);
    for (const [k, flag, want] of [
      [0, 1, 1],
      [1, 1, 2],
      [2, 1, 2],
      [3, 1, 3],
      [3, 0, 4],
      [4, 1, 5],
      [5, 1, 2],
      [8, 1, 9],
    ] as const) {
      expect(cpu(c, 'f', [k, flag]), `f(${String(k)}, ${String(flag)})`).toEqual([want, want]);
    }
  });

  it('takes a case that runs on only into empty clauses at the end, where TypeScript runs nothing more', () => {
    compiled(`export function f(k: i32): f32 {
  let x: f32 = 0.;
  switch (k) {
    case 0: x = 1.
    default:
  }
  return x
}`);
  });

  it('says one thing about a case above a trailing empty one (Rule 12.4)', () => {
    // The trailing `case 1:` is refused for having no body, and deleting it is the fix; the
    // case above it runs on into nothing, so it is not reported as well.
    const found = errors(`export function f(k: i32): f32 {
  let x: f32 = 0.;
  switch (k) {
    case 0: x = 1.
    case 1:
  }
  return x
}`);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain(`${TS_CODES.SWITCH_CASE} switch case 1 has no body`);
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
    const live = compiled(`declare let dst: storage<array<f32>>
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
