// GLSL and HLSL names (#218): the compiler refuses them, and the refusal names TypeShade's
// spelling as its remedy (Rule 12.1) instead of "declare it in this file". The table the
// sentences come from is held to the ambient library: every target is a name TypeShade has,
// and no source is one (Rules 2.1 and 9.6: no name is added, only a sentence).

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { FOREIGN_NAMES, foreignNameRemedy } from './foreign-names.js';
import { BUILTIN_STAGE_RULES } from './builtin-check.js';
import { SHADE_DTS } from '../../language-service/ambient.js';
import {
  ATTRIBUTE_DOCS,
  BUILTIN_DOCS,
  CONSTANT_DOCS,
  FUNCTION_DOCS,
  MATH_MEMBER_DOCS,
  TYPE_DOCS,
} from '../../language-service/docs.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

/** Every error `compile()` reports, as `<code> <message>`. */
function errors(source: string): string[] {
  return compile(`"use typeshade";\n${source}`)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code ?? ''} ${d.message}`);
}

describe('a GLSL or HLSL name is refused with TypeShade spelling as the remedy (#218)', () => {
  const rows: Readonly<Record<string, readonly [string, string]>> = {
    lerp: [
      'export function f(a: vec3, b: vec3): vec3 {\n  return lerp(a, b, 0.5);\n}',
      `${TS_CODES.UNKNOWN_FN} Unknown function "lerp". HLSL's lerp is mix here.`,
    ],
    fmod: [
      'export function f(a: f32): f32 {\n  return fmod(a, 2.);\n}',
      `${TS_CODES.UNKNOWN_FN} Unknown function "fmod". HLSL's fmod is the % operator, which ` +
        'truncates like fmod; mod() floors.',
    ],
    mul: [
      'export function f(m: mat4, v: vec4): vec4 {\n  return mul(m, v);\n}',
      `${TS_CODES.UNKNOWN_FN} Unknown function "mul". HLSL's mul is the * operator: m * v is ` +
        'a matrix-vector product.',
    ],
    float3: [
      'export function f(a: float3): f32 {\n  return 1.;\n}',
      `${TS_CODES.UNKNOWN_TYPE} Unknown type "float3". HLSL's float3 is vec3 here.`,
    ],
    gl_FragCoord: [
      '@fragment\nexport function f(): vec4 {\n  return vec4(gl_FragCoord.x);\n}',
      `${TS_CODES.UNKNOWN_NAME} Unknown identifier "gl_FragCoord". GLSL's gl_FragCoord is a ` +
        'parameter here: @builtin("position") pos: vec4.',
    ],
    // What a GLSL vertex shader ends with: an output, so a field of the entry's return.
    gl_Position: [
      '@vertex\nexport function f(): vec4 {\n  gl_Position = vec4(0.);\n  return vec4(0.);\n}',
      `${TS_CODES.UNKNOWN_NAME} Cannot assign to unknown name "gl_Position". GLSL's ` +
        'gl_Position is a field of the entry\'s return here: @builtin("position") pos: vec4.',
    ],
    numthreads: [
      '@numthreads([64])\nexport function f(): void {}',
      `${TS_CODES.ATTRIBUTE_NAME} Unknown attribute "@numthreads". HLSL's numthreads is ` +
        '@compute here.',
    ],
  };
  for (const [name, [source, sentence]] of Object.entries(rows)) {
    it(`${name}: one diagnostic, naming the TypeShade spelling`, () => {
      expect(errors(source)).toEqual([sentence]);
    });
  }

  it('keeps the sentence a name the table does not have always had', () => {
    // The callee's name is quoted, as TS8002 and TS8022 quote theirs, and not the whole call.
    expect(errors('export function f(a: f32): f32 {\n  return myHelper(a);\n}')).toEqual([
      `${TS_CODES.UNKNOWN_FN} Unknown function "myHelper". Declare it in this file, or import ` +
        'it from another shader module.',
    ]);
    expect(errors('export function f(a: f32): f32 {\n  return colr;\n}')).toEqual([
      `${TS_CODES.UNKNOWN_NAME} Unknown identifier "colr".`,
    ]);
  });

  it('lets a function the file declares under a foreign name win (Rule 9.5)', () => {
    expect(
      errors(
        'function lerp(a: f32, b: f32, t: f32): f32 {\n  return a + (b - a) * t;\n}\n' +
          'export function f(a: f32): f32 {\n  return lerp(a, 1., 0.5);\n}',
      ),
    ).toEqual([]);
  });
});

