// The hover of a symbol that another `"use typeshade"` file declares reads as the hover of a
// local one: the type the compiler gave the declaration in the program (Rule 12.7). A program is
// a file and the shader files it imports (Rule 3.9), so the type is the one `compile()` of the
// hovered document emits.
//
// Each case is read by both halves on the same files: `compile()` of the linked program for the
// diagnostics and the emitted WGSL declaration, and the language service for the hover and the
// signature help. Each hover in the importing file is also held to the hover at the declaration
// in the declaring file, so the two are one text.
//
// Verifies: Rule 12.7 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import type ts from 'typescript';
import { compile } from '../compiler/ts/compile.js';
import {
  analyzeSourceFile,
  createTypeshadeLanguageService,
  createTypeshadeLanguageServiceWith,
  type TypeshadeLanguageService,
} from './service.js';

/** The files of one project, by the name each is opened and imported under. */
type Files = Readonly<Record<string, string>>;

/** The compiler half: the program that starts from `entry`, linked with what it imports. */
const compiled = (files: Files, entry: string) =>
  compile(files[entry]!, { fileName: entry, readDocument: (name) => files[name] });
/** The errors of that program. A GLSL-only shortfall is a warning and no subject here. */
const errorsOf = (files: Files, entry: string): string[] =>
  compiled(files, entry)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${String(d.code)} ${d.message}`);

/** The editor half: a service with every file of `files` open. */
const opened = (
  files: Files,
  service: TypeshadeLanguageService = createTypeshadeLanguageService(),
) => {
  for (const [name, text] of Object.entries(files)) service.openDocument(name, text);
  return service;
};
/** The hover of `service` in `name`, at the first `needle` after `from`, `skip` characters in. */
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
/** The labels of the signature help of `service` in `name`, just after the first `needle`. */
const signaturesAt = (
  service: TypeshadeLanguageService,
  files: Files,
  name: string,
  needle: string,
): string[] => {
  const at = files[name]!.indexOf(needle);
  expect(at, `"${needle}" is in ${name}`).toBeGreaterThanOrEqual(0);
  const help = service.getSignatureHelp(name, service.positionAt(name, at + needle.length));
  return (help?.signatures ?? []).map((s) => s.label);
};

/** A hover that is the signature alone. */
const bare = (signature: string): string => `\`\`\`ts\n${signature}\n\`\`\``;
/** A hover that is the signature and the lines under it, each a paragraph. */
const lines = (signature: string, ...each: string[]): string =>
  [bare(signature), ...each].join('\n\n');

const LIB = '/p/lib.shade.ts';
const MAIN = '/p/main.shade.ts';

/** What the library declares: one of each kind the hover reads from the compiler. */
const DECLARATIONS = `
export interface Light {
  dir: vec3;
  power: f32;
}
export type Pair = { a: vec2; b: f32 };
export class Ray {
  origin: vec3;
  t: f32;
  reach(k: f32): f32 {
    return this.t * k;
  }
  get far(): f32 {
    return this.t * 2.;
  }
  static unit(): f32 {
    return 1.;
  }
}
export function shade(n: vec3, steps: i32): f32 {
  let acc = 0.;
  for (let i = 0; i < steps; i++) acc += n.x;
  return acc;
}
export function bump(@inout v: f32, @out w: f32, k: f32): void {
  v = v + k;
  w = k;
}
export function twice<T extends f32 | vec3>(x: T): T {
  return x;
}
export const HALF = 0.5;
export const AXIS = vec3(0., 1., 0.);
export let frame: u32 = 0;
export const tint: override<f32> = 0.85;
declare const scene: uniform<Light>;
declare const data: storage<array<f32>>;
export { scene, data };
export namespace Tone {
  export const GAMMA = 2.2;
  export function map(x: f32): f32 {
    return x / (1. + x);
  }
}
export enum Mode {
  Flat,
  Lit,
}
`;

/** One use of each declaration. `q` is the namespace the names are read through, or none. */
const uses = (q: string): string => `
@fragment
export function fs(): vec4 {
  const l: ${q}Light = { dir: ${q}AXIS, power: ${q}HALF };
  const w: ${q}Pair = { a: vec2(1., 0.), b: 1. };
  const r = new ${q}Ray();
  let a = ${q}shade(l.dir, 2) * ${q}tint;
  let b: f32;
  ${q}bump(a, b, 2.);
  const c = ${q}twice(a) + b + r.t + r.origin.x;
  const d = r.reach(1.) + r.far + ${q}Ray.unit() + ${q}Tone.GAMMA + ${q}Tone.map(1.);
  const m: ${q}Mode = ${q}Mode.Lit;
  const e = ${q}scene.power + f32(${q}frame) + ${q}data[0] + f32(m);
  return vec4(a + c, w.a.x + w.b, d + e, l.power);
}
`;
const NAMES =
  'Light, Pair, Ray, shade, bump, twice, HALF, AXIS, frame, tint, scene, data, Tone, Mode';

