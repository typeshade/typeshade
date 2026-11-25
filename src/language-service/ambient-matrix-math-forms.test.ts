import { describe, expect, it } from 'vitest';
import { analyzeSourceFile, createTypeshadeLanguageServiceWith } from './service.js';
import { SHADE_DTS } from './ambient.js';
import { FUNCTION_DOCS } from './docs.js';
import { generatedOverloads } from './builtin-signatures.js';
import { isRemovedCall } from '../compiler/ts/removed-names.js';
import { bothHalves, bothTake } from '../core/testing/both-halves.js';

const program = (body: string): string =>
  `"use typeshade"\n@fragment export function fs(uv: location<0, vec2>): vec4 {\n${body}\n  return vec4(0., 0., 0., 1.)\n}\n`;

const typescriptCodes = (source: string): number[] => {
  const service = createTypeshadeLanguageServiceWith({}, analyzeSourceFile, { merge: false });
  service.openDocument('a.shade.ts', source);
  return service
    .getDiagnostics('a.shade.ts')
    .filter((d) => d.source === 'typescript')
    .map((d) => Number(d.code));
};

const takes = (body: string): void => {
  const source = program(body);
  bothTake(source);
  expect(typescriptCodes(source)).toEqual([]);
};

const refuses = (body: string, typescriptCode: number | undefined, compilerCode: string): void => {
  const source = program(body);
  const halves = bothHalves(source);
  const starts = (line: string): boolean => line.startsWith(`typeshade ${compilerCode}:`);
  expect(halves.compiler.some(starts), halves.compiler.join('\n')).toBe(true);
  expect(halves.editor.some(starts), halves.editor.join('\n')).toBe(true);
  if (typescriptCode !== undefined) expect(typescriptCodes(source)).toContain(typescriptCode);
};

const hoverAt = (body: string, needle: string): string =>
  bothHalves(program(body)).hover(needle) ?? '';

const F64_VECTOR = 'const a = vec3f64(f64(1.), f64(2.), f64(3.))\n';

describe('the matrix constructors', () => {
  it('take the four forms of a square matrix', () => {
    takes(
      'const c = vec3(1., 2., 3.)\n const a = mat3()\n const b = mat3(c, c, c)\n const d = mat3(1., 2., 3., 4., 5., 6., 7., 8., 9.)',
    );
  });

  it('take a source of their own size, and a larger one', () => {
    takes('const a = mat3(mat3())\n const b = mat3(mat4())\n const c = mat2x3(mat3())');
    takes('const a = mat2x3(mat2x3())\n const b = mat3x2(mat4())');
  });

  it('refuse a source smaller in either dimension', () => {
    refuses('const a = mat3(mat2())', 2769, 'TS8003');
    refuses('const a = mat3x2(mat2x3())', 2769, 'TS8003');
  });

  it('refuse a count of components that fits no form', () => {
    refuses('const a = mat3(1., 2., 3., 4., 5., 6., 7., 8.)', 2575, 'TS8019');
  });

  it('are spelled with the f suffix for every shape that has a size in its name', () => {
    takes('const a = mat2x3f()\n const b = mat3x3f()\n const c = mat4x4f()');
    refuses('const a = mat3f()', 2552, 'TS8004');
  });

  it('give a matrix of doubles to a square type only', () => {
    takes('let a: mat4<f64>\n let b: mat2<f64>');
    refuses('let a: mat2x3<f64>', 2315, 'TS8027');
  });
});

describe('determinant and transpose', () => {
  it('take the determinant of a square matrix only', () => {
    takes('const a = determinant(mat3())\n const b = determinant(mat2())');
    refuses('const a = determinant(mat2x3())', 2769, 'TS8036');
  });

  it('refuse the determinant of a matrix of doubles', () => {
    refuses('let m: mat3<f64>\n const a = determinant(m)', 2769, 'TS8036');
  });

  it('turn a non-square matrix into the one of swapped dimensions', () => {
    takes(
      'function g(v: mat3x2): f32 { return 1. }\n const a = g(transpose(mat2x3()))\n function h(v: mat4x2): f32 { return 1. }\n const b = h(transpose(mat2x4()))',
    );
  });
});

