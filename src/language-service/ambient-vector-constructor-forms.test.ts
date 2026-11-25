import { describe, expect, it } from 'vitest';
import { analyzeSourceFile, createTypeshadeLanguageServiceWith } from './service.js';
import { SHADE_DTS } from './ambient.js';
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

const F64_VECTOR = 'const a = vec3f64(f64(1.), f64(2.), f64(3.))\n';

describe('the type argument of a vector constructor', () => {
  it('is taken by the plain names, in each element kind', () => {
    takes('const a = vec3<u32>(1, 2, 3)\n const b = vec2<i32>(1, 2)\n const c = vec4<f32>(1.)');
  });

  it('is refused on a short name, which names its element already', () => {
    refuses('const a = vec3u<f32>(1, 2, 3)', 2558, 'TS8003');
    refuses('const a = vec3i<u32>(1, 2, 3)', 2558, 'TS8003');
  });

  it('is written for the bool forms', () => {
    takes('const a = vec3<bool>(true, false, true)\n const b = vec4<bool>(true)');
  });
});

describe('the components of a vector constructor', () => {
  it('never mix a bool into a number vector', () => {
    refuses('const a = vec3(1., true, 2.)', 2769, 'TS8003');
  });

  it('are bool on a bool vector and on the short bool name', () => {
    takes('const a = vec3b(true, false, true)\n const b = vec2b(true)');
  });
});

describe('the zero value of a vector constructor', () => {
  it('is spelled with no argument on a native vector', () => {
    takes('const a = vec3()\n const b = vec2i()\n const c = vec4u()\n const d = vec3b()');
  });

  it('has no spelling on an emulated-double vector', () => {
    refuses('const a = vec3f64()', 2554, 'TS8019');
  });
});

describe('the compositions of a vector constructor', () => {
  const forms: Readonly<Record<string, string>> = {
    'vec3(vec2, z)': 'const a = vec3(uv, 1.)',
    'vec3(x, vec2)': 'const a = vec3(1., uv)',
    'vec4(vec3, w)': 'const a = vec4(vec3(1., 2., 3.), 1.)',
    'vec4(vec2, z, w)': 'const a = vec4(uv, 1., 1.)',
    'vec4(x, vec2, w)': 'const a = vec4(1., uv, 1.)',
    'vec4(x, y, vec2)': 'const a = vec4(1., 1., uv)',
    'vec4(x, vec3)': 'const a = vec4(1., vec3(1., 2., 3.))',
    'vec4(vec2, vec2)': 'const a = vec4(uv, uv)',
    'vec4(mix(c * 0.5, d, 0.5), w)':
      'const c = vec3(1., 2., 3.)\n const d = vec3(3., 2., 1.)\n const a = vec4(mix(c * 0.5, d, 0.5), 1.)',
  };
  for (const [name, body] of Object.entries(forms)) {
    it(`takes ${name}`, () => takes(body));
  }
});

describe('the whole-vector forms of a vector constructor', () => {
  it('takes a vector of its own type', () => {
    takes('const w = vec3(1., 2., 3.)\n const a = vec3(w)\n const b = vec3i(vec3i(1, 2, 3))');
  });

  it('converts between the three native element kinds of one size', () => {
    takes(
      'const f = vec3(1., 2., 3.)\n const i = vec3i(f)\n const u = vec3u(i)\n const g = vec3(u)\n const h = vec3(i)\n const j = vec3i(u)',
    );
  });

  it('converts no vector of another size', () => {
    refuses('const w = vec2i(1, 2)\n const a = vec3i(w)', 2769, 'TS8019');
  });

  it('gives a constructor of doubles no converting form', () => {
    refuses('const w = vec3(1., 2., 3.)\n const a = vec3f64(w)', 2345, 'TS8003');
  });

  it('narrows a vector of doubles in the f32 constructor of its own size', () => {
    takes(`${F64_VECTOR}const b = vec3(a)\n const c: vec3 = vec3(a)`);
  });

  it('narrows a vector of doubles in no other constructor', () => {
    refuses(`${F64_VECTOR}const b = vec3i(a)`, 2769, 'TS8003');
    refuses(`${F64_VECTOR}const b = vec3u(a)`, 2769, 'TS8003');
  });
});

describe('the element aliases of a vector', () => {
  it('names the same type as the canonical name', () => {
    takes(
      `${F64_VECTOR}const f: vec3f = vec3(1., 2., 3.)\n const d: vec3d = a\n const b: vec2b = vec2b(true)\n const i: vec3i = vec3i(1, 2, 3)\n const u: vec4u = vec4u(1)`,
    );
  });

  it('keeps one element kind apart from another', () => {
    for (const alias of ['vec3i', 'vec3b', 'vec3d', 'vec3u']) {
      refuses(
        `function g(v: ${alias}): f32 { return 1. }\n const w = vec3(1., 2., 3.)\n const a = g(w)`,
        2345,
        'TS8003',
      );
    }
  });

  it('is not a constructor when it ends in d', () => {
    expect(SHADE_DTS).not.toMatch(/declare function vec[234]d\b/);
    expect(SHADE_DTS).toMatch(/declare function vec3f64\b/);
    refuses('const a = vec3d(f64(1.), f64(2.), f64(3.))', undefined, 'TS8004');
  });
});
