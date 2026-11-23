// Verifies: Rule 5.1 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

const PARAMS = 'vi: u32, ii: i32, x: f32';
const ARGS: [number, number, number] = [5, -3, 0.5];

const atModule = (list: string, body: string, ret = 'u32', head = ''): string => `"use typeshade";
${head}
let a = ${list};
export function f(${PARAMS}): ${ret} {
${body}
}
`;

const hoverOf = (halves: ReturnType<typeof bothTake>, needle: string): string | undefined =>
  halves.hover(needle)?.replace(/```ts\n|\n```/g, '');

const bothOracles = (halves: ReturnType<typeof bothTake>, want: number): void => {
  expect(halves.result.eval('f', [...ARGS])).toBe(want);
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(halves.result.module!).fns.f!(...ARGS), make.name).toBe(want);
  }
};

const takes = (type: string): string =>
  `function take(p: array<${type}, 3>): ${type} { return p[0] + p[2]; }`;

describe('a module-scope let list takes its element type and length from its elements', () => {
  it('is a var<private> array<f32, 2> for float-written elements', () => {
    const halves = bothTake(atModule('[1., 2.]', '  return a[1] + x + f32(a.length);', 'f32'));
    expect(hoverOf(halves, 'a = ')).toBe('let a: array<f32, 2>');
    expect(halves.result.wgsl).toContain(
      'var<private> a: array<f32, 2> = array<f32, 2>(1.0, 2.0);',
    );
    bothOracles(halves, 4.5);
  });

  it('emits what the annotated module let emits', () => {
    const annotated = bothTake(
      atModule('[1., 2.]', '  return a[1];', 'f32').replace('let a =', 'let a: array<f32, 2> ='),
    );
    expect(bothTake(atModule('[1., 2.]', '  return a[1];', 'f32')).result.wgsl).toBe(
      annotated.result.wgsl,
    );
  });

  it('takes an integer-written list from an index use with a u32', () => {
    const halves = bothTake(atModule('[1, 2, 3]', '  return a[1] + vi;'));
    expect(hoverOf(halves, 'a = ')).toBe('let a: array<u32, 3>');
    expect(halves.result.wgsl).toContain(
      'var<private> a: array<u32, 3> = array<u32, 3>(1u, 2u, 3u);',
    );
    bothOracles(halves, 7);
  });

  it('takes an integer-written list from an argument of one declared array parameter', () => {
    const halves = bothTake(atModule('[1, 2, 3]', '  return take(a);', 'i32', takes('i32')));
    expect(hoverOf(halves, 'a = ')).toBe('let a: array<i32, 3>');
    bothOracles(halves, 4);
  });

  it('takes an integer-written list from two declared array parameters of one type', () => {
    const head = `${takes('u32')}\nfunction again(p: array<u32, 3>): u32 { return p[1]; }`;
    const halves = bothTake(atModule('[1, 2, 3]', '  return take(a) + again(a);', 'u32', head));
    expect(hoverOf(halves, 'a = ')).toBe('let a: array<u32, 3>');
    bothOracles(halves, 6);
  });

  it('is an array<f32, 3> where no use decides', () => {
    const halves = bothTake(atModule('[1, 2, 3]', '  return x;', 'f32'));
    expect(hoverOf(halves, 'a = ')).toBe('let a: array<f32, 3>');
    expect(halves.result.wgsl).toContain('var<private> a: array<f32, 3>');
    bothOracles(halves, 0.5);
  });

  it('keeps an element writable, as for an annotated module let array', () => {
    const halves = bothTake(atModule('[1, 2, 3]', '  a[0] = vi;\n  return a[0] + a[2];'));
    expect(hoverOf(halves, 'a = ')).toBe('let a: array<u32, 3>');
    bothOracles(halves, 8);
    const floats = bothTake(atModule('[1., 2.]', '  a[1] = x;\n  return a[1];', 'f32'));
    bothOracles(floats, 0.5);
  });

  it('refuses uses that need i32 and u32, with the annotation remedy', () => {
    bothRefuse(
      atModule('[1, 2, 3]', '  const p = a[0] + vi;\n  const q = a[1] + ii;\n  return p;'),
      'TS8003',
      'Cannot infer "a": its uses require i32 and u32. Write an explicit type annotation on "a" and cast the uses that need another type.',
    );
  });

  it('refuses an integer-written number beside a float, as a module const list does', () => {
    bothRefuse(
      atModule('[1, 2.5]', '  return x;', 'f32'),
      'TS8002',
      'Module let "a" takes its type from its list, whose elements must share one type: element 0 is an integer-written number and element 1 is f32. Declare the type: let a: array<f32, 2> = [...].',
    );
  });

  it('emits the list as a global in GLSL ES 3.00 and the oracle agrees', () => {
    const halves = bothTake(`"use typeshade";
let a = [1., 2.];
@fragment export function fs(uv: location<0, vec2>): vec4 {
  a[0] = uv.x;
  return vec4(a[0], a[1], 0., 1.);
}
`);
    expect(halves.result.glsl?.fragment).toContain('float[2] a = float[2](1.0, 2.0);');
    expect(halves.result.eval('fs', [[3, 0]])).toEqual([3, 2, 0, 1]);
    expect(compileModuleJs(halves.result.module!).fns['fs']!([3, 0])).toEqual([3, 2, 0, 1]);
  });

  it('refuses an empty list with the sentence of a module const list', () => {
    bothRefuse(
      atModule('[]', '  return x;', 'f32'),
      'TS8002',
      'Module let "a" takes its type and its length from its list, and an empty list has neither: a shader array has at least one element. Write its elements.',
    );
  });

  it('refuses a "/" over an element its uses make an integer', () => {
    bothRefuse(
      atModule('[7, 2, 3]', '  return u32(a[0] / 2) + a[1] + vi;'),
      'TS8003',
      '"a" is a u32 where another line reads it, and no operand of "a[0] / 2" has a declared type, so the "/" does not say which division it is. Write "u32(a[0]) / 2" for the integer division.',
    );
  });
});
