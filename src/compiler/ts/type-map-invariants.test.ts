import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { matT, vec2f64T, vec2fT } from '../../core/ir/types.js';
import { authorTypeName } from './type-map.js';

const FRAGMENT = (decl: string, body: string): string => `"use typeshade"
${decl}
@fragment export function fs(uv: location<0, vec2>): vec4 {
${body}
}
`;

const annotated = (type: string, decl = ''): string =>
  FRAGMENT(decl, `  let v: ${type} = undefined as any;\n  return vec4(1.);`);

const refusal = (sentence: string): string[] => [sentence];

describe('the name a refusal quotes for a type', () => {
  it('is the first key of the map that names the type', () => {
    expect(authorTypeName(vec2fT)).toBe('vec2');
    expect(authorTypeName(vec2f64T)).toBe('vec2f64');
    expect(authorTypeName(matT(3, 3))).toBe('mat3x3');
  });
});

describe('a type alias that is not an object type', () => {
  it('names its first declaration where a name is declared twice', () => {
    const { result, editor } = bothHalves(
      FRAGMENT('type M = f32;\ntype M = i32;', '  let m: M = 1.;\n  return vec4(m * 0.5);'),
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.wgsl).toContain('var m: f32 = 1.0;');
    expect(editor.every((line) => line.startsWith('typescript 2300'))).toBe(true);
  });

  it('is refused with the chain from the name that closes the cycle', () => {
    const halves = bothHalves(annotated('C', 'type C = A;\ntype A = B;\ntype B = A;'));
    expect(halves.compiler).toEqual(
      refusal(
        'typeshade TS8002: Type alias "A" is defined in terms of itself (A -> B -> A), so it names no type.',
      ),
    );
    expect(halves.editor).toContain(halves.compiler[0]);
  });

  it('is left to the generic refusal when it takes a type parameter', () => {
    bothRefuse(
      annotated('Id<f32>', 'type Id<T> = T;'),
      'TS8002',
      'Type arguments are not supported yet (got "Id<...>").',
    );
  });
});

describe('a generic type alias written without its type argument', () => {
  it('names a struct of its own name, not its target', () => {
    const halves = bothHalves(FRAGMENT('type Id<T> = T;', '  let v: Id = 1.;\n  return vec4(1.);'));
    const sentence =
      'typeshade TS8003: Type mismatch: cannot let/const v Id and f32. Types must match.';
    expect(halves.compiler).toEqual([sentence]);
    expect(halves.editor).toContain(sentence);
  });
});

describe('the length of an array type', () => {
  const NOT_A_LIST = (n: string): string =>
    `array<T, ${n}> is not a list. A list's length is a whole number of 1 or more; a list whose ` +
    'length the shader does not know is array<T> in storage.';

  for (const n of ['0', '-1', '1.5']) {
    it(`refuses a length of ${n} in both halves`, () => {
      bothRefuse(annotated(`array<f32, ${n}>`), 'TS8002', NOT_A_LIST(n));
    });
  }

  it('takes a length of 1', () => {
    bothTake(FRAGMENT('', '  const a: array<f32, 1> = [1.];\n  return vec4(a[0]);'));
  });
});

describe('a type that no value of a shader has', () => {
  it('refuses a function type held as a value, in both halves', () => {
    const text = '(a: f32) => f32';
    bothRefuse(
      annotated(text),
      'TS8002',
      `"${text}" is a function type, and nothing a shader holds is a function: a function ` +
        `takes one as a parameter, "f: ${text}", and a call hands it a function by its name ` +
        'or as an arrow function written there (Rule 8.18).',
    );
  });

  it('refuses a tuple of several types and says what to declare', () => {
    bothRefuse(
      annotated('[f32, i32]'),
      'TS8002',
      '"[f32, i32]" holds a f32 and a i32. A list of one type is array<T, N>; a list of several ' +
        'is a struct, so declare one with a field per element and return that.',
    );
  });

  it('takes a tuple of one type as a list of that type', () => {
    bothTake(FRAGMENT('', '  const a: [f32, f32] = [1., 2.];\n  return vec4(a[0], a[1], 0., 1.);'));
  });

  it('refuses a union of different types', () => {
    bothRefuse(
      annotated('f32 | vec2'),
      'TS8002',
      'A union is more than one type and a GPU value has exactly one, so "f32 | vec2" would have ' +
        'to be f32 in one place and vec2 in another. Write one function per type.',
    );
  });
});

describe('a handle type', () => {
  it('takes no type argument, a depth texture included', () => {
    const halves = bothHalves(
      FRAGMENT('declare const t: texture_depth_2d<f32>;', '  return vec4(1.);'),
    );
    const sentence = 'typeshade TS8002: texture_depth_2d takes no type argument.';
    expect(halves.compiler).toEqual([sentence]);
    expect(halves.editor).toContain(sentence);
  });
});

describe('a matrix type written with an element type', () => {
  it('refuses an integer element in both halves', () => {
    bothRefuse(
      annotated('mat3x3<i32>'),
      'TS8002',
      'mat3x3 is floating-point only (mat3x3<f32>). WGSL gives matCxR<T> only f32, f16 and ' +
        'AbstractFloat (wgsl.txt:4621), and GLSL ES 3.00 has no integer matrix either.',
    );
  });

  it('refuses a non-square matrix of doubles in both halves', () => {
    const halves = bothHalves(annotated('mat2x3<f64>'));
    const sentence =
      'typeshade TS8027: mat2x3<f64> has no emulated-double form: the fp64 pass carries a square ' +
      'matrix of doubles only (mat2, mat3, mat4). Declare it mat2x3 and narrow, or use a square shape.';
    expect(halves.compiler).toEqual([sentence]);
    expect(halves.editor).toContain(sentence);
  });
});
