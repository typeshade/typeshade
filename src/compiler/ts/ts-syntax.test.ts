// The four TypeScript shapes the source language parsed but refused (#8 A10): a `let` that
// declares before it assigns, the five bitwise compound assignments, the `{ pos, uv }`
// shorthand, and a `switch` whose cases end in the `break` TypeScript requires. None of them
// needed a new IR node — `Stmt.var.init` has always been optional, `assignOp` has always
// taken a `BinOp`, `construct` does not care how a field was spelled, and `Stmt.switch` was
// already lowered — so each is checked on the IR, on both emitted texts, and on the CPU
// oracle, together with what each one still refuses. Beside the compound forms sits the float
// operand the binary `&`, `|` and `^` refuse, as the compound forms refuse a float target.

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compile, type CompileResult } from './compile.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { typeKey } from '../../core/ir/types.js';
import type { Stmt } from '../../core/ir/nodes.js';
import { stripSpans } from '../../core/testing/strip-spans.js';

function wgslOf(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`);
  expect(r.diagnostics).toEqual([]);
  return r.wgsl!;
}

function diagnose(source: string): string {
  const r = compileTsSource(`"use typeshade";\n${source}`);
  expect(r.diagnostics.length).toBeGreaterThan(0);
  return r.diagnostics[0]!.message;
}

function bodyOf(source: string): readonly Stmt[] {
  const r = compileTsSource(`"use typeshade";\n${source}`);
  expect(r.diagnostics).toEqual([]);
  return r.funcs[r.funcs.length - 1]!.body;
}

/** The generated-JS twin of `compile().eval`. `compile().eval` runs the INTERPRETER
 *  (`compileModule`), so an assertion through it alone leaves the codegen's own zero builder,
 *  `zeroLit`, unpinned: the two have separate zero tables and only a second assertion per case
 *  holds them together. `gpuStubs` matches what `evalEntry` passes the interpreter, so the two
 *  calls differ in nothing but the backend. */
function evalJs(c: CompileResult, name: string, args: readonly unknown[] = []): unknown {
  return compileModuleJs(c.module, { gpuStubs: true }).fns[name]!(...(args as never[]));
}

function compiled(source: string): CompileResult {
  const c = compile(source);
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c;
}

describe('a let that declares before it assigns', () => {
  it('lowers to a var with no init, and emits one in both targets', () => {
    const first = bodyOf(
      'export function f(): f32 {\n  let x: f32;\n  x = 1.;\n  return x;\n}',
    )[0]!;
    expect(first.s).toBe('var');
    if (first.s !== 'var') return;
    expect(first.name).toBe('x');
    expect(typeKey(first.type)).toBe('f32');
    expect(first.init).toBeUndefined();
    expect(
      wgslOf('export function f(): f32 {\n  let x: f32;\n  x = 1.;\n  return x;\n}'),
    ).toContain('var x: f32;');
  });

  it('takes an aggregate type as readily as a scalar', () => {
    expect(
      wgslOf(
        'export function f(): vec3 {\n  let v: vec3;\n  v = vec3(1., 2., 3.);\n  return v;\n}',
      ),
    ).toContain('var v: vec3<f32>;');
  });

  it('evaluates on the CPU once assigned', () => {
    const c = compile(`
      "use typeshade";
      export function f(a: f32): f32 {
        let x: f32;
        if (a > 0.) {
          x = a;
        } else {
          x = 0. - a;
        }
        return x;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.eval('f', [3])).toBe(3);
    expect(c.eval('f', [-3])).toBe(3);
  });

  it('is recorded for the editor, like any other local', () => {
    // #51 records every local so hover and go-to-definition can answer for it. The record sits
    // in the shared defineLocal, so the shape with NO initializer gets one too — a name the
    // language now accepts should not be invisible to the editor.
    const r = compileTsSource(
      '"use typeshade";\nexport function f(): f32 {\n  let x: f32;\n  x = 1.;\n  return x;\n}',
    );
    expect(r.diagnostics).toEqual([]);
    const x = r.symbols.filter((sym) => sym.name === 'x');
    expect(x).toHaveLength(1);
    expect(x[0]!.kind).toBe('local');
    expect(typeKey(x[0]!.type)).toBe('f32');
    expect(x[0]!.mutable).toBe(true);
  });

  it('still refuses the two forms that have nothing to declare', () => {
    // A `const` has no later assignment to carry the value, and an unannotated `let` has no
    // type to declare — two different refusals where there used to be one sentence.
    expect(diagnose('export function f(): f32 {\n  const x: f32;\n  return 1.;\n}')).toBe(
      '"const x" requires an initializer.',
    );
    expect(diagnose('export function f(): f32 {\n  let x;\n  return 1.;\n}')).toBe(
      '"let x" without an initializer needs a type annotation, e.g. let x: f32;',
    );
  });
});