/** The same program four ways: in one file, and with its declarations in `lib.shade.ts`, read
 *  by name, through a file that re-exports them, and through a namespace import. */
const ONE = '/p/one.shade.ts';
const MID = '/p/mid.shade.ts';
const VIA = '/p/via.shade.ts';
const NS = '/p/ns.shade.ts';
const FILES: Files = {
  [ONE]: `"use typeshade";${DECLARATIONS}${uses('')}`,
  [LIB]: `"use typeshade";${DECLARATIONS}`,
  [MAIN]: `"use typeshade";\nimport { ${NAMES} } from "./lib.shade.ts";${uses('')}`,
  [MID]: `"use typeshade";\nexport { ${NAMES} } from "./lib.shade.ts";\n`,
  [VIA]: `"use typeshade";\nimport { ${NAMES} } from "./mid.shade.ts";${uses('')}`,
  [NS]: `"use typeshade";\nimport * as lib from "./lib.shade.ts";${uses('lib.')}`,
};
const IMPORTERS = [MAIN, VIA, NS] as const;

/** A name at a use, in the body of `fs`: the text to find, and how far into it the name is.
 *  `ns` is the same for the file that reads the names through `lib.`. */
interface Use {
  readonly needle: string;
  readonly skip: number;
  readonly ns?: readonly [needle: string, skip: number];
}
const useOf = (name: string, use: Use): readonly [string, number] =>
  name === NS && use.ns !== undefined ? use.ns : [use.needle, use.skip];

