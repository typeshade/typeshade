// Verifies: Rule 12.4 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { analyzeSourceFile, createTypeshadeLanguageServiceWith } from './service.js';
import { TypeshadeHost } from './host.js';
import { GPU_BRAND_TAGS } from './ambient.js';
import { SUPPORTED_TYPE_NAMES } from '../compiler/ts/type-map.js';
import type { TypeshadeDiagnostic } from './types.js';

const URI = 'a.ts';

/** What the editor shows: both halves, merged to one diagnostic per mistake. With `merge`
 * false, the two halves as they are before that merge (`mergeDiagnostics`). */
function diagnosticsOf(source: string, merge = true): readonly TypeshadeDiagnostic[] {
  const service = createTypeshadeLanguageServiceWith({}, analyzeSourceFile, { merge });
  service.openDocument(URI, source);
  return service.getDiagnostics(URI);
}

/** Every TypeScript diagnostic the filters keep, which is what §6's "zero false positives on a
 * valid program" is about, read before the merge: where the compiler reports the same mistake,
 * the merge shows its sentence in place of TypeScript's, and these tests are about TypeScript's.
 * A `"use typeshade"` diagnostic is the compiler front end speaking and is asserted on
 * separately below. */
function typeScriptHalfOf(source: string): readonly TypeshadeDiagnostic[] {
  return diagnosticsOf(source, false).filter((d) => d.source === 'typescript');
}

function typeScriptDiagnosticsOf(source: string): string[] {
  return typeScriptHalfOf(source).map((d) => `TS${d.code}: ${d.message}`);
}

const entry = (
  body: string,
  signature = 'v: vec3, s: f32, a: vec3, b: vec3, c: vec4, m: mat4',
): string => `"use typeshade"\nexport function f(${signature}): void {\n${body}\n}\n`;

// Issue #21: every vector expression in a `"use typeshade"` program drew TS2362/TS2363/TS2365,
// and the TS2322 that follows from arithmetic being typed `number`, because the ambient lib
// brands vectors and matrices as object types and a branded object type is not a `number` to
// TypeScript's arithmetic check. The brands are what keep a `vec3` from satisfying a `vec2`, so
// the fix is a filter over the diagnostics rather than a weaker ambient lib.
describe('vector and matrix arithmetic draws no TypeScript diagnostic (issue #21)', () => {
  const cases: Readonly<Record<string, string>> = {
    'a vector times a scalar': entry('  const p = v * s\n'),
    'two vectors added': entry('  const p = a + b\n'),
    'a swizzle times a float literal': entry('  const p = c.rgb * 0.5\n'),
    'a constructor times Math.PI': entry('  const p = vec4(0.) * Math.PI\n'),
    'a compound assignment': entry('  v *= 2.\n'),
    'a matrix times a vector': entry('  const p = m * c\n'),
    'a vector-annotated return of vector arithmetic':
      '"use typeshade"\nexport function f(v: vec3, s: f32): vec3 {\n  return v * s\n}\n',
    'a vector-annotated local of vector arithmetic':
      '"use typeshade"\nexport function f(a: vec3, b: vec3): vec3 {\n  let t: vec3 = a + b\n  return t\n}\n',
    // The same program in three spellings. TS2365 spans the whole operation, and a LEFT-nested
    // product starts at the same offset as the operation containing it, so a rule that asked the
    // nearest binary expression at that offset asked about `n * 3.` (two scalars, no brand, keep
    // the diagnostic) in the first spelling and about the real `+` in the other two.
    'a scalar product added to a vector':
      '"use typeshade"\nexport function f(n: f32, v: vec2): vec2 {\n  return n * 3. + v\n}\n',
    'a vector added to a scalar product':
      '"use typeshade"\nexport function f(n: f32, v: vec2): vec2 {\n  return v + n * 3.\n}\n',
    'a parenthesized scalar product added to a vector':
      '"use typeshade"\nexport function f(n: f32, v: vec2): vec2 {\n  return (n * 3.) + v\n}\n',
  };
  for (const [name, source] of Object.entries(cases)) {
    it(`${name}: no TypeScript-sourced diagnostic`, () => {
      expect(typeScriptDiagnosticsOf(source), source).toEqual([]);
    });
  }
});

