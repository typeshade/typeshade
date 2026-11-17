// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { createTypeshadeLanguageService, type TypeshadeLanguageService } from './service.js';

type Files = Readonly<Record<string, string>>;

const compiled = (files: Files, entry: string) =>
  compile(files[entry]!, { fileName: entry, readDocument: (name) => files[name] });

const errorsOf = (files: Files, entry: string): string[] =>
  compiled(files, entry)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${String(d.code)} ${d.message}`);

const opened = (
  files: Files,
  service: TypeshadeLanguageService = createTypeshadeLanguageService(),
) => {
  for (const [name, text] of Object.entries(files)) service.openDocument(name, text);
  return service;
};

const hoverAt = (
  service: TypeshadeLanguageService,
  files: Files,
  name: string,
  needle: string,
  skip = 0,
  from = '',
): string => {
  const text = files[name]!;
  const at = text.indexOf(needle, text.indexOf(from));
  expect(at, `"${needle}" is in ${name}`).toBeGreaterThanOrEqual(0);
  return service.getHover(name, service.positionAt(name, at + skip))?.contents ?? '';
};

const bare = (signature: string): string => `\`\`\`ts\n${signature}\n\`\`\``;

const LIB = '/p/lib.shade.ts';

const MAIN = '/p/main.shade.ts';

const ONE = '/p/one.shade.ts';

