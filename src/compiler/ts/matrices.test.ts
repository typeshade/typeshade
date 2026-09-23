// ═══ Matrices: every matCxR, its constructors, its products and its builtins ═══
//
// `mat4x4<f32>` was the only float matrix the surface admitted. The recorded reason was that
// "a 2×2 or 3×3 float matrix lays out differently under the WGSL and GLSL std140 rules" — half
// right, and measured in #149: std140 rounds every column up to 16 bytes while WGSL's column
// stride is AlignOf(vecR<f32>), so a TWO-ROW matrix diverges and a 3×3 does not. The
// divergence belongs to the uniform layout, not to the type, so all nine shapes are types now
// and `wgslLayout` refuses the three that cannot be described honestly.
//
// These tests are the shape rules: what each product is, what each constructor takes, and
// which builtins apply — each checked against the CPU oracle with a hand-computed product, so
// a rule that is merely self-consistent cannot pass.
//
// Verifies: Rule 4.8 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { emitModule, emitGlslModule } from '../../index.js';

const errorsOf = (src: string): string[] =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message);

const SHAPES = [2, 3, 4] as const;
const ALL: readonly (readonly [2 | 3 | 4, 2 | 3 | 4])[] = SHAPES.flatMap((c) =>
  SHAPES.map((r) => [c, r] as const),
);

/** `mat3x2` etc.; a square one also answers to `matN`, which the alias cases cover. */
const nameOf = (cols: number, rows: number): string => `mat${cols}x${rows}`;
const comps = (n: number): string => Array.from({ length: n }, (_, i) => `${i + 1}.`).join(', ');