// Issue #43: the knock-on of #21 at a CALL. `v * s` is typed `number`, so every vector
// position a product reaches rejects it. `vec4(u.tint.rgb * k, u.tint.a)` is close to the most
// common line in a fragment shader, and 11 of the 17 `.shade.ts` examples across `main` and the
// twin branches failed `ambient.test.ts`'s zero-diagnostics gate on this one shape. Each of
// these compiles, emits WGSL and links on WebGL2; only the editor surface rejected them.
describe('vector arithmetic reaching a call draws no TypeScript diagnostic (issue #43)', () => {
  const cases: Readonly<Record<string, string>> = {
    // hello-uniform-struct.shade.ts (#18), the whole reason that example carried an annotated
    // local instead of the line its twin wanted.
    'a constructor over a swizzle times a scalar':
      '"use typeshade"\nexport function f(c: vec4, k: f32): vec4 {\n  return vec4(c.rgb * k, c.a)\n}\n',
    // The argument TypeScript reports here is `b`, which is a perfectly good vec3: the product
    // in the FIRST argument infers `number` for `T`, and `b` is then measured against that.
    'dot of a scaled vector, reported on the other argument':
      '"use typeshade"\nexport function f(a: vec3, b: vec3): f32 {\n  return dot(a * 2., b)\n}\n',
    'normalize of a vector times a scalar':
      '"use typeshade"\nexport function f(v: vec3, s: f32): vec3 {\n  return normalize(v * s)\n}\n',
    'a user function with a vector parameter':
      '"use typeshade"\nfunction g(p: vec3): vec3 {\n  return p\n}\nexport function f(v: vec3, s: f32): vec3 {\n  return g(v * s)\n}\n',
    // TypeScript stops at the first argument that fails, so dropping this one leaves nothing
    // behind on `t` either.
    'mix with a scaled vector in the middle':
      '"use typeshade"\nexport function f(a: vec3, b: vec3, t: f32): vec3 {\n  return mix(a, b * 0.5, t)\n}\n',
    'a product nested inside another call':
      '"use typeshade"\nexport function f(v: vec3, s: f32): vec4 {\n  return vec4(normalize(v * s), 1.)\n}\n',
    // A matrix times a vector is a VECTOR, so the shape the rule measures `m * c` by is `c`'s,
    // not `m`'s, which is the line every camera example ends with.
    'a matrix times a vector handed a vector parameter':
      '"use typeshade"\nfunction g(p: vec4): vec4 {\n  return p\n}\nexport function f(m: mat4, c: vec4): vec4 {\n  return g(m * c)\n}\n',
    'dot of a matrix-vector product, reported on the other argument':
      '"use typeshade"\nexport function f(m: mat4, c: vec4, b: vec4): f32 {\n  return dot(m * c, b)\n}\n',
  };
  for (const [name, source] of Object.entries(cases)) {
    it(`${name}: no diagnostic at all, from TypeScript or the compiler`, () => {
      // Every one of these is a valid program, so "exactly the compiler's diagnostics" is the
      // empty list: the filter must not be covering for a front end that disagrees.
      expect(typeScriptDiagnosticsOf(source), source).toEqual([]);
      expect(diagnosticsOf(source), source).toEqual([]);
    });
  }

  it('a rest parameter is measured by its element type, and the compiler still speaks', () => {
    // `hypot(...args: T[])` is one of the five variadic math aliases (`MATH_EXPAND_ALIAS`: `log10`,
    // `log1p`, `expm1`, `cbrt`, `hypot`), which together with `array(...values)` are the ambient
    // lib's only rest parameters. This program is NOT valid: hypot takes scalars. TypeScript's
    // complaint about it is the poisoned-inference one (`w` measured against the `number` the
    // product inferred), so it goes, and what is left is the compiler saying the thing that is
    // actually wrong.
    const source =
      '"use typeshade"\nexport function f(v: vec3, w: vec3, s: f32): vec3 {\n  return hypot(v * s, w)\n}\n';
    expect(typeScriptDiagnosticsOf(source)).toEqual([]);
    expect(diagnosticsOf(source).map((d) => `${d.source} ${d.code}`)).toEqual(['typeshade TS8003']);
  });
});

