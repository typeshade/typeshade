// Verifies: Rule 8.18
import { describe, expect, it } from 'vitest';
import { bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

const inFunction = (made: string, use = 'w[i]', ret = 'f32'): string => `"use typeshade";
export function f(i: i32): ${ret} {
  const w = ${made};
  return ${use};
}
`;

const atModule = (made: string): string => `"use typeshade";
const w = ${made};
export function f(i: i32): f32 {
  return w[i];
}
`;

const asField = (made: string, use = 'this.weights[i]'): string => `"use typeshade";
class K {
  weights = ${made};
  at(i: i32): f32 {
    return ${use};
  }
}
export function f(i: i32): f32 {
  const k = new K();
  return k.at(i);
}
`;

const hoverOf = (halves: ReturnType<typeof bothTake>, needle: string): string | undefined =>
  halves.hover(needle)?.replace(/```ts\n|\n```/g, '');

const runs = (halves: ReturnType<typeof bothTake>, arg: number): number[] =>
  [compileModule, compileModuleJs].map((make) => make(halves.result.module!).fns.f!(arg) as number);

const UNSUPPORTED = 'TS8099';

describe('new Array(N).fill(v) is an array<T, N> of N copies of v', () => {
  it('in a function body, with its length and its elements', () => {
    const halves = bothTake(inFunction('new Array(4).fill(0.5)', 'w[i] + f32(w.length)'));
    expect(hoverOf(halves, 'w = ')).toBe('const w: array<f32, 4>');
    expect(halves.result.wgsl).toContain(
      'var w: array<f32, 4> = array<f32, 4>(0.5, 0.5, 0.5, 0.5);',
    );
    expect(runs(halves, 2)).toEqual([4.5, 4.5]);
  });

  it('takes a vector, a module constant and a local constant as the length', () => {
    const vectors = bothTake(inFunction('new Array(4).fill(vec2(1.))', 'w[i]', 'vec2'));
    expect(hoverOf(vectors, 'w = ')).toBe('const w: array<vec2<f32>, 4>');
    const moduleN = bothTake(
      `"use typeshade";\nconst N = 8;\n${inFunction('new Array(N).fill(1.)').slice(16)}`,
    );
    expect(hoverOf(moduleN, 'w = ')).toBe('const w: array<f32, 8>');
    bothTake(inFunction('new Array(n).fill(1.)').replace('const w', 'const n = 3;\n  const w'));
  });

  it('at module scope', () => {
    const halves = bothTake(atModule('new Array(2).fill(0.25)'));
    expect(hoverOf(halves, 'w = ')).toBe('const w: array<f32, 2>');
    expect(halves.result.wgsl).toContain('const w: array<f32, 2> = array<f32, 2>(0.25, 0.25);');
  });

  it('takes the element type of a declared type for an integer-written value', () => {
    const halves = bothTake(
      inFunction('new Array(3).fill(1)', 'w[i]', 'u32').replace(
        'const w',
        'const w: array<u32, 3>',
      ),
    );
    expect(halves.result.wgsl).toContain('array<u32, 3>(1u, 1u, 1u)');
  });

  it('runs a value with a call once, in a function of the module', () => {
    const halves = bothTake(`"use typeshade";
function half(x: f32): f32 {
  return x * 0.5;
}
export function f(i: i32): f32 {
  const w = new Array(3).fill(half(f32(i)));
  return w[0] + w[2];
}
`);
    expect(halves.result.wgsl).toContain('fn array_fill(v: f32) -> array<f32, 3>');
    expect(runs(halves, 4)).toEqual([4, 4]);
  });

  it('keeps xs.fill(v) as a statement', () => {
    const halves = bothTake(
      inFunction('new Array(2).fill(0.)')
        .replace('const w', 'let w')
        .replace('return', 'w.fill(3.);\n  return'),
    );
    expect(runs(halves, 1)).toEqual([3, 3]);
  });
});

describe('new Float32Array(N) is N zeros of f32', () => {
  it('in a function body and at module scope', () => {
    const halves = bothTake(inFunction('new Float32Array(3)', 'w[i] + f32(w.length)'));
    expect(hoverOf(halves, 'w = ')).toBe('const w: array<f32, 3>');
    expect(halves.result.wgsl).toContain('var w: array<f32, 3> = array<f32, 3>(0.0, 0.0, 0.0);');
    expect(runs(halves, 1)).toEqual([3, 3]);
    expect(hoverOf(bothTake(atModule('new Float32Array(2)')), 'w = ')).toBe(
      'const w: array<f32, 2>',
    );
  });
});

describe('Array.from({ length: N }, f) calls f(undefined, i) for each index', () => {
  it('builds each element from its index, in a function of the module', () => {
    const halves = bothTake(inFunction('Array.from({ length: 4 }, (_, i) => f32(i) * 2.)'));
    expect(hoverOf(halves, 'w = ')).toBe('const w: array<f32, 4>');
    expect(halves.result.wgsl).toMatch(/fn array_from_\w+\(\) -> array<f32, 4>/);
    expect(runs(halves, 3)).toEqual([6, 6]);
  });

  it('passes what the function captures', () => {
    const halves = bothTake(
      inFunction('Array.from({ length: 3 }, (_, j) => f32(j) + k)').replace(
        'const w',
        'const k = f32(i);\n  const w',
      ),
    );
    expect(runs(halves, 2)).toEqual([4, 4]);
  });
});

describe('a class field takes its size from its initializer', () => {
  it('new Array(N).fill(v), new Float32Array(N) and Array.from', () => {
    const filled = bothTake(
      asField('new Array(16).fill(0.5)', 'this.weights[i] + f32(this.weights.length)'),
    );
    expect(hoverOf(filled, 'weights =')).toBe('(property) K.weights: array<f32, 16>');
    expect(runs(filled, 3)).toEqual([16.5, 16.5]);
    const zeros = bothTake(asField('new Float32Array(4)'));
    expect(hoverOf(zeros, 'weights =')).toBe('(property) K.weights: array<f32, 4>');
  });
});

describe('what is refused, as not supported yet or as JavaScript refuses it', () => {
  it('new Array(N) with no fill, an array of holes', () => {
    bothRefuse(
      inFunction('new Array(4)', '1.'),
      UNSUPPORTED,
      '"new Array(4)" makes an array of holes in JavaScript, and a hole is not supported yet. Fill it: new Array(4).fill(v).',
    );
  });

  it('a length that is no constant, for each constructor', () => {
    const tail =
      'which is no constant, and an array whose length is known only when the shader runs is not supported yet here. Write a constant length: an integer literal or a module constant.';
    for (const [made, shown] of [
      ['new Array(i).fill(1.)', 'new Array(i)'],
      ['new Float32Array(i)', 'new Float32Array(i)'],
      ['Array.from({ length: i }, (_, j) => 1.)', 'Array.from({ length: i }, (_, j) => 1.)'],
    ]) {
      bothRefuse(
        inFunction(made!, '1.'),
        UNSUPPORTED,
        `"${shown!}" takes its length from "i", ${tail}`,
      );
    }
  });

  it('a length of 0, and one JavaScript throws a RangeError for', () => {
    bothRefuse(
      inFunction('new Float32Array(0)', '1.'),
      UNSUPPORTED,
      '"new Float32Array(0)" is an array of length 0, which is not supported yet: a shader array has at least one element.',
    );
    bothRefuse(
      inFunction('new Float32Array(2.5)', '1.'),
      'TS8003',
      '"new Float32Array(2.5)" throws a RangeError in JavaScript: its length is 2.5, and a length is a whole number of 0 or more.',
    );
  });

  it('an integer-written fill value that nothing types', () => {
    bothRefuse(
      inFunction('new Array(4).fill(0)', '1.'),
      UNSUPPORTED,
      '"new Array(4).fill(0)" fills its array with an integer-written number, whose element type its uses will decide; that is not supported yet. Write the element\'s type: fill(f32(0)), fill(i32(0)) or fill(u32(0)).',
    );
  });

  it('a use of what xs.fill(v) gives back on an array that exists', () => {
    bothRefuse(
      inFunction('new Array(2).fill(0.)', 'z[i]').replace(
        'return',
        'const z = w.fill(2.);\n  return',
      ),
      UNSUPPORTED,
      '"w.fill(2.)" gives back the array it fills, and a use of that value is not supported yet. Call it on its own line, then use "w".',
    );
  });

  it('Array.from with no function, a function by its name, or one that reads undefined', () => {
    bothRefuse(
      inFunction('Array.from({ length: 4 })', '1.'),
      UNSUPPORTED,
      '"Array.from({ length: 4 })" makes an array of undefined values in JavaScript, and an undefined element is not supported yet. Hand it a function: Array.from({ length: N }, (_, i) => …).',
    );
    bothRefuse(
      inFunction('Array.from({ length: 4 }, (x) => x)', '1.'),
      UNSUPPORTED,
      '"x" is undefined, as Array.from passes it, and reading it is not supported yet. Read the index, the second parameter: (_, i) => ….',
    );
  });

  it('Array.from with a function by its name or with a third parameter', () => {
    bothRefuse(
      inFunction('Array.from({ length: 4 }, h)', '1.').replace(
        'export',
        'function h(_: i32, i: i32): f32 {\n  return 1.;\n}\nexport',
      ),
      UNSUPPORTED,
      '"Array.from({ length: 4 }, h)" hands over "h", and a function handed to Array.from is supported yet only as an arrow function written in the call: (_, i) => ….',
    );
    bothRefuse(
      inFunction('Array.from({ length: 4 }, (a, b, c) => 1.)', '1.'),
      UNSUPPORTED,
      'Array.from hands its function two arguments, undefined and the index, so "c" would be undefined, which is not supported yet.',
    );
  });

  it('a fill value that is an object with a name, which every element would share', () => {
    bothRefuse(
      `"use typeshade";
class P {
  x: f32 = 0.;
}
export function f(): f32 {
  const p = new P();
  const w = new Array(4).fill(p);
  return w[1].x;
}
`,
      UNSUPPORTED,
      '"new Array(4).fill(p)" puts one object in every element, and the elements are then one object. One object under two names is not supported yet (change 0142, stage 3). Build each element in a loop.',
    );
  });

  it('Array.from outside a function body', () => {
    bothRefuse(
      atModule('Array.from({ length: 2 }, (_, i) => 1.)'),
      UNSUPPORTED,
      '"Array.from({ length: 2 }, (_, i) => 1.)" runs its function for each element, which is not supported yet outside a function\'s body (at module scope or in a field\'s initializer). Build it inside the function that needs it.',
    );
  });

  it('new Float32Array with another argument, and Int32Array, which plan unit B2 adds', () => {
    bothRefuse(
      inFunction('new Float32Array()', '1.'),
      UNSUPPORTED,
      '"new Float32Array()" is not supported yet: a Float32Array is built here as new Float32Array(N), N zeros of f32, with a constant N.',
    );
    bothRefuse(inFunction('new Int32Array(4)', '1.'), 'TS8022', 'Unknown identifier "Int32Array".');
  });
});