describe('the scalar casts', () => {
  it('take a bool, and the zero value when the type has one', () => {
    takes(
      'const a = f32(true)\n const b = u32(true)\n const c = i32(true)\n const d = bool(true)\n const e = bool(1.)\n const f = f32()\n const g = i32()\n const h = u32()\n const i = bool()',
    );
  });

  it('give a double no bool and no zero value', () => {
    refuses('const a = f64(true)', 2345, 'TS8003');
    refuses('const a = f64()', 2554, 'TS8019');
  });

  it('declare f32 as a cast only, never as a math function', () => {
    expect(SHADE_DTS).not.toMatch(/declare function f32</);
    expect(SHADE_DTS.match(/declare function f32\(x:/g)).toHaveLength(1);
  });

  it('declare no removed name as a free function', () => {
    refuses('const a = pow(1., 2.)', 2304, 'TS8004');
    refuses('const a = arrayLength(array(1., 2.))', 2304, 'TS8004');
  });
});

describe('the free math signatures', () => {
  it('give the length of a vector of doubles back as an f64', () => {
    const body = `${F64_VECTOR}const l = length(a)\n const k = length(vec3(1., 2., 3.))`;
    expect(hoverAt(body, 'l =')).toContain('const l: f64');
    expect(hoverAt(body, 'k =')).toContain('const k: f32');
    expect(SHADE_DTS).toContain(
      'declare function length<T extends Numeric | Vec64Any>(a0: T): T extends Vec64Any ? f64 : number',
    );
  });

  it('take a vector of doubles in the builtins the fp64 pass has a body for', () => {
    takes(
      `${F64_VECTOR}const b = abs(a)\n const c = cos(a)\n const d = floor(a)\n const e = round(a)\n const f = fract(a)\n const g = sin(a)\n const h = normalize(a)`,
    );
  });

  it('refuse a vector of doubles in a builtin the pass has no body for', () => {
    refuses(`${F64_VECTOR}const b = tan(a)`, 2769, 'TS8036');
    refuses(`${F64_VECTOR}const b = sqrt(a)`, 2769, 'TS8036');
  });

  it('splat a scalar beside a vector in min and max', () => {
    takes(
      'const a = min(vec3(1., 2., 3.), 1.)\n const b = max(vec3i(1, 2, 3), 1)\n const c = min(vec2u(1, 2), 1)',
    );
  });

  it('take a cross product of two vec3 only', () => {
    takes('const a = cross(vec3(1., 2., 3.), vec3(3., 2., 1.))');
    refuses('const a = cross(vec3i(1, 2, 3), vec3i(1, 2, 3))', 2769, 'TS8036');
    refuses('const a = cross(vec2(1., 2.), vec2(1., 2.))', 2769, 'TS8036');
  });

  it('keep the shape of a normalized vector', () => {
    takes('function g(v: vec2): f32 { return 1. }\n const a = g(normalize(vec2(1., 2.)))');
    refuses(
      'function g(v: vec3): f32 { return 1. }\n const a = g(normalize(vec2(1., 2.)))',
      2345,
      'TS8003',
    );
  });

  it('take a scalar eta in refract, and a count and an offset beside a vector in bit fields', () => {
    takes(
      'const a = refract(vec3(1., 2., 3.), vec3(3., 2., 1.), 0.5)\n const b = extractBits(vec3u(1, 2, 3), 1, 2)\n const c = insertBits(vec3u(1, 2, 3), vec3u(3, 2, 1), 1, 2)\n const d = ldexp(vec3(1., 2., 3.), vec3i(1, 2, 3))',
    );
    refuses(
      'const a = refract(vec3(1., 2., 3.), vec3(3., 2., 1.), vec3(1., 2., 3.))',
      2769,
      'TS8036',
    );
  });
});

describe('the Math members', () => {
  it('name the parameters as ECMAScript and the surface document do', () => {
    const body =
      'const p = Math.pow(1., 2.)\n const q = Math.atan2(1., 2.)\n const s = Math.hypot(1., 2.)';
    expect(hoverAt(body, 'pow(')).toContain('pow(base: number, exponent: number)');
    expect(hoverAt(body, 'atan2(')).toContain('atan2(y: number, x: number)');
    expect(hoverAt(body, 'hypot(')).toContain('hypot(a: number, b: number, c?: number)');
  });

  it('take atan with one argument and with two, and no more', () => {
    takes('const a = Math.atan(1.)\n const b = Math.atan(1., 2.)');
    refuses('const a = Math.atan(1., 2., 3.)', 2554, 'TS8019');
    expect(hoverAt('const a = Math.atan(1., 2.)', 'atan(')).toContain('(+1 overload)');
  });

  it('type a constant as an f32', () => {
    expect(hoverAt('const c = Math.PI', 'PI')).toContain('MathObject.PI: f32');
  });

  it('take Math.random with no argument in the editor, which the compiler refuses', () => {
    refuses('const a = Math.random()', undefined, 'TS8019');
    const source = program('const a = Math.random(1.)');
    expect(typescriptCodes(source)).toContain(2554);
    expect(bothHalves(source).compiler).toEqual([]);
  });
});

describe('the swizzles of a vector', () => {
  it('take one to four letters of one set, in any order and with repeats', () => {
    takes(
      'const a = vec4(1., 2., 3., 4.)\n const b = a.bgra\n const c = a.xxxx\n const d = a.wzyx\n const e = a.rr\n const f = vec2i(1, 2).yx\n const g = a.zyx.xy',
    );
  });

  it('refuse a letter past the size, a mixed set and five letters', () => {
    refuses('const a = vec2(1., 2.)\n const b = a.z', 2339, 'TS8022');
    refuses('const a = vec4(1., 2., 3., 4.)\n const b = a.xyzr', 2551, 'TS8022');
    refuses('const a = vec4(1., 2., 3., 4.)\n const b = a.xxxxx', 2551, 'TS8022');
  });
});

describe('the generated builtin overloads', () => {
  const lines = SHADE_DTS.split('\n');
  const names = [...generatedOverloads().keys()].filter((name) => !isRemovedCall(name));

  it('come ahead of the hand-written declarations of the name', () => {
    for (const name of names) {
      const declared = lines.filter((line) =>
        new RegExp(`^declare function ${name}[<(]`).test(line),
      );
      const generated = generatedOverloads().get(name)!;
      expect(declared.slice(0, generated.length), name).toEqual(generated);
      expect(declared.length, name).toBeGreaterThan(0);
    }
  });

  it('each carry a copy of the documentation of the name', () => {
    for (const name of names) {
      if (FUNCTION_DOCS[name] === undefined) continue;
      lines.forEach((line, i) => {
        if (!new RegExp(`^declare function ${name}[<(]`).test(line)) return;
        expect(lines[i - 1]!.trimEnd().endsWith('*/'), `${name}: ${line}`).toBe(true);
      });
    }
  });
});
