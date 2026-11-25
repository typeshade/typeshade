import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../core/testing/both-halves.js';
import ts from 'typescript';
import {
  ERASING_OPERATORS,
  ERASING_UNARY_OPERATORS,
  Projection,
  planInsertions,
} from './projection.js';

const insertions = (src: string): string[] =>
  planInsertions(src, 'a.shade.ts').map((i) => `${src.slice(i.at - 8, i.at)}|${i.text}`);

const arithmetic = (body: string): string[] => {
  const src = `"use typeshade";
export function f(a: vec3, b: vec3, vu: vec3u): f32 {
${body}
  return 0;
}
`;
  return planInsertions(src, 'a.shade.ts').map((i) => `${src.slice(i.at - 1, i.at)}${i.text}`);
};

describe('an operator that erases a vector type is read as one on both halves', () => {
  it('writes the type of a declaration from every arithmetic, bitwise and shift operator', () => {
    expect(arithmetic('  const r = a - b;')).toEqual(['r: vec3']);
    expect(arithmetic('  const r = a / b;')).toEqual(['r: vec3']);
    expect(arithmetic('  const r = a % b;')).toEqual(['r: vec3']);
    expect(arithmetic('  const r = vu >> vu;')).toEqual(['r: vec3u']);
    expect(arithmetic('  const r = vu | vu;')).toEqual(['r: vec3u']);
    expect(arithmetic('  const r = vu ^ vu;')).toEqual(['r: vec3u']);
  });

  it('takes a compound assignment of a vector without the TypeScript error', () => {
    for (const op of ['+=', '-=', '*=', '/=', '%=']) {
      bothTake(`"use typeshade";
export function f(b: vec3): vec3 {
  let x = vec3(1.);
  x ${op} b;
  return x;
}
`);
    }
  });

  it('drops the TypeScript error of a compound bitwise operator, and keeps the compiler refusal', () => {
    for (const op of ['&=', '|=', '^=', '<<=', '>>=']) {
      bothRefuse(
        `"use typeshade";
export function f(vu: vec3u): vec3u {
  let u = vu;
  u ${op} vu;
  return u;
}
`,
        'TS8003',
        `Bitwise "${op}" needs an i32 or u32 target, got vec3u.`,
      );
    }
  });

  it('takes a shift and an exclusive or of two vectors in place', () => {
    bothTake(`"use typeshade";
export function f(vu: vec3u): vec3u {
  return (vu >> vu) ^ (vu << vu);
}
`);
  });
});

describe('what a function without a written result gets written in', () => {
  it('writes `T | undefined` after the parameter list of a result that may be absent', () => {
    expect(
      insertions(`"use typeshade";
function halfOf(x: f32) {
  if (x <= 0) {
    return;
  }
  return x * 0.5;
}
@fragment export function fs(): vec4 {
  const h = halfOf(1.);
  return vec4(h ?? 0.);
}
`),
    ).toEqual(['(x: f32)|: f32 | undefined']);
  });

  it('writes the result of an entry that returns a struct literal under the struct name', () => {
    expect(
      insertions(`"use typeshade";
interface VsOut { pos: builtin<"position">; uv: vec2; }
@vertex export function vs(vi: builtin<"vertex_index">) {
  return { pos: vec4(f32(vi)), uv: vec2(0.) };
}
`),
    ).toEqual(['index">)|: VsOut']);
  });

  it('writes the result of the function a refused stage call wraps, as it does an entry', () => {
    expect(
      insertions(`"use typeshade";
interface VsOut { pos: builtin<"position">; uv: vec2; }
export const vs = vertex(function vs(vi: builtin<"vertex_index">) {
  return { pos: vec4(f32(vi)), uv: vec2(0.) };
});
`),
    ).toEqual(['index">)|: VsOut']);
  });
});

describe('the table of operators that erase a vector type', () => {
  const kinds = (names: readonly string[]): ts.SyntaxKind[] =>
    names.map((n) => ts.SyntaxKind[n as keyof typeof ts.SyntaxKind]);

  it('gives a vector, or a matrix, to arithmetic, bitwise and shift operators and their compound forms', () => {
    const shaped = kinds([
      'PlusToken',
      'MinusToken',
      'AsteriskToken',
      'SlashToken',
      'PercentToken',
      'AsteriskAsteriskToken',
      'AmpersandToken',
      'BarToken',
      'CaretToken',
      'LessThanLessThanToken',
      'GreaterThanGreaterThanToken',
      'PlusEqualsToken',
      'MinusEqualsToken',
      'AsteriskEqualsToken',
      'SlashEqualsToken',
      'PercentEqualsToken',
      'AsteriskAsteriskEqualsToken',
      'AmpersandEqualsToken',
      'BarEqualsToken',
      'CaretEqualsToken',
      'LessThanLessThanEqualsToken',
      'GreaterThanGreaterThanEqualsToken',
    ]);
    for (const kind of shaped)
      expect(ERASING_OPERATORS.get(kind), ts.SyntaxKind[kind]).toBe('shape');
  });

  it('gives the bool vector of their width to a comparison', () => {
    const compared = kinds([
      'LessThanToken',
      'LessThanEqualsToken',
      'GreaterThanToken',
      'GreaterThanEqualsToken',
      'EqualsEqualsEqualsToken',
      'ExclamationEqualsEqualsToken',
    ]);
    for (const kind of compared)
      expect(ERASING_OPERATORS.get(kind), ts.SyntaxKind[kind]).toBe('bool');
  });

  it('leaves out && and ||, which TypeScript types as an operand own type', () => {
    expect(ERASING_OPERATORS.has(ts.SyntaxKind.AmpersandAmpersandToken)).toBe(false);
    expect(ERASING_OPERATORS.has(ts.SyntaxKind.BarBarToken)).toBe(false);
    expect(ERASING_OPERATORS.size).toBe(28);
  });

  it('lists the unary operators: negation, identity, bitwise not, logical not, increments', () => {
    expect([...ERASING_UNARY_OPERATORS].map((k) => ts.SyntaxKind[k]).sort()).toEqual(
      kinds([
        'MinusToken',
        'PlusToken',
        'TildeToken',
        'ExclamationToken',
        'PlusPlusToken',
        'MinusMinusToken',
      ])
        .map((k) => ts.SyntaxKind[k])
        .sort(),
    );
  });
});

describe('the projected text keeps the lines of the document', () => {
  it('writes every insertion inside one line, on a declaration that spans several', () => {
    const src = `"use typeshade";
export function f(a: vec3, b: vec3): vec3 {
  const c =
    a +
    b;
  const g = (x) =>
    x * 2.;
  return c;
}
`;
    const planned = planInsertions(src, 'a.shade.ts');
    expect(planned.length).toBeGreaterThan(0);
    for (const insertion of planned) expect(insertion.text).not.toContain('\n');
    const projection = new Projection(src, planned);
    expect(projection.projected.split('\n')).toHaveLength(src.split('\n').length);
  });
});
