import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../core/testing/both-halves.js';
import { analyzeSourceFile, createTypeshadeLanguageServiceWith } from './service.js';

const FS = (decl: string, body: string): string => `"use typeshade"
${decl}
@fragment export function fs(uv: location<0, vec2>): vec4 {
${body}
}
`;

const typeScriptCodesOf = (source: string): string[] => {
  const service = createTypeshadeLanguageServiceWith({}, analyzeSourceFile, { merge: false });
  service.openDocument('a.ts', source);
  return service
    .getDiagnostics('a.ts')
    .filter((d) => d.source === 'typescript')
    .map((d) => `TS${String(d.code)}`);
};

const STRING_HAS_NO_GPU_FORM =
  'A string has no GPU representation: there is nothing for it to be at run time, and no instruction takes one. Text that picks between cases is a key type, a union of string literals the GPU holds as ids, or an enum; text a human reads belongs on the host.';

const SCALAR_BESIDE_VECTOR =
  'A vector combines with a scalar of its element type only through + - * / %; splat the scalar with vec3(x) to get a vector.';

describe('an operand that is not a vector keeps the TypeScript report on its side', () => {
  it('keeps TS2362 for a string on the left of a vector', () => {
    const source = FS('', '  const v = vec3(1.);\n  return vec4("x" * v, 1.);');
    expect(typeScriptCodesOf(source)).toEqual(['TS2362']);
    expect(bothHalves(source).editor).toEqual([
      "typescript 2362: The left-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.",
      `typeshade TS8099: ${STRING_HAS_NO_GPU_FORM}`,
    ]);
  });
});

describe('a comparison draws its TS2365 when the operands do not compare', () => {
  it('keeps TS2365 for a vector against a scalar', () => {
    const source = FS('', '  const a = vec3(1.);\n  const c = a < 1.;\n  return vec4(1.);');
    expect(typeScriptCodesOf(source)).toEqual(['TS2365']);
    bothRefuse(
      source,
      'TS8003',
      `Type mismatch: cannot compare vec3 and f32. ${SCALAR_BESIDE_VECTOR}`,
    );
  });

  it('keeps TS2365 for vectors of two sizes', () => {
    const source = FS(
      '',
      '  const a = vec3(1.); const b = vec2(1.);\n  const c = a < b;\n  return vec4(1.);',
    );
    expect(typeScriptCodesOf(source)).toEqual(['TS2365']);
    bothRefuse(
      source,
      'TS8003',
      'Type mismatch: cannot compare vec3 and vec2. Vectors must have the same size.',
    );
  });
});

describe('^ on booleans is dropped for a vector of bools and kept for a scalar bool', () => {
  it('keeps TS2447 for two scalar bools', () => {
    const source = FS(
      '',
      '  const a = true; const b = false;\n  const c = a ^ b;\n  return vec4(1.);',
    );
    expect(typeScriptCodesOf(source)).toEqual(['TS2447']);
    bothRefuse(
      source,
      'TS8003',
      "Cannot ^ bool: WGSL's ^ takes integers, not a bool. Write a !== b, which is the same.",
    );
  });

  it('drops TS2447 for two masks', () => {
    const source = FS(
      '',
      '  const a = vec3(1.);\n  const c = (a < a) ^ (a < a);\n  return vec4(1.);',
    );
    expect(typeScriptCodesOf(source)).toEqual([]);
  });
});

describe('a scalar assigned to a vector keeps TS2322', () => {
  it('keeps the TypeScript report beside the compiler sentence', () => {
    const source = FS('', '  const w: vec3 = 1.;\n  return vec4(w, 1.);');
    expect(typeScriptCodesOf(source)).toEqual(['TS2322']);
    bothRefuse(
      source,
      'TS8003',
      `Type mismatch: cannot let/const w vec3 and f32. ${SCALAR_BESIDE_VECTOR}`,
    );
  });
});

describe('a failed call inside vector arithmetic keeps its own report', () => {
  it('keeps TS2769 on the inner max whose arguments disagree', () => {
    const source = FS(
      '',
      '  const a = vec3(1.); const c = vec2(1.);\n  return vec4(normalize(max(a, c) * 2.), 1.);',
    );
    expect(typeScriptCodesOf(source)).toEqual(['TS2769']);
    bothRefuse(
      source,
      'TS8036',
      'max takes arguments of one type; the first is vec3, this one vec2. Give the vectors one size.',
    );
  });
});

describe('the _ of a phony assignment is dropped only where the compiler lowers one', () => {
  const F32 = 'function f(x: f32): f32 {\n  return x;\n}';

  it('keeps TS2304 on the _ of a parenthesized statement', () => {
    const source = FS(F32, '  (_ = f(1.));\n  return vec4(1.);');
    expect(typeScriptCodesOf(source)).toEqual(['TS2304']);
    expect(bothHalves(source).editor).toEqual([
      'typeshade TS8099: Unsupported expression statement "(_ = f(1.));".',
      "typescript 2304: Cannot find name '_'.",
    ]);
  });

  it('keeps TS2304 on the _ in the body of an arrow that returns a value', () => {
    const source = FS(F32, '  const g = (x: f32): f32 => _ = f(x);\n  return vec4(1.);');
    expect(typeScriptCodesOf(source)).toEqual(['TS2304']);
  });

  it('drops TS2304 on the _ in the body of an arrow with no annotation', () => {
    const source = FS(F32, '  const g = (x: f32) => _ = f(x);\n  g(1.);\n  return vec4(1.);');
    expect(typeScriptCodesOf(source)).toEqual([]);
    bothTake(source);
  });
});
