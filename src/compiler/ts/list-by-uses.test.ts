// Verifies: Rule 5.1 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../core/testing/both-halves.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';

const PARAMS = 'vi: u32, ii: i32, x: f32, xs: array<f32, 8>';
const ARGS: [number, number, number, number[]] = [5, -3, 0.5, [10, 11, 12, 13, 14, 15, 16, 17]];

const inFunction = (body: string, ret = 'u32', head = ''): string => `"use typeshade";
${head}
export function f(${PARAMS}): ${ret} {
${body}
}
`;

const atModule = (list: string, body: string, ret = 'u32', head = ''): string => `"use typeshade";
${head}
const a = ${list};
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

describe('Rule 5.1: a list of integer-written numbers takes its element type from its uses', () => {
  describe('an element read', () => {
    it('is a u32 beside a u32, in a function and at module scope', () => {
      const local = bothTake(inFunction('  const a = [1, 2, 3];\n  return a[vi - 3] + vi;'));
      expect(hoverOf(local, 'a = ')).toBe('const a: array<u32, 3>');
      expect(local.result.wgsl).toContain('var a: array<u32, 3> = array<u32, 3>(1u, 2u, 3u);');
      bothOracles(local, 8);
      const module = bothTake(atModule('[1, 2, 3]', '  return a[1] + vi;'));
      expect(hoverOf(module, 'a = ')).toBe('const a: array<u32, 3>');
      expect(module.result.wgsl).toContain('const a: array<u32, 3> = array<u32, 3>(1u, 2u, 3u);');
      bothOracles(module, 7);
    });

    it('is an i32 beside an i32, for a let too', () => {
      const local = bothTake(
        inFunction('  let a = [1, 2, 3];\n  a[0] = ii;\n  return a[ii + 4] + a[0];', 'i32'),
      );
      expect(hoverOf(local, 'a = ')).toBe('let a: array<i32, 3>');
      expect(local.result.wgsl).toContain('var a: array<i32, 3> = array<i32, 3>(1, 2, 3);');
      bothOracles(local, -1);
    });

    it('is an i32 where it is an index and nothing else decides', () => {
      const halves = bothTake(inFunction('  const a = [1, 2, 3];\n  return xs[a[2]];', 'f32'));
      expect(hoverOf(halves, 'a = ')).toBe('const a: array<i32, 3>');
      bothOracles(halves, 13);
    });

    it('is a u32 where an index and a u32 use meet', () => {
      const halves = bothTake(
        inFunction('  const a = [1, 2, 3];\n  const p = xs[a[2]];\n  return a[0] + vi + u32(p);'),
      );
      expect(hoverOf(halves, 'a = ')).toBe('const a: array<u32, 3>');
      bothOracles(halves, 19);
    });

    it('takes an element that is arithmetic over integer-written numbers', () => {
      const halves = bothTake(
        inFunction('  const a = [1 + 1, 2 * 3, -4];\n  return a[1] + vi;', 'i32').replace(
          'a[1] + vi',
          'a[1] + ii',
        ),
      );
      expect(hoverOf(halves, 'a = ')).toBe('const a: array<i32, 3>');
      bothOracles(halves, 3);
    });
  });

  describe('a whole use', () => {
    const takes = (type: string): string =>
      `function take(p: array<${type}, 3>): ${type} { return p[0] + p[2]; }`;

    it('is an argument of a declared array parameter', () => {
      const halves = bothTake(
        inFunction('  const a = [1, 2, 3];\n  return take(a);', 'u32', takes('u32')),
      );
      expect(hoverOf(halves, 'a = ')).toBe('const a: array<u32, 3>');
      bothOracles(halves, 4);
      const module = bothTake(atModule('[1, 2, 3]', '  return take(a);', 'i32', takes('i32')));
      expect(hoverOf(module, 'a = ')).toBe('const a: array<i32, 3>');
      bothOracles(module, 4);
    });

    it('is an assignment to a typed array', () => {
      const halves = bothTake(
        inFunction('  const a = [1, 2, 3];\n  const b: array<u32, 3> = a;\n  return b[1];'),
      );
      expect(hoverOf(halves, 'a = ')).toBe('const a: array<u32, 3>');
      bothOracles(halves, 2);
    });

    it('is a return in a function whose result type is declared', () => {
      const head = 'function make(): array<i32, 3> { const a = [1, 2, 3]; return a; }';
      const halves = bothTake(inFunction('  const m = make();\n  return m[2];', 'i32', head));
      expect(hoverOf(halves, 'a = ')).toBe('const a: array<i32, 3>');
      bothOracles(halves, 3);
    });

    it('is the array of a for...of whose variable meets a u32', () => {
      const halves = bothTake(
        inFunction(
          '  const a = [1, 2, 3];\n  let s: u32 = 0;\n  for (const e of a) {\n    s = s + e + vi;\n  }\n  return s;',
        ),
      );
      expect(hoverOf(halves, 'a = ')).toBe('const a: array<u32, 3>');
      bothOracles(halves, 21);
    });

    it('is the array of a for...of whose variable is an index', () => {
      const halves = bothTake(
        inFunction(
          '  const a = [1, 2, 3];\n  let s = 0.;\n  for (const e of a) {\n    s += xs[e];\n  }\n  return s;',
          'f32',
        ),
      );
      expect(hoverOf(halves, 'a = ')).toBe('const a: array<i32, 3>');
      bothOracles(halves, 36);
    });
  });

  describe('where no use decides', () => {
    it('is an f32 in a function and at module scope', () => {
      const local = bothTake(
        inFunction('  let a = [1, 2, 3];\n  a[0] = x;\n  return a[0] + a[1] / 2;', 'f32'),
      );
      expect(hoverOf(local, 'a = ')).toBe('let a: array<f32, 3>');
      bothOracles(local, 1.5);
      const module = bothTake(atModule('[1, 2, 3]', '  return a[1] * x;', 'f32'));
      expect(hoverOf(module, 'a = ')).toBe('const a: array<f32, 3>');
      expect(module.result.wgsl).toContain(
        'const a: array<f32, 3> = array<f32, 3>(1.0, 2.0, 3.0);',
      );
      bothOracles(module, 1);
    });
  });

  describe('a conflict', () => {
    const conflict =
      'Cannot infer "a": its uses require i32 and u32. Write an explicit type annotation on "a" and cast the uses that need another type.';

    it('is refused where an i32 use and a u32 use meet, with the annotation remedy', () => {
      bothRefuse(
        inFunction(
          '  const a = [1, 2, 3];\n  const p = a[0] + vi;\n  const q = a[1] + ii;\n  return p;',
        ),
        'TS8003',
        conflict,
      );
      bothRefuse(
        atModule('[1, 2, 3]', '  const p = a[0] + vi;\n  const q = a[1] + ii;\n  return p;'),
        'TS8003',
        conflict,
      );
    });

    it('is refused where an integer use stands beside a float use, at the float use', () => {
      bothRefuse(
        inFunction(
          '  const a = [1, 2, 3];\n  const p = a[0] + vi;\n  const q = a[1] + x;\n  return p;',
        ),
        'TS8003',
        'Type mismatch: cannot + u32 and f32 — no implicit int/float conversion. Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
      );
    });

    it('shows the editor one more TS2345 where a whole use meets another use', () => {
      const head = 'function take(p: array<i32, 3>): i32 { return p[0]; }';
      const halves = bothHalves(
        inFunction(
          '  const a = [1, 2, 3];\n  const q = take(a);\n  return a[0] + vi;',
          'u32',
          head,
        ),
      );
      expect(halves.compiler).toEqual([`typeshade TS8003: ${conflict}`]);
      expect(halves.editor[0]).toBe(`typeshade TS8003: ${conflict}`);
      expect(halves.editor.slice(1)).toHaveLength(1);
      expect(halves.editor[1]).toMatch(
        /^typescript 2345: Argument of type 'number\[\]' is not assignable to parameter of type 'array<i32, 3>'\./,
      );
    });

    it('refuses += of an element into a u32, as it refuses += of a let', () => {
      const mismatch =
        'Type mismatch: cannot += u32 and f32 — no implicit int/float conversion. Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).';
      bothRefuse(
        inFunction(
          '  const a = [1, 2, 3];\n  let s: u32 = 0;\n  for (let i = 0; i < 3; i++) {\n    s += a[i];\n  }\n  return s;',
        ),
        'TS8003',
        mismatch,
      );
      bothRefuse(
        inFunction('  let k = 1;\n  let s: u32 = 0;\n  s += k;\n  return s + vi;'),
        'TS8003',
        mismatch,
      );
    });

    it('stays settled by a declaration of the type', () => {
      const halves = bothTake(
        inFunction(
          '  const a: array<u32, 3> = [1, 2, 3];\n  const p = a[0] + vi;\n  const q = a[1] + u32(x);\n  return p + q;',
        ),
      );
      bothOracles(halves, 8);
    });
  });

  describe('a division', () => {
    it('over an element its uses make an integer is refused, in a function and at module scope', () => {
      const sentence = (type: string, edit: string): string =>
        `"a" is ${type} where another line reads it, and no operand of "a[0] / 2" has a declared type, so the "/" does not say which division it is. Write "${edit}(a[0]) / 2" for the ${edit === 'f32' ? 'float' : 'integer'} division.`;
      bothRefuse(
        inFunction('  const a = [7, 2, 3];\n  return xs[a[2]] + f32(a[0] / 2);', 'f32'),
        'TS8003',
        sentence('an i32', 'f32'),
      );
      bothRefuse(
        atModule('[7, 2, 3]', '  return u32(a[0] / 2) + a[1] + vi;'),
        'TS8003',
        sentence('a u32', 'u32'),
      );
    });

    it('over an element no use makes an integer is the float division', () => {
      const halves = bothTake(inFunction('  const a = [7, 2, 3];\n  return a[0] / 2;', 'f32'));
      expect(hoverOf(halves, 'a = ')).toBe('const a: array<f32, 3>');
      bothOracles(halves, 3.5);
    });

    it('over an element of a declared array is the integer division', () => {
      const halves = bothTake(
        inFunction('  const a: array<u32, 3> = [7, 2, 3];\n  return a[0] / 2;'),
      );
      bothOracles(halves, 3);
    });
  });

  describe('what stays as it was', () => {
    it('refuses integer-written and float elements together (D2)', () => {
      bothRefuse(
        inFunction('  const a = [1, 2.5];\n  return a[0];', 'f32'),
        'TS8002',
        '"const a" takes its type from its list, whose elements must share one type: element 0 is an integer-written number and element 1 is f32. Declare the type: const a: array<f32, 2> = [...].',
      );
    });

    it('refuses a function-local as const list', () => {
      bothRefuse(
        inFunction('  const a = [1, 2] as const;\n  return a[0];', 'f32'),
        'TS8099',
        'A list takes its type from the position it is written in: declare one, as "const xs: array<T, 2> = [...]" or a return type, or call array<T, 2>(...) here.',
      );
    });
  });
});
