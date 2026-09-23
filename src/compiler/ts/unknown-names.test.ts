// Verifies: Rule 12.1 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 12.6 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 7.7 (docs/language-design.md; traced in reqs/).

// A name the compiler cannot find names the fix itself, at every place a name is written, in one
// order: TypeShade's spelling of a GLSL or HLSL name, then the name of the same kind it is spelled
// like, then the place's own remedy (Rule 12.1). The build prints the sentence the editor shows,
// so a coding agent that reads only `compile()` gets the fix too (Rule 12.7).
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSources } from './module.js';
import { TS_CODES } from './codes.js';
import { didYouMean, similarName, unknownNameRemedy } from './unknown-names.js';

const errorsOf = (src: string): string[] =>
  compile(`"use typeshade";\n${src}\n`)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

/** The one error a program draws, with the text its span covers. */
function onlyError(src: string): { readonly line: string; readonly at: string } {
  const text = `"use typeshade";\n${src}\n`;
  const errors = compile(text).diagnostics.filter((d) => d.category === 'error');
  expect(errors.map((d) => `${d.code} ${d.message}`)).toHaveLength(1);
  const d = errors[0]!;
  return { line: `${d.code} ${d.message}`, at: text.slice(d.start, d.start + d.length) };
}

describe("the spelling rule is TypeScript's, with a swap of two letters as one edit", () => {
  it('suggests what TypeScript suggests', () => {
    expect(similarName('clmap', [['clamp', 'mix']])).toBe('clamp');
    expect(similarName('albdo', [['albedo']])).toBe('albedo');
    expect(similarName('GAMA', [['GAMMA']])).toBe('GAMMA');
    expect(similarName('shdae', [['shade', 'shadow']])).toBe('shade');
    expect(similarName('Clamp', [['clamp']])).toBe('clamp');
  });

  it('counts two swapped letters as one edit, which TypeScript misses in a short name', () => {
    expect(similarName('tiem', [['time']])).toBe('time');
    expect(similarName('vce3', [['vec3']])).toBe('vec3');
  });

  it('suggests nothing that is not close', () => {
    expect(similarName('colr', [['colour']])).toBeUndefined();
    expect(similarName('abc', [['xyz']])).toBeUndefined();
    // A name shorter than three letters only for a change of case, as TypeScript's rule has it.
    expect(similarName('yy', [['y']])).toBeUndefined();
    expect(similarName('X', [['x']])).toBe('x');
  });

  it('never suggests the name itself', () => {
    expect(similarName('clamp', [['clamp']])).toBeUndefined();
  });

  it('answers from the innermost scope that has a match, as TypeScript does', () => {
    expect(similarName('valeu', [['value'], ['valve']])).toBe('value');
    expect(similarName('valeu', [['other'], ['value']])).toBe('value');
  });

  it('names a GLSL or HLSL name by TypeShade spelling before any guess by letters', () => {
    // `fmod` is one letter from `mod`, and `mod` floors where `fmod` truncates (#218).
    expect(unknownNameRemedy('fmod', [['mod']])).toBe(
      "HLSL's fmod is the % operator, which truncates like fmod; mod() floors.",
    );
    expect(unknownNameRemedy('clmap', [['clamp']])).toBe(didYouMean('clamp'));
    expect(unknownNameRemedy('zzz', [['clamp']])).toBeUndefined();
  });
});

