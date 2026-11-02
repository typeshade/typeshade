// `Math` takes scalars, as ECMAScript's does (change 0112, part 2).
//
// A `Math` member takes and returns a number. The vector form of the same operation is the WGSL
// name (`sqrt(v)`, `max(v, 0.)`). Before this change the compiler took `Math.sqrt(v)` on a
// `vec3` where the editor refused it (TS2345), and the ambient `MathObject` declared vector
// overloads of `Math.max` and `Math.min`, so `Math.max(v, 0.)` passed both halves.
//
// Every row reads both halves of the same source (Rule 12.7): `compile()`, its diagnostics (code
// and text, Rule 12.5) or its emit and the oracle's values, and the language service's
// `getDiagnostics`, with `getHover` where the type is the point.
//
// Rule 9.4 (docs/language-design.md). Its Verifies tag joins the rule text when a person has
// reviewed Rule 9.4 (`doorstop review RULE-0904`).
// Change 0112.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

/** The editor's diagnostics of `source`, as `source code: text`. */
function editorOf(source: string): readonly string[] {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.ts', source);
  return service.getDiagnostics('a.ts').map((d) => `${d.source} ${String(d.code)}: ${d.message}`);
}

/** The compiler's error diagnostics of `source`, as `source code: text`, in the editor's shape. */
function compilerOf(source: string): readonly string[] {
  return compile(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `typeshade ${d.code}: ${d.message}`);
}

/** Both halves take `source`: no diagnostic from `compile()` or from the editor. */
function bothTake(source: string): ReturnType<typeof compile> {
  const c = compile(source);
  expect(c.diagnostics, 'compile()').toEqual([]);
  expect(editorOf(source), 'the editor').toEqual([]);
  return c;
}

/** Both halves refuse `source` with the one sentence, under the one code (Rule 12.5). */
function bothRefuse(source: string, code: string, text: string): void {
  const want = `typeshade ${code}: ${text}`;
  expect(compilerOf(source), 'compile()').toEqual([want]);
  expect(editorOf(source), 'the editor').toEqual([want]);
}

const program = (expr: string, ret = 'vec3'): string =>
  `"use typeshade";\nexport function f(v: vec3, w: vec3, x: f32): ${ret} {\n  return ${expr};\n}\n`;

describe('a Math member takes a scalar, in both halves', () => {
  it('takes a scalar call of every member family, with the WGSL of the builtin', () => {
    const r = bothTake(`"use typeshade";
export function f(x: f32, y: f32): f32 {
  return Math.sqrt(x) + Math.max(x, y) + Math.min(x, 1.) + Math.pow(x, y) + Math.atan(y, x) + Math.cbrt(x) + Math.hypot(x, y);
}
`);
    expect(r.wgsl).toContain('sqrt(x)');
    expect(r.eval('f', [4, 3])).toBeCloseTo(
      Math.sqrt(4) + Math.max(4, 3) + Math.min(4, 1) + 4 ** 3 + Math.atan2(3, 4) + Math.cbrt(4) + 5,
      4,
    );
  });

  it('types a member as number->number in the editor', () => {
    const source = program('vec3(Math.max(x, 0.))');
    bothTake(source);
    const service = createTypeshadeLanguageService();
    service.openDocument('a.ts', source);
    const hover =
      service.getHover('a.ts', service.positionAt('a.ts', source.indexOf('Math.max') + 6))
        ?.contents ?? '';
    expect(hover).toContain('max(a: number, b: number): number');
    expect(hover).not.toContain('vec');
  });
});

describe('a vector argument is refused in both halves, with the WGSL name that takes it', () => {
  it.each([
    ['Math.sqrt(v)', 'Math.sqrt takes a number; for a vec3 write sqrt(v).'],
    ['Math.sin(v + w)', 'Math.sin takes a number; for a vec3 write sin(v + w).'],
    ['Math.max(v, 0.)', 'Math.max takes a number; for a vec3 write max(v, 0.).'],
    ['Math.min(v, w)', 'Math.min takes a number; for a vec3 write min(v, w).'],
    ['Math.pow(v, w)', 'Math.pow takes a number; for a vec3 write v ** w.'],
    ['Math.atan(v, w)', 'Math.atan takes a number; for a vec3 write atan2(v, w).'],
    ['Math.cbrt(v)', 'Math.cbrt takes a number.'],
    ['Math.hypot(v, w)', 'Math.hypot takes a number.'],
    ['Math.fround(v)', 'Math.fround takes a number.'],
  ])('%s', (expr, text) => {
    bothRefuse(program(expr), 'TS8003', text);
  });

  it('names the type of the vector argument that is not the first', () => {
    bothRefuse(
      program('Math.max(x, v)'),
      'TS8003',
      'Math.max takes a number; for a vec3 write max(x, v).',
    );
  });

  it('refuses a matrix too', () => {
    bothRefuse(
      `"use typeshade";\nexport function f(m: mat3): mat3 {\n  return Math.abs(m);\n}\n`,
      'TS8003',
      'Math.abs takes a number; for a mat3x3 write abs(m).',
    );
  });
});

describe('the WGSL name takes the vector, and a component is a scalar', () => {
  it('takes sqrt, max, min, abs and ** on vectors', () => {
    const r = bothTake(program('sqrt(abs(v)) + max(v, 0.) + min(v, w) + v ** w'));
    expect(r.wgsl).toContain('sqrt(');
    expect(r.wgsl).toContain('max(');
  });

  it('takes Math on a component', () => {
    bothTake(program('vec3(Math.sqrt(Math.abs(v.x)), Math.max(v.y, 0.), Math.min(v.z, w.z))'));
  });
});

describe('a name bound to a Math member is scalar too, min and max included (change 0113)', () => {
  const OPEN = (member: string, written: string, fix: string): string =>
    `"${written}" here is Math.${member}, which takes a scalar; ${fix}.`;

  it('refuses a bound max and min on a vector, with the sentence that names the fix', () => {
    bothRefuse(
      `"use typeshade";\nconst { max } = Math;\nexport function f(v: vec3): vec3 { return max(v, 0.); }\n`,
      'TS8003',
      OPEN('max', 'max', 'leave max out of the pattern to call the builtin, which takes a vector'),
    );
    bothRefuse(
      `"use typeshade";\nconst m = Math.min;\nexport function f(v: vec3, w: vec3): vec3 { return m(v, w); }\n`,
      'TS8003',
      OPEN('min', 'm', 'call the builtin min, which takes a vector'),
    );
  });

  it('takes a bound max and min on scalars', () => {
    const r = bothTake(
      `"use typeshade";\nconst { max, min } = Math;\nexport function f(x: f32): f32 { return max(min(x, 1.), 0.); }\n`,
    );
    expect(r.eval('f', [2])).toBe(1);
  });
});