describe('the hover of a symbol another document declares is the compiler’s (Rule 12.7)', () => {
  const service = opened(FILES);
  const inFs = (name: string, use: Use): string => {
    const [needle, skip] = useOf(name, use);
    return hoverAt(service, FILES, name, needle, skip, 'export function fs');
  };

  it('the four programs compile, and emit the declarations the hovers are held to', () => {
    for (const name of [ONE, ...IMPORTERS]) {
      expect(errorsOf(FILES, name), name).toEqual([]);
      expect(
        service.getDiagnostics(name).filter((d) => d.severity === 'error'),
        name,
      ).toEqual([]);
      const wgsl = compiled(FILES, name).wgsl!;
      for (const declaration of [
        'override tint: f32 = 0.85;',
        'const HALF: f32 = 0.5;',
        'const AXIS: vec3<f32> = vec3<f32>(0.0, 1.0, 0.0);',
        '  dir: vec3<f32>,',
        '  a: vec2<f32>,',
        '  origin: vec3<f32>,',
        'var<private> frame: u32 = 0u;',
        '@group(0) @binding(0) var<uniform> scene: Light;',
        '@group(0) @binding(1) var<storage, read> data: array<f32>;',
        'fn shade(n: vec3<f32>, steps: i32) -> f32 {',
        'fn bump(v: ptr<function, f32>, w: ptr<function, f32>, k: f32) {',
        'fn twice_f32(x: f32) -> f32 {',
      ])
        expect(wgsl, `${name}: ${declaration}`).toContain(declaration);
    }
  });

  // Each row: what is hovered, where, and the whole hover text. The text is the one the file
  // that declares the symbol itself shows (`one.shade.ts`), and the importing files show it by
  // name, through a re-export and through a namespace import.
  const rows: readonly (readonly [what: string, use: Use, text: string])[] = [
    [
      'a field of an interface',
      { needle: 'l.dir', skip: 2 },
      bare('(property) Light.dir: vec3<f32>'),
    ],
    ['a field of a type alias', { needle: 'w.a.x', skip: 2 }, bare('(property) Pair.a: vec2<f32>')],
    [
      'a field of a class',
      { needle: 'r.origin', skip: 2 },
      bare('(property) Ray.origin: vec3<f32>'),
    ],
    [
      'a field read through an imported binding',
      { needle: 'scene.power', skip: 6, ns: ['lib.scene.power', 10] },
      bare('(property) Light.power: f32'),
    ],
    [
      'a function',
      { needle: 'shade(l', skip: 0, ns: ['lib.shade(l', 4] },
      bare('function shade(n: vec3<f32>, steps: i32): f32'),
    ],
    [
      'a function with @inout and @out parameters',
      { needle: 'bump(a', skip: 0, ns: ['lib.bump(a', 4] },
      bare('function bump(@inout v: f32, @out w: f32, k: f32): void'),
    ],
    [
      'an instance of a generic function',
      { needle: 'twice(a', skip: 0, ns: ['lib.twice(a', 4] },
      bare('function twice(x: f32): f32'),
    ],
    [
      'a module constant written as a number',
      { needle: 'HALF }', skip: 0, ns: ['lib.HALF }', 4] },
      bare('const HALF: f32'),
    ],
    [
      'a module constant that is a vector',
      { needle: 'AXIS,', skip: 0, ns: ['lib.AXIS,', 4] },
      bare('const AXIS: vec3<f32>'),
    ],
    [
      'a module variable',
      { needle: 'frame)', skip: 0, ns: ['lib.frame)', 4] },
      bare('let frame: u32'),
    ],
    ['an override', { needle: 'tint;', skip: 0, ns: ['lib.tint;', 4] }, bare('const tint: f32')],
    [
      'a uniform binding, with its slot',
      { needle: 'scene.power', skip: 0, ns: ['lib.scene.power', 4] },
      lines('const scene: Light', 'uniform resource at @group(0) @binding(0)'),
    ],
    [
      'a storage binding, with its access mode and its slot',
      { needle: 'data[0]', skip: 0, ns: ['lib.data[0]', 4] },
      lines('const data: array<f32>', 'read storage resource at @group(0) @binding(1)'),
    ],
  ];
  for (const [what, use, text] of rows)
    it(`${what}: one text in the declaring file and across an import`, () => {
      expect(inFs(ONE, use), 'declared in the hovered file').toBe(text);
      for (const name of IMPORTERS) expect(inFs(name, use), name).toBe(text);
    });

  it('the declaration in the library reads the same text as the use in the importing file', () => {
    const atDeclaration = (needle: string, skip = 0): string =>
      hoverAt(service, FILES, LIB, needle, skip);
    expect(atDeclaration('dir: vec3;')).toBe(bare('(property) Light.dir: vec3<f32>'));
    expect(atDeclaration('a: vec2;')).toBe(bare('(property) Pair.a: vec2<f32>'));
    expect(atDeclaration('origin: vec3;')).toBe(bare('(property) Ray.origin: vec3<f32>'));
    expect(atDeclaration('shade(n')).toBe(bare('function shade(n: vec3<f32>, steps: i32): f32'));
    expect(atDeclaration('bump(@inout')).toBe(
      bare('function bump(@inout v: f32, @out w: f32, k: f32): void'),
    );
    expect(atDeclaration('HALF = ')).toBe(bare('const HALF: f32'));
    expect(atDeclaration('AXIS = ')).toBe(bare('const AXIS: vec3<f32>'));
    expect(atDeclaration('frame: u32')).toBe(bare('let frame: u32'));
    expect(atDeclaration('tint: override')).toBe(bare('const tint: f32'));
    expect(atDeclaration('scene: uniform')).toBe(
      lines('const scene: Light', 'uniform resource at @group(0) @binding(0)'),
    );
    expect(atDeclaration('data: storage')).toBe(
      lines('const data: array<f32>', 'read storage resource at @group(0) @binding(1)'),
    );
  });

  it('a member keeps TypeScript’s quick info, as it does in one file', () => {
    // The hover in one file reads a recorded symbol only under the hovered name, and the
    // front end records a member under a longer one, so each of these is TypeScript's text
    // there. Across an import it is the same text.
    const members: readonly (readonly [Use, string])[] = [
      [{ needle: 'r.reach', skip: 2 }, bare('(method) Ray.reach(k: f32): f32')],
      [{ needle: 'r.far', skip: 2 }, bare('(property) Ray.far: f32')],
      [{ needle: 'Ray.unit', skip: 4, ns: ['lib.Ray.unit', 8] }, bare('(method) Ray.unit(): f32')],
      [{ needle: 'Tone.GAMMA', skip: 5, ns: ['lib.Tone.GAMMA', 9] }, bare('const Tone.GAMMA: 2.2')],
      [
        { needle: 'Tone.map', skip: 5, ns: ['lib.Tone.map', 9] },
        bare('function Tone.map(x: f32): f32'),
      ],
      [
        { needle: 'Mode.Lit', skip: 5, ns: ['lib.Mode.Lit', 9] },
        bare('(enum member) Mode.Lit = 1'),
      ],
    ];
    for (const [use, text] of members)
      for (const name of [ONE, ...IMPORTERS]) expect(inFs(name, use), name).toBe(text);
  });

  it('signature help of an imported function shows its qualifiers (Rule 8.25)', () => {
    // The compiler takes both as pointers, and the test above holds the emit to that.
    const label = ['bump(@inout v: f32, @out w: f32, k: f32): void'];
    expect(signaturesAt(service, FILES, ONE, '  bump(')).toEqual(label);
    expect(signaturesAt(service, FILES, MAIN, '  bump(')).toEqual(label);
    expect(signaturesAt(service, FILES, VIA, '  bump(')).toEqual(label);
    expect(signaturesAt(service, FILES, NS, '  lib.bump(')).toEqual(label);
    // A function with no qualifier is unchanged.
    expect(signaturesAt(service, FILES, MAIN, '= shade(')).toEqual(
      signaturesAt(service, FILES, ONE, '= shade('),
    );
  });
});

