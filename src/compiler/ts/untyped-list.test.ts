import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

const inFunction = (list: string, use = 'a[i]', ret = 'f32'): string => `"use typeshade";
export function f(i: i32): ${ret} {
  const a = ${list};
  return ${use};
}
`;

const atModule = (list: string, body = 'return T[i];'): string => `"use typeshade";
const T = ${list};
export function f(i: i32): f32 {
  ${body}
}
`;

const hoverOf = (halves: ReturnType<typeof bothTake>, needle: string): string | undefined =>
  halves.hover(needle)?.replace(/```ts\n|\n```/g, '');

describe('an untyped list takes its element type and its length from its elements', () => {
  it('is an array<f32, 3> in a function body, with its length and its elements', () => {
    const halves = bothTake(inFunction('[1., 2., 3.]', 'a[i] + f32(a.length)'));
    expect(hoverOf(halves, 'a = ')).toBe('const a: array<f32, 3>');
    expect(halves.result.wgsl).toContain('var a: array<f32, 3> = array<f32, 3>(1.0, 2.0, 3.0);');
    for (const make of [compileModule, compileModuleJs]) {
      expect(make(halves.result.module!).fns.f!(1), make.name).toBe(5);
    }
  });

  it('emits what the annotated list emits', () => {
    const annotated = bothTake(
      inFunction('[1., 2., 3.]').replace('const a =', 'const a: array<f32, 3> ='),
    );
    expect(bothTake(inFunction('[1., 2., 3.]')).result.wgsl).toBe(annotated.result.wgsl);
  });

  it('is an array<f32, 3> at module scope', () => {
    const halves = bothTake(atModule('[1., 2., 3.]'));
    expect(hoverOf(halves, 'T = ')).toBe('const T: array<f32, 3>');
    expect(halves.result.wgsl).toContain('const T: array<f32, 3> = array<f32, 3>(1.0, 2.0, 3.0);');
  });

  it('takes a let, whose elements stay writable', () => {
    const source = inFunction('[1., 2.]')
      .replace('const a', 'let a')
      .replace('return', 'a[0] = 5.;\n  return');
    const halves = bothTake(source);
    expect(hoverOf(halves, 'a = ')).toBe('let a: array<f32, 2>');
    expect(halves.result.wgsl).toContain('a[0] = 5.0;');
  });

  it('takes vectors, bools and typed values', () => {
    const vectors = bothTake(inFunction('[vec2(0.), vec2(1.)]', 'a[i]', 'vec2'));
    expect(hoverOf(vectors, 'a = ')).toBe('const a: array<vec2<f32>, 2>');
    const flags = bothTake(inFunction('[true, false]', 'a[i]', 'bool'));
    expect(hoverOf(flags, 'a = ')).toBe('const a: array<bool, 2>');
    bothTake(inFunction('[f32(i), 0.5]'));
  });

  it('is passed to a parameter that declares array<f32, 3>', () => {
    const halves = bothTake(`"use typeshade";
function first(x: array<f32, 3>): f32 {
  return x[0];
}
export function f(i: i32): f32 {
  const a = [1., 2., 3.];
  return first(a);
}
`);
    expect(halves.result.wgsl).toContain('var a: array<f32, 3> = array<f32, 3>(1.0, 2.0, 3.0);');
  });
});

describe('as const on a module-scope list', () => {
  it('gives the same sized array', () => {
    const halves = bothTake(atModule('[1., 2.] as const'));
    expect(hoverOf(halves, 'T = ')).toBe('const T: array<f32, 2>');
    expect(halves.result.wgsl).toContain('const T: array<f32, 2> = array<f32, 2>(1.0, 2.0);');
  });

  it('is read-only', () => {
    bothRefuse(
      atModule('[1., 2.] as const', 'T[0] = 3.;\n  return T[i];'),
      'TS8005',
      'Cannot assign to "T" — it is a module const.',
    );
  });
});

describe('a tuple is the short sized spelling', () => {
  it('is array<f32, 3>', () => {
    const halves = bothTake(
      inFunction('[1., 2., 3.]').replace('const a =', 'const a: [f32, f32, f32] ='),
    );
    expect(hoverOf(halves, 'a: ')).toBe('const a: array<f32, 3>');
  });
});

describe('what an untyped list is refused for', () => {
  const shared = (said: string): string =>
    `${said} takes its type from its list, whose elements must share one type:`;

  it('refuses integer-written and float elements, with the types it found', () => {
    bothRefuse(
      inFunction('[1, 2.5]'),
      'TS8002',
      `${shared('"const a"')} element 0 is an integer-written number and element 1 is f32. ` +
        'Declare the type: const a: array<f32, 2> = [...].',
    );
    bothRefuse(
      atModule('[2.5, 1]'),
      'TS8002',
      `${shared('Module const "T"')} element 0 is f32 and element 1 is an integer-written ` +
        'number. Declare the type: const T: array<f32, 2> = [...].',
    );
    bothRefuse(
      inFunction('[i, 1]', 'f32(a[0])'),
      'TS8002',
      `${shared('"const a"')} element 0 is i32 and element 1 is an integer-written number. ` +
        'Declare the type: const a: array<i32, 2> = [...].',
    );
  });

  it('refuses elements of two types, with the types it found', () => {
    bothRefuse(
      inFunction('[1., true]', '0.'),
      'TS8002',
      `${shared('"const a"')} element 0 is f32 and element 1 is bool.`,
    );
  });

  it('refuses an empty list', () => {
    bothRefuse(
      inFunction('[]', '0.'),
      'TS8002',
      '"const a" takes its type and its length from its list, and an empty list has neither: ' +
        'a shader array has at least one element. Write its elements.',
    );
  });

  it('asks for the type of a list of integer-written numbers alone', () => {
    bothRefuse(
      inFunction('[1, 2, 3]'),
      'TS8002',
      '"const a" needs an array type annotation to take a list, e.g. const a: array<f32, 3> = [...].',
    );
  });
});