describe('the bitwise compound assignments', () => {
  it('emit the operator the author wrote, in both targets', () => {
    const w = wgslOf(`
      export function f(i: i32): i32 {
        let y: i32 = i;
        y <<= 2;
        y |= 1;
        y &= 255;
        y ^= 3;
        y >>= 1;
        return y;
      }
    `);
    // A SHIFT amount is a u32 whatever the target is — WGSL's only scalar overload — so `2`
    // is spelled `2u` there while `&`, `|` and `^` take the target's own type.
    for (const line of ['y <<= 2u;', 'y |= 1;', 'y &= 255;', 'y ^= 3;', 'y >>= 1u;']) {
      expect(w).toContain(line);
    }
  });

  it('type the right-hand literal from the target, like the arithmetic five', () => {
    expect(
      wgslOf('export function f(i: u32): u32 {\n  let y: u32 = i;\n  y &= 3;\n  return y;\n}'),
    ).toContain('y &= 3u;');
  });

  it('takes a u32 shift amount on either target, and casts an i32 one', () => {
    // The rule the first version of this got wrong. `lowerBitwiseAssignOp` required the
    // operand type to equal the TARGET, so `y <<= k` with an i32 `k` on an i32 target emitted
    // `y <<= k;` — which Tint refuses, `no matching overload for 'operator <<= (i32, i32)'` —
    // while the one spelling WGSL accepts, a u32 amount, was rejected here. Every earlier test
    // used a literal, which survived only because a bare `2` reads as AbstractInt.
    expect(
      wgslOf(
        'export function f(i: i32, k: u32): i32 {\n  let y: i32 = i;\n  y <<= k;\n  return y;\n}',
      ),
    ).toContain('y <<= k;');
    expect(
      wgslOf(
        'export function f(i: i32, k: i32): i32 {\n  let y: i32 = i;\n  y <<= k;\n  return y;\n}',
      ),
    ).toContain('y <<= u32(k);');
    expect(
      wgslOf(
        'export function f(i: u32, k: i32): u32 {\n  let y: u32 = i;\n  y >>= k;\n  return y;\n}',
      ),
    ).toContain('y >>= u32(k);');
    // …and GLSL ES 3.00, which allows the mixed signedness that produces.
    const c = compile(`
      "use typeshade";
      class Color {
        @location(0) color: vec4;
      }
      @fragment
      export function fs(@builtin("position") p: vec4): Color {
        let y: i32 = i32(p.x);
        let k: i32 = i32(p.y);
        y <<= k;
        return { color: vec4(f32(y), 0., 0., 1.) };
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.glsl?.fragment).toContain('y <<= uint(k);');
    // A shift by a value is not a constant fold on either side: the oracle agrees with JS.
    const e = compile(`
      "use typeshade";
      export function f(i: i32, k: i32): i32 {
        let y: i32 = i;
        y <<= k;
        return y;
      }
    `);
    expect(e.eval('f', [3, 4])).toBe(3 << 4);
  });

  it('refuses a negative shift amount, and a negative value on a u32 target', () => {
    // `-1` is a prefix unary, not a literal node, so the retype never saw it and the author
    // was told their i32 target could not take an f32. Folded first now, which is also what
    // makes `y |= -2` work on an i32 target.
    expect(
      diagnose('export function f(i: i32): i32 {\n  let y: i32 = i;\n  y <<= -1;\n  return y;\n}'),
    ).toBe(
      'A shift amount must be between 0 and 31, got -1: a 32-bit integer has no bit to shift into.',
    );
    expect(
      diagnose('export function f(i: u32): u32 {\n  let y: u32 = i;\n  y |= -2;\n  return y;\n}'),
    ).toBe('Bitwise "|=" on a u32 target needs a non-negative value, got -2.');
    expect(
      wgslOf('export function f(i: i32): i32 {\n  let y: i32 = i;\n  y |= -2;\n  return y;\n}'),
    ).toContain('y |= -2;');
  });

  it('agree with the same expression written out long', () => {
    const c = compile(`
      "use typeshade";
      export function compound(i: i32): i32 {
        let y: i32 = i;
        y <<= 2;
        y |= 1;
        y &= 255;
        y ^= 3;
        y >>= 1;
        return y;
      }
      export function longhand(i: i32): i32 {
        let y: i32 = i;
        y = y << 2;
        y = y | 1;
        y = y & 255;
        y = y ^ 3;
        y = y >> 1;
        return y;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    for (const i of [0, 7, 13, -5]) {
      expect(c.eval('compound', [i])).toBe(c.eval('longhand', [i]));
      expect(c.eval('compound', [i])).toBe(((((i << 2) | 1) & 255) ^ 3) >> 1);
    }
  });

  it('refuse a float target, a float operand and the unsigned shift', () => {
    // The bitwise operators are defined on integers, and this whole form is new, so refusing
    // here rejects no source that compiles today.
    expect(
      diagnose('export function f(a: f32): f32 {\n  let y: f32 = a;\n  y <<= 1;\n  return y;\n}'),
    ).toBe('Bitwise "<<=" needs an i32 or u32 target, got f32.');
    expect(
      diagnose('export function f(i: i32): i32 {\n  let y: i32 = i;\n  y &= 1.5;\n  return y;\n}'),
    ).toContain('&=');
    expect(
      diagnose('export function f(i: i32): i32 {\n  let y: i32 = i;\n  y >>>= 1;\n  return y;\n}'),
    ).toBe('Unsigned right shift >>>= is not supported.');
  });

  it('refuse an f32 target for &=, |= and ^= as well as for a shift', () => {
    for (const op of ['&=', '|=', '^=']) {
      const r = compileTsSource(
        `"use typeshade";\nexport function f(a: f32): f32 {\n  let y: f32 = a;\n  y ${op} 1.;\n  return y;\n}`,
      );
      expect(r.diagnostics.map((d) => [d.code, d.message])).toEqual([
        ['TS8003', `Bitwise "${op}" needs an i32 or u32 target, got f32.`],
      ]);
    }
  });
});

describe('a float operand of & | ^', () => {
  // `&`, `|` and `^` have no float overload on either target (Rule 7.1), and the binary path
  // compared only the two operand types, so each program below compiled with no diagnostic.
  // Measured on main before this change, on SwiftShader through Chromium's WebGPU: Tint refused
  // the f32 pair (`no matching overload for 'operator & (f32, f32)'`) and the vec3 pair
  // (`'operator | (vec3<f32>, vec3<f32>)'`), and the two emulated doubles came back from the
  // fp64 pass as a span-less TS8015 (SD0041). Each is one TS8003 on the expression now, naming
  // the conversion to write (Rules 12.1, 12.5 and 12.6).
  function refusal(source: string): { code?: string; message: string; at: string } {
    const text = `"use typeshade";\n${source}`;
    const errors = compile(text).diagnostics.filter((d) => d.category === 'error');
    expect(errors).toHaveLength(1);
    const d = errors[0]!;
    return { code: d.code, message: d.message, at: text.slice(d.start, d.start + d.length) };
  }

  it('is refused on the expression, with the conversion for its kind', () => {
    expect(refusal('export function k(a: f32, b: f32): f32 {\n  return a & b;\n}')).toEqual({
      code: 'TS8003',
      message:
        'Bitwise "&" needs i32 or u32 operands, got f32. Convert first, e.g. u32(a) & u32(b), ' +
        'or reinterpret the bits with bitcast<u32>(a).',
      at: 'a & b',
    });
    expect(refusal('export function k(a: vec3, b: vec3): vec3 {\n  return a | b;\n}')).toEqual({
      code: 'TS8003',
      message:
        'Bitwise "|" needs i32 or u32 operands, got vec3<f32>. Convert first, e.g. ' +
        'vec3u(a) | vec3u(b).',
      at: 'a | b',
    });
    expect(refusal('export function k(a: f64, b: f64): f64 {\n  return a & b;\n}')).toEqual({
      code: 'TS8003',
      message:
        'Bitwise "&" needs i32 or u32 operands, got f64. Narrow and convert first, e.g. ' +
        'u32(f32(a)) & u32(f32(b)).',
      at: 'a & b',
    });
    expect(
      refusal('export function k(a: vec3f64, b: vec3f64): vec3f64 {\n  return a ^ b;\n}'),
    ).toEqual({
      code: 'TS8003',
      message:
        'Bitwise "^" needs i32 or u32 operands, got vec3<f64>. Narrow and convert first, e.g. ' +
        'vec3u(vec3(a)) ^ vec3u(vec3(b)).',
      at: 'a ^ b',
    });
  });

  it('is refused beside an integer too, where the mismatch said to cast into f32', () => {
    // The equal-types rule used to answer first, and its remedy for this pair begins with
    // f32(intVal): two floats, which the refusal above then turns away.
    expect(refusal('export function k(u: u32, a: f32): u32 {\n  return u & a;\n}')).toEqual({
      code: 'TS8003',
      message:
        'Bitwise "&" needs i32 or u32 operands, got f32. Convert first, e.g. u32(a) & u32(b), ' +
        'or reinterpret the bits with bitcast<u32>(a).',
      at: 'u & a',
    });
  });

  it('compiles once converted the way each sentence says', () => {
    const c = compiled(`
      "use typeshade";
      export function scalar(a: f32, b: f32): u32 {
        return u32(a) & u32(b);
      }
      export function bits(a: f32, b: f32): u32 {
        return bitcast<u32>(a) & bitcast<u32>(b);
      }
      export function lanes(a: vec3, b: vec3): vec3u {
        return vec3u(a) | vec3u(b);
      }
      export function double(a: f64, b: f64): u32 {
        return u32(f32(a)) & u32(f32(b));
      }
      export function doubleLanes(a: vec3f64, b: vec3f64): vec3u {
        return vec3u(vec3(a)) ^ vec3u(vec3(b));
      }
      export function control(a: u32, b: u32): u32 {
        return a & b;
      }
    `);
    for (const line of [
      'return (u32(a) & u32(b));',
      'return (bitcast<u32>(a) & bitcast<u32>(b));',
      'return (vec3<u32>(a) | vec3<u32>(b));',
      'return (u32(df64_narrow(a)) & u32(df64_narrow(b)));',
      'return (a & b);',
    ]) {
      expect(c.wgsl).toContain(line);
    }
    const bitsOf = (x: number): number => {
      const view = new DataView(new ArrayBuffer(4));
      view.setFloat32(0, x);
      return view.getUint32(0);
    };
    expect(c.eval('scalar', [6, 3])).toBe(6 & 3);
    expect(c.eval('bits', [1.5, 3])).toBe((bitsOf(1.5) & bitsOf(3)) >>> 0);
    expect(
      c.eval('lanes', [
        [1, 2, 3],
        [4, 4, 4],
      ]),
    ).toEqual([1 | 4, 2 | 4, 3 | 4]);
    expect(c.eval('double', [12, 10])).toBe(12 & 10);
    expect(
      c.eval('doubleLanes', [
        [1, 2, 3],
        [4, 4, 4],
      ]),
    ).toEqual([1 ^ 4, 2 ^ 4, 3 ^ 4]);
    expect(c.eval('control', [12, 10])).toBe(12 & 10);
  });

  it('is kept when it is two f32 whole numbers the front end folds', () => {
    // `1 | 2` is two f32s by Rule 5.1's default. A bit-flag enum is the form surface §12
    // documents, and a module constant and a `case` label fold the pair to the same number, so
    // all of this compiled before the refusal and compiles after it.
    const c = compiled(`
      "use typeshade";
      enum Flag {
        Lit = 1,
        Shadow = 2,
        Both = 1 | 2,
      }
      const MASK: u32 = 1 | 2;
      const A = 1;
      const B = 4;
      const AB = A | B;
      export function tier(s: i32): i32 {
        switch (s) {
          case 1 | 2:
            return 10;
          default:
            return 0;
        }
      }
      export function both(): i32 {
        return Flag.Both;
      }
      export function mask(): u32 {
        return MASK;
      }
      export function ab(): f32 {
        return AB;
      }
    `);
    for (const line of [
      'const Flag_Both: i32 = 3;',
      'const MASK: u32 = 3u;',
      'const AB: f32 = 5.0;',
      'case 3: {',
    ]) {
      expect(c.wgsl).toContain(line);
    }
    expect(c.eval('tier', [3])).toBe(10);
    expect(c.eval('tier', [1])).toBe(0);
    expect(c.eval('both')).toBe(3);
    expect(c.eval('mask')).toBe(3);
    expect(c.eval('ab')).toBe(5);
    // A number that is not whole has no bits to combine, so it is refused like any float.
    expect(refusal('const M = 1.5 | 2;\nexport function k(): f32 {\n  return 1.;\n}')).toEqual({
      code: 'TS8003',
      message:
        'Bitwise "|" needs i32 or u32 operands, got f32. Convert first, e.g. u32(a) | u32(b), ' +
        'or reinterpret the bits with bitcast<u32>(a).',
      at: '1.5 | 2',
    });
  });
});

describe('the object-literal shorthand', () => {
  const SHORT = `
    class P {
      a: f32
      b: f32
    }
    export function f(a: f32, b: f32): P {
      return { a, b };
    }
  `;
  const LONG = `
    class P {
      a: f32
      b: f32
    }
    export function f(a: f32, b: f32): P {
      return { a: a, b: b };
    }
  `;

  it('builds exactly what the long form builds', () => {
    // Spans stripped: the two spellings ARE two spellings, so `return { a, b }` and
    // `return { a: a, b: b }` carry different source extents (#32). The claim is that the IR
    // is the same, which is what stripSpans lets the comparison say.
    expect(stripSpans(bodyOf(SHORT))).toEqual(stripSpans(bodyOf(LONG)));
    expect(wgslOf(SHORT)).toBe(wgslOf(LONG));
    expect(wgslOf(SHORT)).toContain('return P(a, b);');
  });

  it('mixes with named properties in one literal', () => {
    expect(
      wgslOf(`
        class P {
          a: f32
          b: f32
        }
        export function f(a: f32): P {
          return { a, b: 2. };
        }
      `),
    ).toContain('return P(a, 2.0);');
  });

  it('still reports an unknown name, from the shorthand position', () => {
    // The whole message, not `.toContain('b')`: that also matched the refusal this form
    // replaced ("Object literals must use identifier fields, e.g. { pos: vec4(...) }"), so
    // the assertion passed on the merge base, where the shorthand did not lower at all.
    expect(
      diagnose(`
        class P {
          a: f32
          b: f32
        }
        export function f(a: f32): P {
          return { a, b };
        }
      `),
    ).toBe('Unknown identifier "b".');
  });

  it('refuses a destructuring default, which is not a field value', () => {
    // `{ a = 1. }` parses as a shorthand with an objectAssignmentInitializer — legal only in
    // a destructuring pattern. Nothing read that field, so the `= 1.` vanished and `a` was
    // used as the value.
    expect(
      diagnose(`
        class P {
          a: f32
          b: f32
        }
        export function f(a: f32, b: f32): P {
          return { a = 1., b };
        }
      `),
    ).toBe('"a = ..." is a destructuring default, not a field value. Write "a: ..." instead.');
  });
});

describe('switch, with the break TypeScript requires', () => {
  const SWITCHED = `
    export function f(x: i32): f32 {
      let r: f32 = 0.;
      switch (x) {
        case 0: r = 1.; break;
        case 1: r = 2.; break;
        default: r = 3.;
      }
      return r;
    }
  `;

  it('accepts the trailing break and leaves it out of the IR', () => {
    // The IR switch does not fall through and each backend writes its own case terminator,
    // so a trailing break carries nothing; keeping it would emit `break; break;` in GLSL.
    const body = bodyOf(SWITCHED);
    const sw = body.find((s) => s.s === 'switch')!;
    expect(sw.s).toBe('switch');
    if (sw.s !== 'switch') return;
    expect(sw.cases.map((c) => c.values)).toEqual([[0], [1]]);
    for (const c of sw.cases) expect(c.body.some((s) => s.s === 'break')).toBe(false);
  });

  it('keeps a break that leaves the case early', () => {
    const body = bodyOf(`
      export function f(x: i32): f32 {
        let r: f32 = 0.;
        switch (x) {
          case 0: {
            if (x === 0) { r = 9.; break; }
            r = 1.;
            break;
          }
          default: r = 3.;
        }
        return r;
      }
    `);
    const sw = body.find((s) => s.s === 'switch')!;
    if (sw.s !== 'switch') throw new Error('expected a switch');
    const inner = sw.cases[0]!.body[0]!;
    expect(inner.s).toBe('if');
    if (inner.s !== 'if') return;
    expect(inner.arms[0]!.body.some((s) => s.s === 'break')).toBe(true);
  });

  it('emits one break per case in GLSL and none in WGSL', () => {
    const w = wgslOf(SWITCHED);
    expect(w).not.toMatch(/break;\s*\n\s*break;/);
    const r = compileTsSource(`"use typeshade";\n${SWITCHED}`);
    expect(r.wgsl).toContain('switch x {');
  });

  it('takes a negative literal and a module constant as a case label', () => {
    const body = bodyOf(`
      const MODE: i32 = 2
      export function f(x: i32): f32 {
        let r: f32 = 0.;
        switch (x) {
          case -1: r = 1.; break;
          case MODE: r = 2.; break;
          default: r = 3.;
        }
        return r;
      }
    `);
    const sw = body.find((s) => s.s === 'switch')!;
    if (sw.s !== 'switch') throw new Error('expected a switch');
    expect(sw.cases.map((c) => c.values)).toEqual([[-1], [2]]);
    // The `const MODE: i32 = 2` line itself still emits as `2.0`; that is #13, in the
    // backend's emitConst, not this front end — the folded case value above is already 2.
  });

  it('evaluates on the CPU, early break included', () => {
    const c = compile(`
      "use typeshade";
      export function pick(x: i32): f32 {
        let r: f32;
        r = 0.;
        switch (x) {
          case 0: r = 1.; break;
          case 1: {
            if (x === 1) { r = 5.; break; }
            r = 2.;
            break;
          }
          default: r = 3.;
        }
        return r;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.eval('pick', [0])).toBe(1);
    expect(c.eval('pick', [1])).toBe(5);
    expect(c.eval('pick', [7])).toBe(3);
  });

  it('lets a loop inside a case keep its own break', () => {
    const c = compile(`
      "use typeshade";
      export function f(x: i32): f32 {
        let n: f32 = 0.;
        switch (x) {
          case 0: {
            for (let i: i32 = 0; i < 4; i++) {
              if (i === 2) { break; }
              n += 1.;
            }
            break;
          }
          default: n = 9.;
        }
        return n;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.eval('f', [0])).toBe(2);
    expect(c.eval('f', [1])).toBe(9);
  });

  it('still refuses break outside both, continue in a switch, and a non-constant case', () => {
    expect(diagnose('export function f(): f32 {\n  break;\n  return 1.;\n}')).toBe(
      'break is only valid inside a loop or switch.',
    );
    expect(
      diagnose(`
        export function f(x: i32): f32 {
          switch (x) {
            case 0: continue;
            default: return 0.;
          }
        }
      `),
    ).toBe('continue is only valid inside a loop.');
    expect(
      diagnose(`
        export function f(x: i32): f32 {
          switch (x) {
            case 1.5: return 1.;
            default: return 0.;
          }
        }
      `),
    ).toBe('switch case must be an integer constant: a literal or a module const.');
    expect(
      diagnose(`
        export function f(x: i32, y: i32): f32 {
          switch (x) {
            case y: return 1.;
            default: return 0.;
          }
        }
      `),
    ).toBe('switch case must be an integer constant: a literal or a module const.');
    // `case 0: case 1:` is NOT one of these any more (§52): an empty clause above a full one
    // is how TypeScript spells two selectors sharing a body, which is `case 0, 1:` in WGSL.
    // What is still refused is an empty clause above `default:`, which shares nothing: WGSL's
    // selector list cannot carry `default`, so the selector would have to attach to some
    // OTHER clause's body — and until this was refused, that is what it silently did.
    expect(
      diagnose(`
        export function f(x: i32): f32 {
          switch (x) {
            case 0: return 1.;
            case 2:
            default: return 0.;
          }
        }
      `),
    ).toBe(
      'switch case 2 sits above "default:" with no body of its own. A case that should do ' +
        "what the default does needs its own body; WGSL has no form for sharing the default's.",
    );
  });

  it('refuses a label the selector cannot hold, and one that repeats', () => {
    // `caseValue` never compared the folded value against the selector's type, and the emitter
    // spells every label with the selector's suffix — so `case -1:` on a u32 selector emitted
    // `case -1u:` and Tint answered `no matching overload for 'operator - (u32)'`. That source
    // was refused before this item accepted a negative label at all.
    expect(
      diagnose(`
        export function f(x: u32): f32 {
          switch (x) {
            case -1: return 1.;
            default: return 0.;
          }
        }
      `),
    ).toBe('switch case -1 does not fit a u32 selector.');
    // …and the same label on an i32 selector is still fine.
    expect(
      wgslOf(`
        export function f(x: i32): f32 {
          switch (x) {
            case -1: return 1.;
            default: return 0.;
          }
        }
      `),
    ).toContain('case -1:');
    // A repeat is rejected by both compilers, and this surface makes one easy to write
    // without seeing it.
    expect(
      diagnose(`
        export function f(x: i32): f32 {
          switch (x) {
            case 2: return 1.;
            case 1 + 1: return 2.;
            default: return 0.;
          }
        }
      `),
    ).toBe('Duplicate switch case 2; each label may appear once.');
  });

  it('reports an unresolvable label once, not twice', () => {
    const r = compileTsSource(`"use typeshade";
      export function f(x: i32): f32 {
        switch (x) {
          case ZZZ: return 1.;
          default: return 0.;
        }
      }
    `);
    expect(r.diagnostics.map((d) => d.message)).toEqual(['Unknown identifier "ZZZ".']);
  });
});

describe('an init-less local on the CPU oracle', () => {
  // `zeroOf` and `zeroLit` had no array arm, so an init-less `var xs: array<f32, 3>` bound the
  // scalar 0 and the first `xs[0] = 1.` threw "Attempted to assign to readonly property" out of
  // the oracle — on a program both GPU targets compile. A bool bound 0 where WGSL gives false,
  // and a struct bound `{}`, so every field read `undefined`. All three are reachable only
  // because this item added the init-less declaration.
  //
  // Each case asserts on BOTH CPU backends: `compile().eval` is the interpreter (`zeroOf`),
  // `evalJs` the generated JS (`zeroLit`). They are two separate zero tables, so an assertion
  // through one leaves the other free to disagree — the bit-identity contract cpu-codegen.ts
  // opens with is exactly what a single-backend assertion here would stop enforcing.
  it('gives an array its elements, so an indexed write works', () => {
    const c = compiled(`
      "use typeshade";
      export function f(): f32 {
        let arr: array<f32, 3>;
        arr[0] = 1.;
        arr[1] = 2.;
        return arr[0] + arr[1];
      }
    `);
    expect(c.eval('f', [])).toBe(3);
    expect(evalJs(c, 'f')).toBe(3);
  });

  it('gives a bool `false`, which is what WGSL zero-initialises it to', () => {
    const c = compiled(`
      "use typeshade";
      export function f(): bool {
        let b: bool;
        return b;
      }
    `);
    expect(c.eval('f', [])).toBe(false);
    expect(evalJs(c, 'f')).toBe(false);
  });

  // WGSL's `var s: S;` zero-initialises every field; `{}` left them absent, so `s.a` read
  // `undefined` and any arithmetic on it went to NaN, silently, on a program Tint accepts.
  it('gives a struct every field zeroed, not an empty object', () => {
    const c = compiled(`
      "use typeshade";
      type P = { a: f32, b: i32, flag: bool, v: vec2f };
      export function f(): f32 {
        let s: P;
        return s.a + f32(s.b) + s.v.x + s.v.y;
      }
      export function g(): bool {
        let s: P;
        return s.flag;
      }
    `);
    expect(c.eval('f', [])).toBe(0);
    expect(evalJs(c, 'f')).toBe(0);
    expect(c.eval('g', [])).toBe(false);
    expect(evalJs(c, 'g')).toBe(false);
  });

  it('zeroes a nested struct and an array of structs, all the way down', () => {
    const c = compiled(`
      "use typeshade";
      type Inner = { k: f32, v: vec2f };
      type Outer = { a: f32, inner: Inner };
      type Cell = { a: f32, b: i32 };
      type Row = { xs: array<f32, 3>, n: i32 };
      export function nested(): f32 {
        let s: Outer;
        return s.a + s.inner.k + s.inner.v.x;
      }
      export function cells(): f32 {
        let xs: array<Cell, 2>;
        return xs[0].a + f32(xs[1].b);
      }
      export function arrayField(): f32 {
        let s: Row;
        s.xs[2] = 7.;
        return s.xs[0] + s.xs[2] + f32(s.n);
      }
    `);
    expect(c.eval('nested', [])).toBe(0);
    expect(evalJs(c, 'nested')).toBe(0);
    expect(c.eval('cells', [])).toBe(0);
    expect(evalJs(c, 'cells')).toBe(0);
    // The array field must be a real array, or the write throws the way the scalar 0 did.
    expect(c.eval('arrayField', [])).toBe(7);
    expect(evalJs(c, 'arrayField')).toBe(7);
  });
});