describe('the name a hover shows is the declaring file’s, not the module’s', () => {
  it('a renamed import, beside declarations of the same names in the importing file', () => {
    // Both files declare `Light`, `HALF` and `shade`. The module emits the library's under
    // names of its own, which no author wrote.
    const files: Files = {
      [LIB]: `"use typeshade";
export interface Light {
  dir: vec3;
}
export const HALF = 0.5;
export function shade(n: vec3): f32 {
  return n.x;
}
`,
      [MAIN]: `"use typeshade";
import { Light as L, HALF as H, shade as s } from "./lib.shade.ts";
interface Light {
  dir: vec4;
}
const HALF = vec2(0.5, 0.5);
function shade(n: vec4): f32 {
  return n.w;
}
@fragment
export function fs(): vec4 {
  const far: L = { dir: vec3(0., 0., 1.) };
  const near: Light = { dir: vec4(0., 0., 1., 1.) };
  return vec4(s(far.dir) * H, shade(near.dir), HALF.x, 1.);
}
`,
    };
    expect(errorsOf(files, MAIN)).toEqual([]);
    const wgsl = compiled(files, MAIN).wgsl!;
    expect(wgsl).toContain('struct lib_Light {');
    expect(wgsl).toContain('const lib_HALF: f32 = 0.5;');
    expect(wgsl).toContain('fn lib_shade(n: vec3<f32>) -> f32 {');
    const service = opened(files);
    const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
    // The library's, under the names the library writes.
    expect(at('far.dir', 4)).toBe(bare('(property) Light.dir: vec3<f32>'));
    expect(at('* H', 2)).toBe(bare('const HALF: f32'));
    expect(at('s(far')).toBe(bare('function shade(n: vec3<f32>): f32'));
    expect(hoverAt(service, files, LIB, 'HALF = ')).toBe(bare('const HALF: f32'));
    expect(hoverAt(service, files, LIB, 'shade(n')).toBe(bare('function shade(n: vec3<f32>): f32'));
    // The importing file's own, unchanged.
    expect(at('near.dir', 5)).toBe(bare('(property) Light.dir: vec4<f32>'));
    expect(at('HALF.x')).toBe(bare('const HALF: vec2<f32>'));
    expect(at('shade(near')).toBe(bare('function shade(n: vec4<f32>): f32'));
  });

  it('an imported file that is not open is read through the host', () => {
    const files: Files = { [LIB]: FILES[LIB]!, [MAIN]: FILES[MAIN]! };
    const service = createTypeshadeLanguageService({ readDocument: (uri) => files[uri] });
    service.openDocument(MAIN, files[MAIN]!);
    expect(hoverAt(service, files, MAIN, 'HALF }', 0, 'fs()')).toBe(bare('const HALF: f32'));
    expect(hoverAt(service, files, MAIN, 'scene.power', 0, 'fs()')).toBe(
      lines('const scene: Light', 'uniform resource at @group(0) @binding(0)'),
    );
  });

  it('a field no program lowers keeps TypeScript’s quick info', () => {
    // The front end records a field only where a program uses its struct. With the library
    // open alone, no program does, and TypeScript's text is all there is.
    const alone = createTypeshadeLanguageService();
    alone.openDocument(LIB, FILES[LIB]!);
    expect(hoverAt(alone, FILES, LIB, 'a: vec2;')).toBe(bare('(property) a: vec2'));
    // With a document that imports it open, the program of that document lowers the struct.
    alone.openDocument(MAIN, FILES[MAIN]!);
    expect(hoverAt(alone, FILES, LIB, 'a: vec2;')).toBe(bare('(property) Pair.a: vec2<f32>'));
  });
});

describe('the hover of an imported symbol runs no analysis that the service does not keep', () => {
  it('one analysis of the hovered document, and none after it', () => {
    let runs: string[] = [];
    const analyze = (sf: ts.SourceFile, imports?: Parameters<typeof analyzeSourceFile>[1]) => {
      runs.push(sf.fileName);
      return analyzeSourceFile(sf, imports);
    };
    const files: Files = { [LIB]: FILES[LIB]!, [MAIN]: FILES[MAIN]! };
    const service = opened(files, createTypeshadeLanguageServiceWith({}, analyze));
    runs = [];
    for (const needle of ['HALF }', 'shade(l', 'scene.power', 'frame)'])
      hoverAt(service, files, MAIN, needle, 0, 'fs()');
    expect(runs).toEqual([MAIN]);
  });
});