/** Every name the ambient library declares at its top level. */
function ambientNames(): ReadonlySet<string> {
  const names = new Set<string>();
  const file = ts.createSourceFile('shade.d.ts', SHADE_DTS, ts.ScriptTarget.Latest, true);
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.add(d.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text);
    }
  }
  return names;
}

describe('FOREIGN_NAMES translates only to names TypeShade has, and only names it does not', () => {
  const declared = ambientNames();
  const TABLES = [
    TYPE_DOCS,
    ATTRIBUTE_DOCS,
    BUILTIN_DOCS,
    FUNCTION_DOCS,
    CONSTANT_DOCS,
    MATH_MEMBER_DOCS,
  ];
  const TABLE_OF_KIND: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    function: FUNCTION_DOCS,
    type: TYPE_DOCS,
    'address space': TYPE_DOCS,
    attribute: ATTRIBUTE_DOCS,
    builtin: BUILTIN_DOCS,
  };

  it('holds the 112 rows it started with', () => {
    expect(Object.keys(FOREIGN_NAMES)).toHaveLength(112);
  });

  it('names no source TypeShade declares, so none can shadow a real name', () => {
    // `mod`, `saturate` and `clamp` are TypeShade's own; a translation for one of them would
    // replace its meaning with another language's.
    expect(Object.keys(FOREIGN_NAMES).filter((name) => declared.has(name))).toEqual([]);
    expect(
      Object.keys(FOREIGN_NAMES).filter((name) => TABLES.some((t) => Object.hasOwn(t, name))),
    ).toEqual([]);
  });

  it('names a target of its own kind that TypeShade has, so a remedy never fails in turn', () => {
    const wrong = Object.entries(FOREIGN_NAMES)
      .filter(([, row]) => row.name !== undefined)
      .filter(([, row]) => !Object.hasOwn(TABLE_OF_KIND[row.kind] ?? {}, row.name!))
      .map(([name, row]) => `${name} -> ${row.name!} (${row.kind})`);
    expect(wrong).toEqual([]);
    // A row with no target says what to write instead, and only an operator or a statement
    // lacks one.
    for (const [name, row] of Object.entries(FOREIGN_NAMES)) {
      if (row.name === undefined) {
        expect(row.note, name).toBeDefined();
        expect(['operator', 'statement'], name).toContain(row.kind);
      }
    }
  });

  it('gives each built-in value a direction its WGSL id has', () => {
    for (const [name, row] of Object.entries(FOREIGN_NAMES)) {
      if (row.kind !== 'builtin') continue;
      const directions = new Set((BUILTIN_STAGE_RULES[row.name!] ?? []).map((r) => r.direction));
      if (row.io === 'either') {
        expect([...directions].sort(), name).toEqual(['input', 'output']);
      } else {
        expect(directions.has(row.io!), `${name} is an ${String(row.io)} of ${row.name!}`).toBe(
          true,
        );
      }
    }
  });

  it('phrases every row as one sentence', () => {
    for (const name of Object.keys(FOREIGN_NAMES)) {
      const remedy = foreignNameRemedy(name)!;
      expect(remedy, name).toMatch(/^(GLSL|HLSL)'s /);
      expect(remedy.endsWith('.'), name).toBe(true);
      expect(remedy, name).not.toContain('`');
    }
  });
});

describe('the editor shows the compiler sentence for a foreign name, and keeps a typo fix', () => {
  const shown = (source: string): string[] => {
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', `"use typeshade";\n${source}`);
    return service.getDiagnostics('a.ts').map((d) => `${d.source} ${String(d.code)} ${d.message}`);
  };

  it("drops TypeScript's nearest-spelling guess for fmod, which would be mod", () => {
    // TS2552 says "Did you mean 'mod'?", and mod floors where fmod truncates: the one
    // suggestion that compiles and gives another answer for a negative operand.
    expect(shown('export function f(a: f32): f32 {\n  return fmod(a, 2.);\n}')).toEqual([
      'typeshade TS8004 Unknown function "fmod". HLSL\'s fmod is the % operator, which ' +
        'truncates like fmod; mod() floors.',
    ]);
  });

  it('keeps TypeScript spelling fix for a name that is only misspelled', () => {
    expect(shown('export function f(x: f32): f32 {\n  return clmap(x, 0., 1.);\n}')).toEqual([
      "typescript 2552 Cannot find name 'clmap'. Did you mean 'clamp'?",
    ]);
  });
});