describe('an argument that is not vector arithmetic still reports (issue #43)', () => {
  const stillReports = (source: string, code: number): void => {
    expect(
      typeScriptHalfOf(source).some((d) => d.code === code),
      source,
    ).toBe(true);
  };

  it('vec4(1., c.a) keeps TS2345: two scalars are not a vec3 and a scalar', () => {
    stillReports(
      '"use typeshade"\nexport function f(c: vec4): vec4 {\n  return vec4(1., c.a)\n}\n',
      2345,
    );
  });

  it('a float literal handed a vector parameter keeps TS2345', () => {
    stillReports(
      '"use typeshade"\nfunction g(p: vec3): vec3 {\n  return p\n}\nexport function f(): vec3 {\n  return g(1.)\n}\n',
      2345,
    );
  });

  it('an f32 handed a vector parameter keeps TS2345', () => {
    stillReports(
      '"use typeshade"\nfunction g(p: vec3): vec3 {\n  return p\n}\nexport function f(x: f32): vec3 {\n  return g(x)\n}\n',
      2345,
    );
  });

  it('a vector of the wrong size keeps TS2345, since nothing else reports it', () => {
    // The narrowing this rule makes against the TS2322 rule it mirrors: a branded argument that
    // reached a branded parameter without any arithmetic is a real mismatch, and `dot` is where
    // it shows, since the compiler front end has no argument check for the ambient math
    // functions.
    stillReports(
      '"use typeshade"\nexport function f(a: vec3, b: vec2): f32 {\n  return dot(a, b)\n}\n',
      2345,
    );
  });

  it('a wrong-arity call still reports its own TS2554, not a filtered TS2345', () => {
    const source =
      '"use typeshade"\nfunction g(p: vec3): vec3 {\n  return p\n}\nexport function f(a: vec3, b: vec3): vec3 {\n  return g(a, b)\n}\n';
    stillReports(source, 2554);
    expect(typeScriptDiagnosticsOf(source).map((d) => d.split(':')[0])).toEqual(['TS2554']);
  });

  it('a vector handed a scalar parameter reports, even when another argument is a product', () => {
    // The inferred-parameter arm must not reach a signature whose parameter type is FIXED:
    // `h`'s parameters are `f32` whatever the arguments do, so passing a vec3 is a real error.
    stillReports(
      '"use typeshade"\nfunction h(a: f32, b: f32): f32 {\n  return a + b\n}\nexport function f(v: vec3, w: vec3, s: f32): f32 {\n  return h(v * s, w)\n}\n',
      2345,
    );
  });
});

// The arithmetic in a call is not a licence to stop checking the OTHER arguments. Every case
// here is a real size or element mismatch in a call that also does vector arithmetic, and the
// ambient math functions have no argument check in the compiler front end at all
// (`src/compiler/ts/math-alias.ts` lowers them by arity), so TypeScript's TS2345 is the only
// report these mistakes get. The first rule for issue #43 asked only "is this argument branded,
// and does SOME argument do arithmetic", which answered yes to all of them.
describe('a wrong shape still reports when the call also does arithmetic (issue #43)', () => {
  // TS2345 for a callee with one signature, TS2769 ("No overload matches this call") for an
  // overloaded one: `mix` and every generic math name now declare an all-scalar overload beside
  // the generic shape, and `mix` three vector-with-scalar ones as well, so TypeScript has no
  // single candidate to name and reports the overload code on the same span instead. Which of
  // the two codes arrives is TypeScript's business; that the mistake is still reported is this
  // suite's.
  const ARGUMENT_MISMATCH_CODES: ReadonlySet<string | number> = new Set([2345, 2769]);
  const keepsReporting = (source: string): void => {
    expect(
      typeScriptHalfOf(source).some((d) => ARGUMENT_MISMATCH_CODES.has(d.code)),
      source,
    ).toBe(true);
  };

  const cases: Readonly<Record<string, string>> = {
    // `T` infers `number` from the product, so TypeScript reports the OTHER argument, and that
    // argument is the wrong size for the `vec3` the product would have inferred.
    'dot of a scaled vec3 and a vec2':
      '"use typeshade"\nexport function f(a: vec3, b: vec2): f32 {\n  return dot(a * 2., b)\n}\n',
    'dot of a vec2 and a scaled vec3':
      '"use typeshade"\nexport function f(a: vec2, b: vec3): f32 {\n  return dot(a, b * 2.)\n}\n',
    // Same arity, different element kind: the shape a rule compares has to carry both.
    'dot of a scaled vec3 and a vec3i':
      '"use typeshade"\nexport function f(a: vec3, b: vec3i): f32 {\n  return dot(a * 2., b)\n}\n',
    'distance of a scaled vec3 and a vec2':
      '"use typeshade"\nexport function f(a: vec3, b: vec2): f32 {\n  return distance(a * 2., b)\n}\n',
    // The mismatch is in the THIRD argument, two positions past the one TypeScript reports.
    'mix of a scaled vec3 with a vec2 at the end':
      '"use typeshade"\nexport function f(a: vec3, b: vec3, c: vec2): vec3 {\n  return mix(a * 0.5, b, c)\n}\n',
    'clamp of a scaled vec3 with a vec2 at the end':
      '"use typeshade"\nexport function f(a: vec3, b: vec3, c: vec2): vec3 {\n  return clamp(a * 2., b, c)\n}\n',
    'max of a scaled vec3 and a matrix':
      '"use typeshade"\nexport function f(a: vec3, m: mat4): vec3 {\n  return max(a * 2., m)\n}\n',
    // A matrix times a vector is a vec4, so the vec2 is the mismatch, not the matrix operand.
    'dot of a matrix-vector product and a vec2':
      '"use typeshade"\nexport function f(m: mat4, c: vec4, b: vec2): f32 {\n  return dot(m * c, b)\n}\n',
    // `cross`'s parameters are FIXED `vec3`, so these two are the other arm: the product's own
    // shape is measured against the parameter, and the sibling against its own.
    'cross of a scaled vec2 and a vec3':
      '"use typeshade"\nexport function f(a: vec2, s: f32, b: vec3): vec3 {\n  return cross(a * s, b)\n}\n',
    'cross of a scaled vec3 and a vec2':
      '"use typeshade"\nexport function f(a: vec3, b: vec2): vec3 {\n  return cross(a * 2., b)\n}\n',
  };
  for (const [name, source] of Object.entries(cases)) {
    it(`${name}: keeps reporting the argument mismatch`, () => {
      keepsReporting(source);
    });
  }

  it('a fragment that mixes a vec3 with a vec2 is not clean in the editor', () => {
    // End to end, in the shape a shader is actually written in: `mix(vec3, vec2, float)` has no
    // GLSL ES 3.00 overload, so an editor that reported nothing here would be clean on a shader
    // that does not link.
    keepsReporting(
      '"use typeshade"\n' +
        'class VsOut {\n' +
        '  @builtin("position") pos: vec4\n' +
        '  @location(0) uv: vec2\n' +
        '}\n' +
        '@fragment\n' +
        'export function fs(vo: VsOut): vec4 {\n' +
        '  const c: vec3 = vec3(1., 0., 0.)\n' +
        '  return vec4(mix(c * 0.5, vo.uv, 0.5), 1.)\n' +
        '}\n',
    );
  });

  it('the same fragment with two vec3 is clean, so the guard is about the shape', () => {
    const source =
      '"use typeshade"\n' +
      'class VsOut {\n' +
      '  @builtin("position") pos: vec4\n' +
      '  @location(0) uv: vec2\n' +
      '}\n' +
      '@fragment\n' +
      'export function fs(vo: VsOut): vec4 {\n' +
      '  const c: vec3 = vec3(1., 0., 0.)\n' +
      '  const d: vec3 = vec3(0., 1., 0.)\n' +
      '  return vec4(mix(c * 0.5, d, 0.5), 1.)\n' +
      '}\n';
    expect(diagnosticsOf(source).map((d) => `${d.source} ${d.code}: ${d.message}`)).toEqual([]);
  });
});