describe('the third review: stale names, another program’s instance, overloads', () => {
  it('an edit of the declaring file renames nothing in an importing file that did not change', () => {
    const lib = (order: 'light first' | 'other first') => {
      const light = `export interface Light {\n  power: f32;\n}\n`;
      const other = `export interface Other {\n  q: f32;\n}\n`;
      return `"use typeshade";
${order === 'light first' ? light + other : other + light}export const DEF: Light = { power: 1. };
export function lum(l: Light): f32 {
  return l.power;
}
export function oth(o: Other): f32 {
  return o.q;
}
`;
    };
    const main = `"use typeshade";
import { Light as L, lum, oth, DEF } from "./lib.shade.ts";
@fragment
export function fs(): vec4 {
  const d = DEF;
  return vec4(lum(d), oth({ q: d.power }), 0., 1.);
}
`;
    const before: Files = { [LIB]: lib('light first'), [MAIN]: main };
    const after: Files = { [LIB]: lib('other first'), [MAIN]: main };
    for (const files of [before, after]) {
      expect(errorsOf(files, MAIN)).toEqual([]);
      expect(compiled(files, MAIN).wgsl).toContain('fn oth(o: Other) -> f32 {');
    }
    const service = opened(before);
    const read = (files: Files) => {
      const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
      return [at('lum('), at('oth('), at('d = ', 0), at('q: d', 0)];
    };
    const expected = [
      bare('function lum(l: L): f32'),
      bare('function oth(o: Other): f32'),
      bare('const d: L'),
      bare('(property) Other.q: f32'),
    ];
    expect(read(before)).toEqual(expected);
    service.updateDocument(LIB, after[LIB]!, 2);
    expect(read(after)).toEqual(expected);
  });

  it('a library that uses one instance itself: an importing program with two keeps TypeScript’s text', () => {
    const files: Files = {
      [LIB]: `"use typeshade";
export function twice<T extends f32 | vec3>(x: T): T {
  return x;
}
export class Box<T extends f32 | vec3> {
  v: T;
}
export function selfUse(): f32 {
  const b = new Box<f32>();
  return twice(1.) + b.v;
}
`,
      [MAIN]: `"use typeshade";
import { twice, Box } from "./lib.shade.ts";
@fragment
export function fs(): vec4 {
  const q = twice(vec3(2.));
  const p = twice(1.);
  const bf = new Box<f32>();
  const bv = new Box<vec3>();
  return vec4(q.x + p + bf.v + bv.v.x, 0., 0., 1.);
}
`,
    };
    expect(errorsOf(files, LIB)).toEqual([]);
    expect(errorsOf(files, MAIN)).toEqual([]);
    const libWgsl = compiled(files, LIB).wgsl!;
    expect(libWgsl).toContain('fn twice_f32(x: f32) -> f32 {');
    expect(libWgsl).not.toContain('twice_vec3');
    const wgsl = compiled(files, MAIN).wgsl!;
    expect(wgsl).toContain('fn twice_vec3(x: vec3<f32>) -> vec3<f32> {');
    expect(wgsl).toContain('struct Box_vec3 {');
    const service = opened(files);
    const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
    expect(at('twice(vec3')).toBe(bare('(alias) twice<vec3>(x: vec3): vec3\nimport twice'));
    expect(at('twice(1.')).not.toContain('vec3');
    expect(at('bv.v', 3)).toBe(bare('(property) Box<vec3>.v: vec3'));
    expect(at('bf.v', 3)).toBe(bare('(property) Box<f32>.v: f32'));
  });

  it('a class of a namespace that the linker renamed reads by the names the author wrote', () => {
    const files: Files = {
      [LIB]: `"use typeshade";
export namespace Stage {
  export class VsOut {
    uv: vec2;
  }
}
export function f(o: Stage.VsOut): f32 {
  return o.uv.x;
}
`,
      [MAIN]: `"use typeshade";
import { f, Stage as S } from "./lib.shade.ts";
namespace Stage {
  export const K = 1.;
}
@fragment
export function fs(): vec4 {
  const o = new S.VsOut();
  return vec4(f(o), o.uv.y, Stage.K, 1.);
}
`,
    };
    expect(errorsOf(files, MAIN)).toEqual([]);
    expect(compiled(files, MAIN).wgsl).toContain('struct lib_Stage_VsOut {');
    const service = opened(files);
    const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
    expect(at('f(o)')).toBe(bare('function f(o: Stage_VsOut): f32'));
    expect(at('o.uv', 2)).toBe(bare('(property) Stage_VsOut.uv: vec2<f32>'));
    expect(at('o = new')).toBe(bare('const o: Stage_VsOut'));
  });

  it('a type-only import under a name of its own names the struct as a value import does', () => {
    const files: Files = {
      [LIB]: `"use typeshade";
export interface Light {
  power: f32;
}
export function lum(l: Light): f32 {
  return l.power;
}
`,
      [MAIN]: `"use typeshade";
import type { Light as Lt } from "./lib.shade.ts";
import { lum } from "./lib.shade.ts";
@fragment
export function fs(): vec4 {
  const a: Lt = { power: 1. };
  return vec4(lum(a), a.power, 0., 1.);
}
`,
    };
    expect(errorsOf(files, MAIN)).toEqual([]);
    const service = opened(files);
    const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
    expect(at('lum(a')).toBe(bare('function lum(l: Lt): f32'));
    expect(at('a.power', 2)).toBe(bare('(property) Lt.power: f32'));
  });

  it('an overloaded function reads its implementation in one file and imported', () => {
    const DECLS = `
export class Cell {
  x: f32;
}
export function bump(v: Cell, k: f32): void;
export function bump(v: Cell, k: f32): void {
  v.x = v.x * k;
}
`;
    const USES = `
@fragment
export function fs(): vec4 {
  let a = new Cell();
  a.x = 1.;
  bump(a, 2.);
  return vec4(a.x, 0., 0., 1.);
}
`;
    const files: Files = {
      [ONE]: `"use typeshade";${DECLS}${USES}`,
      [LIB]: `"use typeshade";${DECLS}`,
      [MAIN]: `"use typeshade";\nimport { bump as bp, Cell } from "./lib.shade.ts";${USES.replace('bump(a', 'bp(a')}`,
    };
    for (const name of [ONE, MAIN]) {
      expect(errorsOf(files, name)).toEqual([]);
      expect(compiled(files, name).wgsl).toMatch(/fn bump\(v: ptr<function, \w*Cell>, k: f32\) \{/);
    }
    const service = opened(files);
    expect(hoverAt(service, files, ONE, 'bump(a', 0, 'fs()')).toBe(
      bare('function bump(v: Cell, k: f32): void'),
    );
    expect(hoverAt(service, files, MAIN, 'bp(a', 0, 'fs()')).toBe(
      bare('function bp(v: Cell, k: f32): void'),
    );
  });

  it('a shorthand property reads the local it stands for, as before this change', () => {
    const files: Files = {
      [ONE]: `"use typeshade";
interface VsOut {
  pos: builtin<"position">;
  uv: vec2;
}
@vertex
export function vs(i: builtin<"vertex_index">): VsOut {
  const pos = vec4(f32(i), 0., 0., 1.);
  const uv = vec2(0., 1.);
  return { pos, uv };
}
`,
    };
    expect(errorsOf(files, ONE)).toEqual([]);
    const service = opened(files);
    expect(hoverAt(service, files, ONE, 'pos, uv }')).toBe(bare('const pos: vec4<f32>'));
  });
});

describe('the fourth review: nested namespaces', () => {
  it('a class of two nested namespaces that the linker renamed reads by the written names', () => {
    const files: Files = {
      [LIB]: `"use typeshade";
export namespace A {
  export namespace B {
    export class V {
      x: f32;
    }
  }
}
export function fv(v: A.B.V): f32 {
  return v.x;
}
`,
      [MAIN]: `"use typeshade";
import { fv } from "./lib.shade.ts";
namespace A {
  export namespace B {
    export class V {
      y: f32;
    }
  }
}
@fragment
export function fs(): vec4 {
  const w = new A.B.V();
  return vec4(fv({ x: 1. }), w.y, 0., 1.);
}
`,
    };
    expect(errorsOf(files, MAIN)).toEqual([]);
    const wgsl = compiled(files, MAIN).wgsl!;
    expect(wgsl).toContain('struct lib_A_B_V {');
    expect(wgsl).toContain('struct A_B_V {');
    const service = opened(files);
    const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
    expect(at('fv({')).toBe(bare('function fv(v: A_B_V): f32'));
    expect(at('w.y', 2)).toBe(bare('(property) A_B_V.y: f32'));
  });
});
