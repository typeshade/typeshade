import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse } from '../../../core/testing/both-halves.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { checkMathArgs, mathTakesElem } from './math-args.js';

const fn = (params: string, ret: string, body: string): string =>
  `"use typeshade"\nexport function f(${params}): ${ret} {\n  return ${body}\n}\n`;

const CODE = 'TS8036';

describe('the fix a refusal of math arguments offers', () => {
  it.each([
    [
      'names an emulated-double vector by its own spelling in a cast',
      fn('a: vec3, b: vec3d', 'f32', 'dot(a, b)'),
      'dot takes arguments of one type; the first is vec3, this one vec3f64. Cast one side: vec3(x) or vec3f64(x).',
    ],
    [
      'casts only the argument that the builtin cannot take, to the kind of the first, for a vector',
      fn('a: vec3, n: vec3i', 'vec3', 'atan2(a, n)'),
      'atan takes arguments of one type; the first is vec3, this one vec3i. Cast this one: vec3(n).',
    ],
    [
      'casts only the argument that the builtin cannot take, to the kind of the first, for a scalar',
      fn('a: f32, n: i32', 'f32', 'atan2(a, n)'),
      'atan takes arguments of one type; the first is f32, this one i32. Cast this one: f32(n).',
    ],
    [
      'offers no cast to or from a bool',
      fn('a: f32, b: bool', 'f32', 'max(a, b)'),
      'max takes arguments of one type; the first is f32, this one bool.',
    ],
  ])('%s', (_name, source, sentence) => {
    bothRefuse(source, CODE, sentence);
  });
});

describe('the emulated-double arm of the math argument checks', () => {
  it.each([
    [
      'a reduction takes a vector of doubles of the same width, not an f32 vector',
      fn('a: vec3d, b: vec3', 'f64', 'dot(a, b)'),
      'dot reduces two vectors of emulated doubles of one width; the first is vec3f64, this one vec3.',
    ],
    [
      'a reduction takes a vector of doubles, not a scalar double',
      fn('a: vec3d, b: f64', 'f64', 'dot(a, b)'),
      'dot reduces two vectors of emulated doubles of one width; the first is vec3f64, this one f64.',
    ],
    [
      'a componentwise twin refuses a vector of f32 and says how to build the vector of doubles',
      fn('a: vec3d, b: vec3', 'vec3d', 'max(a, b)'),
      'max takes arguments of one type; the first is vec3f64, this one vec3. A vector of f32 is not widened to a vector of doubles — build it with vec3f64(...), or narrow the first argument with vec3(v).',
    ],
  ])('%s', (_name, source, sentence) => {
    bothRefuse(source, CODE, sentence);
  });

  it.each([
    [
      'a scalar double broadcast across a vector of doubles',
      'a: vec3d, b: f64',
      'vec3d',
      'min(a, b)',
    ],
    ['an f32 scalar widened beside a vector of doubles', 'a: vec3d, b: f32', 'vec3d', 'max(a, b)'],
    ['an f32 scalar widened beside a scalar double', 'a: f64, b: f32', 'f64', 'min(a, b)'],
  ])('takes %s', (_name, params, ret, body) => {
    expect(bothHalves(fn(params, ret, body)).compiler).toEqual([]);
  });

  it('refuses an offset of extractBits that is not a scalar u32', () => {
    bothRefuse(
      fn('x: i32, o: vec2u, c: u32', 'i32', 'extractBits(x, o, c)'),
      CODE,
      'extractBits takes a u32 offset and count; got vec2u.',
    );
  });
});

describe('the table of math argument rules', () => {
  it('says which element kinds a builtin has a form for, and takes a name with no rule', () => {
    expect(mathTakesElem('pow', 'i32')).toBe(false);
    expect(mathTakesElem('min', 'i32')).toBe(true);
    expect(mathTakesElem('sin', 'f64')).toBe(true);
    expect(mathTakesElem('no_such_builtin', 'bool')).toBe(true);
  });

  it('accepts a call with no argument and says nothing', () => {
    const sourceFile = ts.createSourceFile('a.ts', 'dot()', ts.ScriptTarget.ESNext, true);
    const call = (sourceFile.statements[0] as ts.ExpressionStatement)
      .expression as ts.CallExpression;
    const diagnostics: TsCompilerDiagnostic[] = [];
    expect(checkMathArgs('dot', 'dot', [], call, sourceFile, diagnostics)).toBe(true);
    expect(diagnostics).toEqual([]);
  });
});