describe('a program that is genuinely wrong still reports', () => {
  it('v * "x" keeps the TypeScript diagnostic about the string operand', () => {
    const source = '"use typeshade"\nexport function f(v: vec3): vec3 {\n  return v * "x"\n}\n';
    // TS2363 is the right-hand operand's, so filtering per operand (rather than dropping the
    // whole expression because ONE operand is a vector) is what leaves this visible.
    expect(typeScriptHalfOf(source).some((d) => d.code === 2363)).toBe(true);
  });

  it('1 * "x", with no vector anywhere, is untouched', () => {
    const source = '"use typeshade"\nexport function f(): f32 {\n  return 1 * "x"\n}\n';
    expect(typeScriptHalfOf(source).some((d) => d.code === 2363)).toBe(true);
  });

  it('a vector assigned into a scalar keeps TS2322', () => {
    const source =
      '"use typeshade"\nexport function f(v: vec3): f32 {\n  let n: f32 = v\n  return n\n}\n';
    // The target is `f32`, which IS a `number` to TypeScript, so the mismatch is not the
    // brand's doing and the TS2322 rule must not reach it.
    expect(typeScriptHalfOf(source).some((d) => d.code === 2322)).toBe(true);
  });
});

describe('the compiler front end stays the authority on what combines with what', () => {
  it('vec3(1.) + vec2(1.) is reported once, by the compiler', () => {
    const source =
      '"use typeshade"\nexport function f(): vec3 {\n  return vec3(1.) + vec2(1.)\n}\n';
    const diagnostics = diagnosticsOf(source);
    expect(typeScriptDiagnosticsOf(source), 'TypeScript would say this twice over').toEqual([]);
    expect(
      diagnostics.map((d) => `${d.source} ${d.code}`),
      'the editor should show exactly the compiler TYPE_MISMATCH',
    ).toEqual(['typeshade TS8003']);
  });
});

/** Every unique-symbol brand `SHADE_DTS` puts on the named types, read back through the checker
 * the same way `diagnostics.ts` reads it: a property whose escaped name is `__@<tag>@<id>`. */
function brandTagsOf(typeNames: readonly string[]): string[] {
  const source =
    '"use typeshade"\n' +
    typeNames.map((name, i) => `declare const value${i}: ${name}`).join('\n') +
    '\n';
  const host = new TypeshadeHost();
  host.openDocument(URI, source);
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  const program = service.getProgram()!;
  const checker = program.getTypeChecker();
  const tags = new Set<string>();
  program.getSourceFile(URI)!.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      for (const property of checker.getTypeAtLocation(declaration.name).getProperties()) {
        const tag = /^__@(.+)@\d+$/.exec(property.getName())?.[1];
        if (tag !== undefined) tags.add(tag);
      }
    }
  });
  return [...tags].sort();
}