describe('every place a name is written names the one it is spelled like (Rule 12.1)', () => {
  const cases: Readonly<Record<string, readonly [string, string, string]>> = {
    'a value': [
      'export function f(albedo: f32): f32 {\n  return albdo;\n}',
      `${TS_CODES.UNKNOWN_NAME} Unknown identifier "albdo". Did you mean "albedo"?`,
      'albdo',
    ],
    'a module const': [
      'const GAMMA = 2.2;\nexport function f(a: f32): f32 {\n  return pow(a, GAMA);\n}',
      `${TS_CODES.UNKNOWN_NAME} Unknown identifier "GAMA". Did you mean "GAMMA"?`,
      'GAMA',
    ],
    'a builtin function': [
      'export function f(a: f32): f32 {\n  return clmap(a, 0., 1.);\n}',
      `${TS_CODES.UNKNOWN_FN} Unknown function "clmap". Did you mean "clamp"?`,
      'clmap',
    ],
    'a function the file declares': [
      'function shade(a: f32): f32 {\n  return a;\n}\nexport function f(a: f32): f32 {\n  return shdae(a);\n}',
      `${TS_CODES.UNKNOWN_FN} Unknown function "shdae". Did you mean "shade"?`,
      'shdae',
    ],
    'a builtin type': [
      'export function f(a: vce3): f32 {\n  return 1.;\n}',
      `${TS_CODES.UNKNOWN_TYPE} Unknown type "vce3". Did you mean "vec3"?`,
      'vce3',
    ],
    'a struct type': [
      'class Light {\n  pos: vec3;\n}\nexport function f(l: Lihgt): f32 {\n  return 1.;\n}',
      `${TS_CODES.UNKNOWN_TYPE} Unknown type "Lihgt". Did you mean "Light"?`,
      'Lihgt',
    ],
    'a field': [
      'class Frame {\n  time: f32;\n}\ndeclare const frame: uniform<Frame>;\nexport function f(): f32 {\n  return frame.tiem;\n}',
      `${TS_CODES.UNKNOWN_NAME} Unknown field "tiem" on Frame. Did you mean "time"?`,
      'tiem',
    ],
    'a field of a struct literal': [
      'class Color {\n  @location(0) color: vec4;\n}\n@fragment\nexport function fs(): Color {\n  return { colr: vec4(0.) };\n}',
      `${TS_CODES.STRUCT_FIELD} Struct Color has no field "colr". Did you mean "color"?`,
      'colr',
    ],
    'a Math member, called': [
      'export function f(a: f32): f32 {\n  return Math.sqr(a);\n}',
      `${TS_CODES.UNKNOWN_NAME} "Math.sqr(...)" is not a TypeShade Math alias. Did you mean "sqrt"?`,
      'sqr',
    ],
    'a Math member, read': [
      'export function f(a: f32): f32 {\n  return a * Math.LOG2EE;\n}',
      `${TS_CODES.UNKNOWN_NAME} "Math.LOG2EE" is not a TypeShade alias. Did you mean "LOG2E"?`,
      'LOG2EE',
    ],
    'a method': [
      'class P {\n  x: f32;\n  len(): f32 {\n    return this.x;\n  }\n}\nexport function f(p: P): f32 {\n  return p.lne();\n}',
      `${TS_CODES.CLASS_MEMBER} "P" has no method "lne". Did you mean "len"?`,
      'lne',
    ],
    'a static function': [
      'class P {\n  x: f32;\n  static make(): f32 {\n    return 1.;\n  }\n}\nexport function f(): f32 {\n  return P.mkae();\n}',
      `${TS_CODES.CLASS_MEMBER} "P" has no static function "mkae". Did you mean "make"?`,
      'mkae',
    ],
    'a static field': [
      'class P {\n  x: f32;\n  static readonly SCALE: f32 = 2.;\n}\nexport function f(): f32 {\n  return P.SCALEE;\n}',
      `${TS_CODES.UNKNOWN_NAME} "P" has no static field "SCALEE". Did you mean "SCALE"?`,
      'SCALEE',
    ],
    'an enum member': [
      'enum Mode {\n  Add,\n  Mul,\n}\nexport function f(): i32 {\n  return Mode.Mull;\n}',
      `${TS_CODES.UNKNOWN_NAME} "Mode" has no member "Mull". Did you mean "Mul"?`,
      'Mull',
    ],
    'a function of a namespace': [
      'namespace N {\n  export function blur(a: f32): f32 {\n    return a;\n  }\n}\nexport function f(a: f32): f32 {\n  return N.bulr(a);\n}',
      `${TS_CODES.CLASS_MEMBER} "N" has no function "bulr". Did you mean "blur"?`,
      'bulr',
    ],
    'an assignment target': [
      'export function f(a: f32): f32 {\n  let total = 0.;\n  totl = a;\n  return total;\n}',
      `${TS_CODES.UNKNOWN_NAME} Cannot assign to unknown name "totl". Did you mean "total"?`,
      'totl',
    ],
    'the root of an assignment target': [
      'class S {\n  a: f32;\n}\nexport function f(): f32 {\n  let thing = new S();\n  thng.a = 1.;\n  return thing.a;\n}',
      `${TS_CODES.UNKNOWN_NAME} Cannot assign to unknown name "thng". Did you mean "thing"?`,
      'thng',
    ],
    'a field a pattern reads': [
      'class Frame {\n  time: f32;\n}\ndeclare const frame: uniform<Frame>;\nexport function f(): f32 {\n  const { tiem } = frame;\n  return tiem;\n}',
      `${TS_CODES.UNKNOWN_NAME} "Frame" has no field "tiem". Did you mean "time"?`,
      'tiem',
    ],
    'an attribute': [
      '@fragmnet\nexport function f(): vec4 {\n  return vec4(0.);\n}',
      `${TS_CODES.ATTRIBUTE_NAME} Unknown attribute "@fragmnet". Did you mean "@fragment"?`,
      '@fragmnet',
    ],
    'a function handed to an array method': [
      'function square(x: f32): f32 {\n  return x * x;\n}\nexport function f(xs: array<f32, 4>): array<f32, 4> {\n  return xs.map(sqaure);\n}',
      `${TS_CODES.TYPE_MISMATCH} "sqaure" is no function this file declares, and "xs.map" takes one. Did you mean "square"?`,
      'sqaure',
    ],
    'a builtin value': [
      '@fragment\nexport function f(@builtin("positon") p: vec4): vec4 {\n  return p;\n}',
      `${TS_CODES.BUILTIN_NAME} Unknown builtin "positon". Did you mean "position"?`,
      '"positon"',
    ],
  };
  for (const [what, [src, line, at]] of Object.entries(cases)) {
    it(what, () => {
      const got = onlyError(src);
      expect(got.line).toBe(line);
      // On the name itself, as TypeScript's own report is, so the two halves of the editor pair
      // exactly and a fix can replace the span (Rule 12.4).
      expect(got.at).toBe(at);
    });
  }

  it('an extension', () => {
    expect(
      errorsOf(
        '"enable subgrops";\n@fragment\nexport function fs(): vec4 {\n  return vec4(0.);\n}',
      ),
    ).toEqual([
      `${TS_CODES.ENABLE_NAME} Unknown WGSL extension "subgrops". Did you mean "subgroups"?`,
    ]);
  });

  it('an import from another shader module', () => {
    const r = compileTsSources(
      [
        {
          fileName: 'light.shade.ts',
          source: '"use typeshade";\nexport function luminance(c: vec3): f32 {\n  return c.x;\n}\n',
        },
        {
          fileName: 'main.shade.ts',
          source:
            '"use typeshade";\nimport { luminace } from "./light.shade";\n@fragment\nexport function fs(): vec4 {\n  return vec4(luminace(vec3(1.)));\n}\n',
        },
      ],
      'main.shade.ts',
    );
    expect(r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toContain(
      '"light.shade.ts" has no function "luminace". Did you mean "luminance"?',
    );
  });
});

describe('the remedy keeps its order', () => {
  it('names TypeShade spelling of a GLSL or HLSL name, not the builtin it is spelled like', () => {
    expect(errorsOf('export function f(a: f32): f32 {\n  return fmod(a, 2.);\n}')).toEqual([
      `${TS_CODES.UNKNOWN_FN} Unknown function "fmod". HLSL's fmod is the % operator, which truncates like fmod; mod() floors.`,
    ]);
  });

  it('keeps the place own remedy for a name like nothing', () => {
    expect(errorsOf('export function f(a: f32): f32 {\n  return zork(a);\n}')).toEqual([
      `${TS_CODES.UNKNOWN_FN} Unknown function "zork". Declare it in this file, or import it from another shader module.`,
    ]);
  });

  it('says a name read above its declaration is out of order, not misspelled', () => {
    // TypeScript's TS2448. The name is declared, so a guess would send the author elsewhere.
    expect(
      errorsOf(
        'export function f(x: f32): f32 {\n  const z = value * 2.;\n  const value = x;\n  return z;\n}',
      ),
    ).toEqual([
      `${TS_CODES.UNKNOWN_NAME} "value" is read before its declaration. Declare it above this line.`,
    ]);
  });

  it('says discard is a statement when it is called', () => {
    expect(
      errorsOf('@fragment\nexport function fs(): vec4 {\n  discard();\n  return vec4(0.);\n}'),
    ).toEqual([
      `${TS_CODES.UNKNOWN_FN} "discard" is a statement, not a function. Write it without the parentheses: "discard;".`,
    ]);
  });
});

describe('a call of an unknown function still reports what its arguments get wrong', () => {
  it('names both mistakes in g(colr), so the build reports what the editor does', () => {
    expect(errorsOf('export function f(color: f32): f32 {\n  return g(colr);\n}')).toEqual([
      `${TS_CODES.UNKNOWN_FN} Unknown function "g". Declare it in this file, or import it from another shader module.`,
      `${TS_CODES.UNKNOWN_NAME} Unknown identifier "colr". Did you mean "color"?`,
    ]);
  });

  it('leaves a function argument alone, whose fate is the unknown callee to decide', () => {
    expect(errorsOf('export function f(a: f32): f32 {\n  return g((x: f32) => x * a);\n}')).toEqual(
      [
        `${TS_CODES.UNKNOWN_FN} Unknown function "g". Declare it in this file, or import it from another shader module.`,
      ],
    );
  });
});

describe('a type declared nowhere is refused, not emitted as a struct (Rule 12.6)', () => {
  // A capitalized name used to become a struct of that name whether or not one existed, so each
  // of these compiled in silence and died at Tint on a type the author never declared.
  const cases: Readonly<Record<string, string>> = {
    'a parameter': 'export function f(l: Lihgt): f32 {\n  return 1.;\n}',
    'a binding':
      'declare const frame: uniform<Frmae>;\nexport function f(): f32 {\n  return 1.;\n}',
    'a return type': '@vertex\nexport function vs(): VsOt {\n  return { pos: vec4(0.) };\n}',
    'a local': 'export function f(a: f32): f32 {\n  const v: Vec3 = vec3(a);\n  return v.x;\n}',
  };
  for (const [what, src] of Object.entries(cases)) {
    it(what, () => {
      const errors = errorsOf(src);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatch(new RegExp(`^${TS_CODES.UNKNOWN_TYPE} Unknown type "`));
    });
  }

  it('keeps a class declared below its use, and a type parameter, as the types they are', () => {
    expect(
      errorsOf('export function f(l: Light): f32 {\n  return l.i;\n}\nclass Light {\n  i: f32;\n}'),
    ).toEqual([]);
    expect(
      errorsOf(
        'class Box<T> {\n  v: T;\n}\nexport function f(b: Box<f32>): f32 {\n  return b.v;\n}',
      ),
    ).toEqual([]);
  });
});