describe('the nine shapes', () => {
  it.each(ALL)(
    'mat%ix%i declares, constructs, multiplies and transposes on both targets',
    (cols, rows) => {
      const m = nameOf(cols, rows);
      // Built from components, multiplied by a column vector, and transposed — the transpose
      // of a matCxR is a matRxC, which is a different type unless the matrix is square.
      const src = `"use typeshade"
export function build(): ${m} { return ${m}(${comps(cols * rows)}) }
export function apply(a: ${m}, v: vec${cols}): vec${rows} { return a * v }
export function flip(a: ${m}): ${nameOf(rows, cols)} { return transpose(a) }
export function scale(a: ${m}): ${m} { return a * 2. }
export function scaleLeft(a: ${m}): ${m} { return 2. * a }
export function row(a: ${m}, v: vec${rows}): vec${cols} { return v * a }
`;
      const r = compile(src);
      expect(
        r.diagnostics.filter((d) => d.category === 'error'),
        m,
      ).toEqual([]);
      // Both writers spell it, and the emitted text names the shape rather than a square
      // stand-in: WGSL always `matCxR<f32>`, GLSL `matN` when square and `matCxR` otherwise.
      const wgsl = emitModule(r.module);
      expect(wgsl, m).toContain(`mat${cols}x${rows}<f32>`);
      const glsl = emitGlslModule(r.module, 'vertex');
      expect(glsl, m).toContain(cols === rows ? `mat${cols}` : `mat${cols}x${rows}`);
    },
  );

  it.each(ALL)('the CPU agrees with a hand product for mat%ix%i', (cols, rows) => {
    const m = nameOf(cols, rows);
    const r = compile(`"use typeshade"
export function apply(a: ${m}, v: vec${cols}): vec${rows} { return a * v }
export function row(a: ${m}, v: vec${rows}): vec${cols} { return v * a }
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const cpu = compileModule(r.module);
    // Column-major: value (c, r) is c * rows + r, and every entry is distinct so a
    // transposed or mis-strided read cannot coincide with the right answer.
    const mat = Array.from({ length: cols * rows }, (_, i) => i + 1);
    for (let pick = 0; pick < cols; pick++) {
      // A basis vector selects column `pick` whole.
      const v = Array.from({ length: cols }, (_, i) => (i === pick ? 1 : 0));
      const want = mat.slice(pick * rows, pick * rows + rows);
      expect(cpu.fns.apply!(mat, v), `${m} * e${pick}`).toEqual(want);
    }
    for (let pick = 0; pick < rows; pick++) {
      // The row product takes row `pick`, which is every `rows`-th entry.
      const v = Array.from({ length: rows }, (_, i) => (i === pick ? 1 : 0));
      const want = Array.from({ length: cols }, (_, c) => mat[c * rows + pick]!);
      expect(cpu.fns.row!(mat, v), `e${pick} * ${m}`).toEqual(want);
    }
  });
});

// The JS-codegen CPU backend is a DIFFERENTIAL of the interpreter — `cpu-codegen.ts` states
// that `compileModuleJs(m).fns.f(args)` and `compileModule(m).fns.f(args)` agree element for
// element. Nothing compared them on a matrix, so `transpose` stayed square-only on the codegen
// path after the interpreter learned the shape, and every non-square example was silently
// wrong there. This is the gate that closes.
describe('the two CPU backends agree on every shape', () => {
  it.each(ALL)('mat%ix%i: interpreter and codegen give the same numbers', (cols, rows) => {
    const m = nameOf(cols, rows);
    const r = compile(`"use typeshade"
export function t(a: ${m}): ${nameOf(rows, cols)} { return transpose(a) }
export function apply(a: ${m}, v: vec${cols}): vec${rows} { return a * v }
export function row(a: ${m}, v: vec${rows}): vec${cols} { return v * a }
export function col(a: ${m}): vec${rows} { return a[0] }
export function write(a: ${m}, v: vec${rows}): ${m} { let w = a; w[0] = v; return w }
`);
    expect(
      r.diagnostics.filter((d) => d.category === 'error'),
      m,
    ).toEqual([]);
    const interp = compileModule(r.module);
    const gen = compileModuleJs(r.module);
    const mat = Array.from({ length: cols * rows }, (_, i) => i + 1);
    const vc = Array.from({ length: cols }, (_, i) => i + 1);
    const vr = Array.from({ length: rows }, (_, i) => i + 1);
    expect(gen.fns.t!(mat), `${m} transpose`).toEqual(interp.fns.t!(mat));
    expect(gen.fns.apply!(mat, vc), `${m} * v`).toEqual(interp.fns.apply!(mat, vc));
    expect(gen.fns.row!(mat, vr), `v * ${m}`).toEqual(interp.fns.row!(mat, vr));
    expect(gen.fns.col!(mat), `${m}[0]`).toEqual(interp.fns.col!(mat));
    expect(gen.fns.write!(mat, vr), `${m}[0] = v`).toEqual(interp.fns.write!(mat, vr));
  });
});

describe('the products', () => {
  it('m * s, s * m and v * m type per the spec table', () => {
    // wgsl.txt:9960-9995. Each line is a shape the table gives and the surface refused.
    expect(
      errorsOf(`"use typeshade";
export function a(m: mat3): mat3 { return m * 2.; }
export function b(m: mat3): mat3 { return 2. * m; }
export function c(m: mat3, v: vec3): vec3 { return v * m; }
export function d(m: mat2x3, v: vec3): vec2 { return v * m; }
export function e(m: mat2x3, v: vec2): vec3 { return m * v; }
export function f(x: mat3x2, y: mat2x3): mat2x2 { return x * y; }
export function g(x: mat2x3, y: mat3x2): mat3x3 { return x * y; }
`),
    ).toEqual([]);
  });

  it('refuses a scalar of the wrong element kind and a product that does not meet', () => {
    expect(
      errorsOf(`"use typeshade"\nexport function a(m: mat3, s: i32): mat3 { return m * s }\n`),
    ).not.toEqual([]);
    // mat2x3 has 2 columns, so it takes a vec2; a vec3 does not meet it.
    const bad = errorsOf(`"use typeshade";
export function a(m: mat2x3, v: vec3): vec3 { return m * v; }
`);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain('mat2x3<f32>');
  });

  it('the shared dimension cancels, and the CPU proves the orientation', () => {
    const r = compile(`"use typeshade";
export function mul(a: mat3x2, b: mat2x3): mat2x2 { return a * b; }
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    // a is 3 columns of 2; b is 2 columns of 3. a * b is 2 columns of 2.
    // a = [[1,2],[3,4],[5,6]], b = [[1,0,0],[0,1,0]] selects a's first two columns.
    const out = compileModule(r.module).fns.mul!(
      [1, 2, 3, 4, 5, 6],
      [1, 0, 0, 0, 1, 0],
    ) as number[];
    expect(out).toEqual([1, 2, 3, 4]);
  });

  it('refuses two matrices of ONE non-square shape, which have one type key', () => {
    // The pair the mismatch check cannot see: `typeKey(a) === typeKey(b)`, so nothing asked
    // whether the dimensions meet and the product was typed as the left operand. Measured on
    // Tint: `no matching overload for 'operator * (mat2x3<f32>, mat2x3<f32>)'` (#169).
    for (const [c, r] of ALL.filter(([c, r]) => c !== r)) {
      const name = nameOf(c, r);
      const errors = errorsOf(
        `"use typeshade"\nexport function f(a: ${name}, b: ${name}): ${name} { return a * b }\n`,
      );
      expect(errors, name).toHaveLength(1);
      expect(errors[0], name).toContain(`${name}<f32> and ${name}<f32>`);
      expect(errors[0], name).toContain('matKxR * matCxK -> matCxR');
    }
    // Two matrices of one SQUARE shape still multiply, which is what the pair above cannot.
    for (const n of SHAPES) {
      const name = nameOf(n, n);
      expect(
        errorsOf(
          `"use typeshade"\nexport function f(a: ${name}, b: ${name}): ${name} { return a * b }\n`,
        ),
        name,
      ).toEqual([]);
    }
  });

  it('types every pair of the nine shapes by the WGSL rule, and refuses the rest', () => {
    // All 81 ordered pairs against `matKxR * matCxK -> matCxR`: the left operand's COLUMNS
    // against the right operand's ROWS, the result carrying the right's columns and the
    // left's rows. The declared return type is the assertion — a product typed wrongly is
    // refused by the return check, so this pins the result shape and not merely acceptance.
    for (const [lc, lr] of ALL) {
      for (const [rc, rr] of ALL) {
        const src = (result: string): string =>
          `"use typeshade"\nexport function f(a: ${nameOf(lc, lr)}, b: ${nameOf(rc, rr)}): ${result} { return a * b }\n`;
        const label = `${nameOf(lc, lr)} * ${nameOf(rc, rr)}`;
        if (lc === rr) {
          expect(errorsOf(src(nameOf(rc, lr))), label).toEqual([]);
        } else {
          // Nothing it could be typed as: the shape the left operand has is refused too.
          expect(errorsOf(src(nameOf(lc, lr))), label).not.toEqual([]);
        }
      }
    }
  });
});

describe('the operators a matrix does and does not have', () => {
  it('adds and subtracts two matrices of the SAME shape, and nothing else', () => {
    expect(
      errorsOf(`"use typeshade";
export function a(x: mat2x3, y: mat2x3): mat2x3 { return x + y; }
export function b(x: mat3, y: mat3): mat3 { return x - y; }
`),
    ).toEqual([]);
    // Different shapes do not add, in either order.
    expect(
      errorsOf(
        `"use typeshade"\nexport function f(x: mat3x2, y: mat2x3): mat2x2 { return x + y }\n`,
      ),
    ).not.toEqual([]);
  });

  it('refuses matrix division, which neither target has', () => {
    // WGSL gives a matrix no `/` and no `%`; emitting `(a / b)` is a compile error on both.
    for (const op of ['/', '%']) {
      expect(
        errorsOf(
          `"use typeshade"\nexport function f(x: mat3, y: mat3): mat3 { return x ${op} y }\n`,
        ),
        op,
      ).not.toEqual([]);
    }
  });

  it('holds the compound spellings to the same rules as the operators', () => {
    // `m *= n` is `m = m * n` and `m /= n` is `m = m / n`, but the compound path had neither
    // check: the product's dimensions were never asked about and the `/` refusal lived only
    // in `lowerBinary`. Both reached Tint, which answers "no matching overload for
    // 'operator *= (mat2x3<f32>, mat2x3<f32>)'" and the same for `/=` and `%=` (#169).
    const stmt = (decl: string, body: string): string =>
      `"use typeshade"\nexport function f(${decl}): f32 {\n  ${body}\n  return 1.;\n}\n`;
    for (const op of ['*', '/', '%']) {
      expect(
        errorsOf(stmt('a: mat2x3, b: mat2x3', `let c = a;\n  c ${op}= b;`)),
        `mat2x3 ${op}= mat2x3`,
      ).toHaveLength(1);
    }
    // A square shape keeps `*=` — the product is the target's own type — and still has no
    // `/=` or `%=`, because WGSL gives a matrix neither whatever its shape.
    expect(errorsOf(stmt('a: mat3, b: mat3', 'let c = a;\n  c *= b;'))).toEqual([]);
    for (const op of ['/', '%']) {
      expect(
        errorsOf(stmt('a: mat3, b: mat3', `let c = a;\n  c ${op}= b;`)),
        `mat3 ${op}= mat3`,
      ).toHaveLength(1);
    }
  });

  it('refuses a scalar of the wrong element kind beside an emulated-double matrix', () => {
    // The fp64 pass has a body for matmul, matvec and transpose only, so a scaled mat64 has
    // no lowering; it used to emit `(s * m)` on a DF64Mat3, which Tint refuses.
    for (const body of [
      'export function f(m: mat3<f64>, s: f64): mat3<f64> { return m * s }',
      'export function f(m: mat3<f64>, s: f64): mat3<f64> { return s * m }',
    ]) {
      const errors = errorsOf(`"use typeshade"\n${body}\n`);
      expect(errors, body).toHaveLength(1);
      // At the operator, with both types named — not a span-less SD0041 from the backend.
      expect(errors[0], body).toContain('mat3x3<f64>');
      expect(errors[0], body).not.toContain('Backend emit failed');
    }
  });

  it('does not let a matrix constructor shadow a function the file declares', () => {
    // "An addition may not change what a program means" — the rule the vector constructors
    // already follow (#8 A6).
    const r = compile(`"use typeshade";
function mat3(x: f32): f32 { return x * 2.; }
export function f(x: f32): f32 { return mat3(x); }
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(compileModule(r.module).fns.f!(3)).toBe(6);
  });
});

describe('the constructors', () => {
  it('build from columns, from components, from a larger matrix, and empty', () => {
    expect(
      errorsOf(`"use typeshade";
export function cols(a: vec3, b: vec3, c: vec3): mat3 { return mat3(a, b, c); }
export function parts(): mat3 { return mat3(1.,0.,0., 0.,1.,0., 0.,0.,1.); }
export function zero(): mat2 { return mat2(); }
export function trunc(m: mat4): mat3 { return mat3(m); }
export function wide(a: vec3, b: vec3): mat2x3 { return mat2x3(a, b); }
`),
    ).toEqual([]);
  });

  it('the four forms agree with each other on the CPU', () => {
    const r = compile(`"use typeshade";
export function fromCols(a: vec3, b: vec3, c: vec3): mat3 { return mat3(a, b, c); }
export function fromParts(): mat3 { return mat3(1.,2.,3., 4.,5.,6., 7.,8.,9.); }
export function zero(): mat3 { return mat3(); }
export function truncated(m: mat4): mat3 { return mat3(m); }
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const cpu = compileModule(r.module);
    expect(cpu.fns.fromCols!([1, 2, 3], [4, 5, 6], [7, 8, 9])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(cpu.fns.fromParts!()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(cpu.fns.zero!()).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // The upper-left 3×3 of a column-major mat4, which is what a normal matrix is.
    const m4 = Array.from({ length: 16 }, (_, i) => i + 1);
    expect(cpu.fns.truncated!(m4)).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11]);
  });

  it('refuses a widening construction, a wrong column width and a wrong count', () => {
    expect(
      errorsOf(`"use typeshade"\nexport function f(m: mat2): mat4 { return mat4(m) }\n`)[0],
    ).toContain('truncates a matrix and does not grow one');
    expect(
      errorsOf(`"use typeshade";
export function f(a: vec2, b: vec2, c: vec2): mat3 { return mat3(a, b, c); }
`)[0],
    ).toContain('takes 3 vec3 columns');
    expect(
      errorsOf(`"use typeshade"\nexport function f(): mat3 { return mat3(1., 2.) }\n`)[0],
    ).toContain('takes 3 vec3 columns');
  });
});

describe('transpose and determinant', () => {
  it.each(ALL)('transpose(mat%ix%i) is a mat with the dimensions swapped', (cols, rows) => {
    const r = compile(
      `"use typeshade"\nexport function t(m: ${nameOf(cols, rows)}): ${nameOf(rows, cols)} { return transpose(m) }\n`,
    );
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const mat = Array.from({ length: cols * rows }, (_, i) => i + 1);
    // Element (c, r) of the input is element (r, c) of the output.
    const want = Array.from({ length: cols * rows }, (_, i) => {
      const outCol = Math.floor(i / cols);
      const outRow = i % cols;
      return mat[outRow * rows + outCol]!;
    });
    expect(compileModule(r.module).fns.t!(mat)).toEqual(want);
  });

  it('determinant applies to the square shapes and to no other', () => {
    for (const n of SHAPES) {
      expect(
        errorsOf(`"use typeshade"\nexport function d(m: mat${n}): f32 { return determinant(m) }\n`),
        `mat${n}`,
      ).toEqual([]);
    }
    for (const [cols, rows] of ALL.filter(([c, r]) => c !== r)) {
      const errors = errorsOf(
        `"use typeshade"\nexport function d(m: ${nameOf(cols, rows)}): f32 { return determinant(m) }\n`,
      );
      expect(errors, nameOf(cols, rows)).toHaveLength(1);
      expect(errors[0]).toContain('takes a square matrix');
    }
  });

  it('determinant of a 2 and a 3 agrees with the hand computation', () => {
    const r = compile(`"use typeshade";
export function d2(m: mat2): f32 { return determinant(m); }
export function d3(m: mat3): f32 { return determinant(m); }
`);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const cpu = compileModule(r.module);
    // Column-major [[a,b],[c,d]] is the matrix (a c / b d), whose determinant is ad - cb.
    expect(cpu.fns.d2!([1, 2, 3, 4])).toBe(1 * 4 - 3 * 2);
    // A singular 3×3 (its third column is the sum of the first two) must give exactly 0.
    expect(cpu.fns.d3!([1, 2, 3, 4, 5, 6, 5, 7, 9])).toBe(0);
    // And a scaling matrix gives the product of the diagonal.
    expect(cpu.fns.d3!([2, 0, 0, 0, 3, 0, 0, 0, 4])).toBe(24);
  });
});