const VECTOR_AND_MATRIX_NAMES = SUPPORTED_TYPE_NAMES.filter((name) => /^(vec|mat)/.test(name));
const SCALAR_NAMES = SUPPORTED_TYPE_NAMES.filter((name) => !/^(vec|mat)/.test(name));

// The list in `ambient.ts` is what `diagnostics.ts` matches a type against, so a brand added to
// SHADE_DTS without a decision about its arithmetic must fail here rather than quietly widen or
// narrow which diagnostics the editor drops.
describe('GPU_BRAND_TAGS is exactly what SHADE_DTS brands vectors and matrices with', () => {
  it('equals the tag set of every vector and matrix type name the compiler supports', () => {
    expect(
      VECTOR_AND_MATRIX_NAMES.length,
      'no vector names resolved from type-map.ts',
    ).toBeGreaterThan(0);
    expect(brandTagsOf(VECTOR_AND_MATRIX_NAMES)).toEqual([...GPU_BRAND_TAGS].sort());
  });

  it('excludes the scalar and array brands, whose arithmetic TypeScript already accepts', () => {
    // A scalar IS a `number` to TypeScript and indexing an `array` is not arithmetic, so
    // neither needs, or should get, the vector treatment.
    const other = brandTagsOf([...SCALAR_NAMES, 'array<f32>']);
    expect(other.length, 'the scalar and array brands should be readable').toBeGreaterThan(0);
    expect(other.filter((tag) => GPU_BRAND_TAGS.includes(tag))).toEqual([]);
  });
});

// A local declared with no type from vector arithmetic is the `number` the arithmetic is typed,
// to TypeScript, and the `vec3` it is, to the compiler. Every use of it then drew the false
// positive the arithmetic itself is filtered for, at each call, assignment, return and swizzle
// below, and the only way to quiet them was to annotate the local by hand. The program the
// service builds reads the document with the compiler's type written in (`projection.ts`, #162).
describe('a name declared with no type from vector arithmetic draws no TypeScript diagnostic', () => {
  const USES = `"use typeshade";
export function shade(n: vec3, l: vec3, albedo: vec3, d: f32): vec3 {
  const lit = albedo * d + albedo * 0.1;
  const a = normalize(lit);
  const b = dot(lit, n);
  const c = dot(n, lit);
  const e = max(lit, vec3(0.));
  const f = mix(n, lit, 0.5);
  const g = vec4(lit, 1.);
  const h = lit.x + lit.y;
  const i = lit.xy;
  let j: vec3 = lit;
  const k = lit;
  const m = normalize(k);
  const p = cross(lit, n);
  const r = clamp(lit, vec3(0.), vec3(1.));
  const s = length(lit) + distance(lit, n);
  const t = normalize(n * 2. - 1.);
  const u = dot(t, l);
  const w = (n * 2.).xy;
  return lit;
}
`;

  it('at a call, an assignment, a return and a swizzle', () => {
    expect(typeScriptDiagnosticsOf(USES)).toEqual([]);
    expect(diagnosticsOf(USES).filter((x) => x.severity === 'error')).toEqual([]);
  });

  // The projection spells the compiler's type in the ambient library's words (`ambientSpelling`),
  // and a parameter's type is the ambient declaration itself; this is the test that the
  // spelling names that declaration, for every vector and matrix type there is an operation on:
  // arithmetic, and `&` on a mask.
  const OPERATED_TYPES = [...VECTOR_AND_MATRIX_NAMES, 'mat2<f64>', 'mat3<f64>', 'mat4<f64>'];
  for (const type of OPERATED_TYPES) {
    it(`carries its type into a parameter of type ${type}`, () => {
      const operation = /^vec\db$/.test(type) ? 'a & a' : 'a + a';
      const source = `"use typeshade"
function g(v: ${type}): ${type} {
  return v
}
export function f(a: ${type}): ${type} {
  const x = ${operation}
  return g(x)
}
`;
      expect(typeScriptDiagnosticsOf(source), source).toEqual([]);
      expect(diagnosticsOf(source), source).toEqual([]);
    });
  }

  it('keeps TS2345 for a name the compiler types as a scalar', () => {
    const source = entry('  const d = dot(a, b)\n  const p = cross(d, a)\n');
    expect(typeScriptDiagnosticsOf(source).map((x) => x.slice(0, 7))).toEqual(['TS2345:']);
  });

  it('keeps TS2345 for a name of the wrong shape', () => {
    // `w` is the `vec2` the swizzle's arithmetic makes, and `cross` takes two `vec3`.
    const source = entry('  const w = a.xy * s\n  const p = cross(w, a)\n');
    expect(typeScriptDiagnosticsOf(source).map((x) => x.slice(0, 7))).toEqual(['TS2345:']);
  });

  it('leaves a bad swizzle of such a name to the compiler, which reports it once', () => {
    const source = entry('  const lit = a * s\n  const p = lit.w\n');
    expect(diagnosticsOf(source).map((x) => `${x.source} ${String(x.code)} ${x.message}`)).toEqual([
      'typeshade TS8022 .w out of range on vec3<f32>.',
    ]);
  });

  it('keeps TS2339 on a value TypeScript still types as a vector', () => {
    // No brand was lost here, so TypeScript's own member check stands.
    const source = entry('  const p = a.w\n');
    expect(typeScriptDiagnosticsOf(source).map((x) => x.slice(0, 7))).toEqual(['TS2339:']);
  });
});

// Arithmetic is not the only operation TypeScript types without the vector: a comparison is a
// `boolean` to it, and the bitwise and shift operators, `**`, `~` and `!` are a `number` or a
// `boolean`, where the compiler has a mask, an integer vector or a vector of floats. Each of
// these compiles, and each drew a TypeScript error where its value was used, from the one
// operator table the projection reads too (`ERASING_OPERATORS`).
describe('an operation other than arithmetic loses a vector type the same way', () => {
  const cases: Readonly<Record<string, string>> = {
    'a comparison returned as a mask':
      'export function f(a: vec3, b: vec3): vec3b {\n  return a < b\n}',
    'a comparison handed to a mask parameter':
      'function g(m: vec3b): bool {\n  return any(m)\n}\nexport function f(a: vec3, b: vec3): bool {\n  return g(a < b)\n}',
    'a comparison assigned to a mask':
      'export function f(a: vec3, b: vec3): vec3b {\n  let m = vec3b(false)\n  m = a < b\n  return m\n}',
    'a component of a comparison':
      'export function f(a: vec3, b: vec3): bool {\n  return (a < b).x\n}',
    'strict equality of two vectors':
      'export function f(a: vec3, b: vec3): vec3b {\n  return a === b\n}',
    'a comparison of two products':
      'function g(m: vec3b): bool {\n  return all(m)\n}\nexport function f(a: vec3, b: vec3): bool {\n  return g((a * 2.) < (b * 2.))\n}',
    'two masks combined':
      'export function f(a: vec3, b: vec3): vec3b {\n  return (a < b) & (b > a)\n}',
    'two masks combined as the condition of select':
      'export function f(a: vec3, b: vec3): vec3 {\n  return select(a, b, (a < b) & (b > a))\n}',
    'a logical not of a mask': 'export function f(c: vec3b): vec3b {\n  return !c\n}',
    'a bitwise and': 'export function f(a: vec3u, b: vec3u): vec3u {\n  return a & b\n}',
    'a shift': 'export function f(a: vec3u, b: vec3u): vec3u {\n  return a << b\n}',
    'a complement': 'export function f(a: vec3u): vec3u {\n  return ~a\n}',
    'a power': 'export function f(a: vec3, b: vec3): vec3 {\n  return a ** b\n}',
    'a matrix times a scaled vector':
      'function g(p: vec4): vec4 {\n  return p\n}\nexport function f(m: mat4, c: vec4): vec4 {\n  return g(m * (c * 2.))\n}',
  };
  for (const [name, body] of Object.entries(cases)) {
    it(`${name}: no diagnostic at all`, () => {
      const source = `"use typeshade"\n${body}\n`;
      expect(typeScriptDiagnosticsOf(source), source).toEqual([]);
      expect(diagnosticsOf(source), source).toEqual([]);
    });
  }

  it('keeps TS2447 for a bitwise operator on two scalar booleans', () => {
    // A mask is a vector to the compiler; two scalar booleans are not, and the rule is about
    // masks only.
    const source = entry('  const k = (s < 1.) & (s > 0.)\n');
    expect(typeScriptDiagnosticsOf(source).map((x) => x.slice(0, 7))).toEqual(['TS2447:']);
  });
});

// Both halves check a `"use typeshade"` file, and a mistake both can see used to read as two
// diagnostics, one per half. The merge keeps one (`mergeDiagnostics`, Rule 12.4): the
// compiler's, which is what `compile()` and the build report, except where TypeScript names a
// spelling fix the compiler's sentence does not.
describe('one mistake reads as one diagnostic across the two halves (Rule 12.4)', () => {
  /** `body` as the body of `f(signature): ret`, or, when it declares its own functions, as the
   * whole program. */
  const fn = (body: string, signature = 'x: f32, v: vec3, w: vec2', ret = 'f32'): string =>
    body.includes('function ')
      ? `"use typeshade"\n${body}\n`
      : `"use typeshade"\nexport function f(${signature}): ${ret} {\n${body}\n}\n`;
  const shown = (source: string): string[] =>
    diagnosticsOf(source).map((d) => `${d.source} ${String(d.code)}`);

  const cases: Readonly<Record<string, readonly [string, string]>> = {
    'a write to a const (TS2588)': [fn('  const y = x\n  y = 2.\n  return y'), 'typeshade TS8005'],
    'a write to a read-only resource (TS2588)': [
      'declare const u: uniform<f32>\nexport function f(): f32 {\n  u = 2.\n  return u\n}',
      'typeshade TS8005',
    ],
    'a write to a readonly field (TS2540)': [
      'class S {\n  readonly a: f32\n}\nexport function f(s: S): f32 {\n  let t = s\n  t.a = 1.\n  return t.a\n}',
      'typeshade TS8005',
    ],
    'one argument short (TS2554)': [
      'function g(a: f32, b: f32): f32 {\n  return a + b\n}\nexport function f(x: f32): f32 {\n  return g(x)\n}',
      'typeshade TS8019',
    ],
    'one argument too many (TS2554)': [
      'function g(a: f32): f32 {\n  return a\n}\nexport function f(x: f32): f32 {\n  return g(x, x)\n}',
      'typeshade TS8019',
    ],
    'a builtin one argument short (TS2554)': [fn('  return dot(v)'), 'typeshade TS8019'],
    'a vector constructor short of components (TS2769)': [
      fn('  return vec4(v)', 'v: vec3', 'vec4'),
      'typeshade TS8019',
    ],
    'an unknown name (TS2304)': [fn('  return colr'), 'typeshade TS8022'],
    'an unknown function (TS2304)': [fn('  return foo(x)'), 'typeshade TS8004'],
    'an unknown type (TS2304)': [
      'export function f(v: vec5): f32 {\n  return 1.\n}',
      'typeshade TS8002',
    ],
    'a host API (TS2304)': [fn('  return Date.now()'), 'typeshade TS8012'],
    'a swizzle out of range (TS2339)': [fn('  return v.w'), 'typeshade TS8022'],
    'a swizzle out of range with a suggestion (TS2551)': [
      fn('  return v.xyzw', 'v: vec3', 'vec4'),
      'typeshade TS8022',
    ],
    'a field the struct does not declare (TS2339)': [
      'class S {\n  a: f32\n}\nexport function f(s: S): f32 {\n  return s.b\n}',
      'typeshade TS8022',
    ],
    'a vector declared as a scalar (TS2322)': [
      fn('  let s: f32 = v\n  return s'),
      'typeshade TS8003',
    ],
    'an argument of the wrong size to a user function (TS2345)': [
      'function g(p: vec3): vec3 {\n  return p\n}\nexport function f(w: vec2): vec3 {\n  return g(w)\n}',
      'typeshade TS8003',
    ],
    'an argument of the wrong size to a math builtin (TS2345)': [
      fn('  return cross(v, w)', 'v: vec3, w: vec2', 'vec3'),
      'typeshade TS8036',
    ],
    'the same at an overloaded builtin (TS2769)': [
      fn('  return mix(v, w, 0.5)', 'v: vec3, w: vec2', 'vec3'),
      'typeshade TS8036',
    ],
    // TypeScript fails `max` and types it `number`, so the `return` adds a TS2322 of its own.
    'a failed overload and the return it poisons (TS2769, TS2322)': [
      fn('  return max(v, w)', 'v: vec3, w: vec2', 'vec3'),
      'typeshade TS8036',
    ],
    'the same through a local declared with no type': [
      fn('  const c = max(v, w)\n  return c', 'v: vec3, w: vec2', 'vec3'),
      'typeshade TS8036',
    ],
    'a scalar where a builtin wants the vector (TS2769, TS2322)': [
      fn('  return clamp(v, 0., 1.)', 'v: vec3', 'vec3'),
      'typeshade TS8036',
    ],
    // A misspelling too: the compiler names the name it is spelled like, so there is no
    // exception for TypeScript's "Did you mean".
    'an unknown name TypeScript can correct (TS2552)': [
      fn('  return colr', 'color: f32'),
      'typeshade TS8022',
    ],
    'an unknown function TypeScript can correct (TS2552)': [
      fn('  return clmap(x, 0., 1.)'),
      'typeshade TS8004',
    ],
    'a field TypeScript can correct (TS2561)': [
      '"use typeshade"\nclass C {\n  @location(0) color: vec4;\n}\n@fragment\nexport function fs(): C {\n  return { colr: vec4(0.) };\n}',
      'typeshade TS8010',
    ],
    'a Math member TypeScript can correct (TS2551)': [
      fn('  return Math.sqr(x)'),
      'typeshade TS8022',
    ],
    'a method (TS2339)': [
      '"use typeshade"\nclass P {\n  x: f32;\n  len(): f32 {\n    return this.x;\n  }\n}\nexport function f(p: P): f32 {\n  return p.lne();\n}',
      'typeshade TS8035',
    ],
    'a name read above its declaration (TS2448)': [
      fn('  const z = q * 2.\n  const q = x\n  return z'),
      'typeshade TS8022',
    ],
    // TypeScript refuses the comparison, and the `boolean` it types it then fails the return.
    'a comparison of vectors of two sizes (TS2365, TS2322)': [
      fn('  return v < w', 'v: vec3, w: vec2', 'vec3b'),
      'typeshade TS8003',
    ],
    'a comparison of a vector and a scalar (TS2365, TS2322)': [
      fn('  return v < x', 'v: vec3, x: f32', 'vec3b'),
      'typeshade TS8003',
    ],
    'strict equality of vectors of two sizes (TS2367, TS2322)': [
      fn('  return v === w', 'v: vec3, w: vec2', 'vec3b'),
      'typeshade TS8003',
    ],
    'a logical not of a vector of floats (TS2322)': [
      fn('  return !v', 'v: vec3', 'vec3b'),
      'typeshade TS8003',
    ],
    // The compiler refuses the product, so the projection has no type to write into `t`, and
    // TypeScript's `number` for it reached the swizzle and the return.
    'the uses of a local whose product the compiler refused (TS2339, TS2322)': [
      fn('  const t = v * w\n  const u = t * 2.\n  return u.x + t.y', 'v: vec3, w: vec2'),
      'typeshade TS8003',
    ],
    'a matrix of doubles scaled by a double (TS2322)': [
      fn('  const t = m * f64(2.)\n  return t', 'm: mat3<f64>', 'mat3<f64>'),
      'typeshade TS8003',
    ],
  };
  for (const [name, [body, only]] of Object.entries(cases)) {
    it(`${name}: ${only}`, () => {
      const source = body.startsWith('"use typeshade"') ? body : fn(body);
      expect(shown(source), source).toEqual([only]);
    });
  }

  it('each half still reports on its own when the halves are read unmerged', () => {
    // The merge is the editor's view; the two checks it merges are both still run.
    const source = fn('  const y = x\n  y = 2.\n  return y');
    expect(
      diagnosticsOf(source, false)
        .map((d) => `${d.source} ${String(d.code)}`)
        .sort(),
    ).toEqual(['typescript 2588', 'typeshade TS8005']);
  });

  it('keeps two mistakes as two diagnostics', () => {
    // The write is both halves' mistake and reads once; the typo in the call only TypeScript
    // sees, since the compiler refused the statement at the write.
    expect(shown(fn('  const f = x\n  f = clmap(f, 0., 1.)\n  return f'))).toEqual([
      'typeshade TS8005',
      'typescript 2552',
    ]);
  });

  it('keeps a typo inside a call to an unknown function as its own diagnostic', () => {
    // Two mistakes, and the compiler names both, the unknown `g` and then the misspelled `colr`
    // it still lowers, so the build reports what the editor does (Rule 12.7).
    expect(shown(fn('  return g(colr)'))).toEqual(['typeshade TS8004', 'typeshade TS8022']);
  });
});

// A field that holds a function is a method to the compiler (Rule 8.16), which it builds from
// the author's nodes. The editor hands the compiler the tree TypeScript's checker binds, so
// moving a node under that method would move it out of the scope the binder gave it: the first
// version re-parented the body, and every read of a parameter or a local in it was TS2304
// "Cannot find name 'p'" in the editor while the command line compiled it clean.
describe('a field that holds a function draws no TypeScript diagnostic (Rule 8.16)', () => {
  const cases: Readonly<Record<string, string>> = {
    'an expression body': `class A { k: f32 = 1.; f = (p: f32): f32 => p * this.k }`,
    'a block body with a local': `class A { k: f32 = 1.; f = (p: f32): f32 => { const d = p * this.k; return d } }`,
    'a function expression': `class A { k: f32 = 1.; f = function (this: A, p: f32): f32 { const d = p * this.k; return d } }`,
  };
  for (const [what, cls] of Object.entries(cases)) {
    it(what, () => {
      const source = `"use typeshade"\n${cls}\nexport function g(a: A): f32 { return a.f(2.) }\n`;
      expect(diagnosticsOf(source).map((d) => `${d.source} ${d.code}: ${d.message}`)).toEqual([]);
    });
  }
});
