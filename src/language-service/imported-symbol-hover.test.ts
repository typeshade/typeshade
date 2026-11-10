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

import { readFileSync } from 'node:fs';
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
    // A generic function has no instance in the library's own program. Only a field is read
    // in the program of a document that imports the file, so the declaration keeps
    // TypeScript's generic text, though each importing program lowers one instance.
    expect(atDeclaration('twice<T')).toBe(bare('function twice<T extends f32 | vec3>(x: T): T'));
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

  it('a static field keeps TypeScript’s quick info, as it does in one file', () => {
    // The front end records a static field as a constant under a longer name (`Ray_UP`).
    const declarations = `
export class Ray {
  t: f32;
  static readonly UP = vec3(0., 1., 0.);
}
`;
    const body = `
@fragment
export function fs(): vec4 {
  const r = new Ray();
  return vec4(r.t + Ray.UP.y, 0., 0., 1.);
}
`;
    const files: Files = {
      [ONE]: `"use typeshade";${declarations}${body}`,
      [LIB]: `"use typeshade";${declarations}`,
      [MAIN]: `"use typeshade";\nimport { Ray } from "./lib.shade.ts";${body}`,
    };
    const statics = opened(files);
    for (const name of [ONE, MAIN]) {
      expect(errorsOf(files, name)).toEqual([]);
      expect(compiled(files, name).wgsl).toContain(
        'const Ray_UP: vec3<f32> = vec3<f32>(0.0, 1.0, 0.0);',
      );
      expect(hoverAt(statics, files, name, 'Ray.UP', 4, 'fs()'), name).toBe(
        bare('(property) Ray.UP: vec3'),
      );
    }
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

describe('the name a hover shows is the one the hovered file writes, never the module’s', () => {
  it('a renamed import, beside declarations of the same names in the importing file', () => {
    // Both files declare `Light`, `HALF`, `shade` and `frame`. The module emits the library's
    // under names of its own, which no author wrote. The importing file reads each under an
    // alias, and the hover shows the alias, as signature help does (the owner's decision of
    // 2026-11-10).
    const files: Files = {
      [LIB]: `"use typeshade";
export interface Light {
  dir: vec3;
}
export const HALF = 0.5;
export let frame: u32 = 0;
export const tint: override<f32> = 0.85;
declare const scene: uniform<Light>;
export { scene };
export function shade(@inout n: vec3, k: f32): f32 {
  n = n * k;
  return n.x;
}
`,
      [MAIN]: `"use typeshade";
import { Light as L, HALF as H, frame as fr, tint as tn, scene as sc, shade as s } from "./lib.shade.ts";
interface Light {
  dir: vec4;
}
const HALF = vec2(0.5, 0.5);
const frame = 2.;
function shade(n: vec4): f32 {
  return n.w;
}
@fragment
export function fs(): vec4 {
  let far: L = { dir: vec3(0., 0., 1.) };
  const near: Light = { dir: vec4(0., 0., 1., 1.) };
  const a = s(far.dir, H) + f32(fr) * tn + sc.dir.x;
  return vec4(a, shade(near.dir), HALF.x, frame);
}
`,
    };
    expect(errorsOf(files, MAIN)).toEqual([]);
    const wgsl = compiled(files, MAIN).wgsl!;
    expect(wgsl).toContain('struct lib_Light {');
    expect(wgsl).toContain('  dir: vec3<f32>,');
    expect(wgsl).toContain('const lib_HALF: f32 = 0.5;');
    expect(wgsl).toContain('var<private> lib_frame: u32 = 0u;');
    expect(wgsl).toContain('override tint: f32 = 0.85;');
    expect(wgsl).toContain('@group(0) @binding(0) var<uniform> scene: lib_Light;');
    expect(wgsl).toContain('fn lib_shade(n: ptr<function, vec3<f32>>, k: f32) -> f32 {');
    const service = opened(files);
    const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
    // The library's, under the names this file gives them.
    expect(at('far.dir', 4)).toBe(bare('(property) L.dir: vec3<f32>'));
    expect(at('far: L')).toBe(bare('let far: L'));
    expect(at(', H)', 2)).toBe(bare('const H: f32'));
    // A module variable stays `let`: the module's variable is found under its emitted name,
    // and this file's own `frame` is a constant.
    expect(at('fr)')).toBe(bare('let fr: u32'));
    expect(at('tn +')).toBe(bare('const tn: f32'));
    expect(at('sc.dir')).toBe(lines('const sc: L', 'uniform resource at @group(0) @binding(0)'));
    expect(at('s(far')).toBe(bare('function s(@inout n: vec3<f32>, k: f32): f32'));
    expect(signaturesAt(service, files, MAIN, '= s(')).toEqual([
      's(@inout n: vec3<f32>, k: f32): f32'.replace('vec3<f32>', 'vec3'),
    ]);
    // In the library, under the names the library writes.
    expect(hoverAt(service, files, LIB, 'HALF = ')).toBe(bare('const HALF: f32'));
    expect(hoverAt(service, files, LIB, 'shade(@inout')).toBe(
      bare('function shade(@inout n: vec3<f32>, k: f32): f32'),
    );
    expect(hoverAt(service, files, LIB, 'dir: vec3;')).toBe(
      bare('(property) Light.dir: vec3<f32>'),
    );
    // The importing file's own, unchanged.
    expect(at('near.dir', 5)).toBe(bare('(property) Light.dir: vec4<f32>'));
    expect(at('near: Light')).toBe(bare('const near: Light'));
    expect(at('HALF.x')).toBe(bare('const HALF: vec2<f32>'));
    expect(at('frame);')).toBe(bare('const frame: f32'));
    expect(at('shade(near')).toBe(bare('function shade(n: vec4<f32>): f32'));
  });

  it('a name the linker generated shows nowhere in a hover: a type, a parameter, a struct', () => {
    // The importing file declares its own `Light` and `K`, and imports neither by name. The
    // module emits the library's as `lib_Light` and `lib_K`, and the library's parameter `K`
    // as `lib_K`. Each reads as the library writes it.
    const files: Files = {
      [LIB]: `"use typeshade";
export interface Light {
  power: f32;
}
export interface Scene {
  key: Light;
  all: array<Light, 2>;
}
export const K = 0.25;
export const DEF: Light = { power: 1. };
declare const one: uniform<Light>;
export { one };
export function lum(l: Light, scale: f32): f32 {
  return l.power * scale * K;
}
export function mk(): Light {
  return { power: K };
}
export function third(K: f32): f32 {
  return K / 3.;
}
`,
      [MAIN]: `"use typeshade";
import { Scene, DEF, one, lum, mk, third } from "./lib.shade.ts";
interface Light {
  c: f32;
}
const K = 2.;
function inner(third: f32): f32 {
  return third * K;
}
@fragment
export function fs(): vec4 {
  const mine: Light = { c: 1. };
  const made = mk();
  const sc: Scene = { key: made, all: [DEF, one] };
  const a = lum(sc.key, K) + third(1.) + lum(sc.all[0], 1.) + inner(mine.c);
  return vec4(a, DEF.power, one.power, 1.);
}
`,
    };
    expect(errorsOf(files, MAIN)).toEqual([]);
    const wgsl = compiled(files, MAIN).wgsl!;
    expect(wgsl).toContain('struct lib_Light {');
    expect(wgsl).toContain('const lib_K: f32 = 0.25;');
    expect(wgsl).toContain('fn lum(l: ptr<function, lib_Light>, scale: f32) -> f32 {');
    expect(wgsl).toContain('  key: lib_Light,');
    // This file's own parameter `third` is emitted under a generated name too.
    expect(wgsl).toContain('fn inner(main_third: f32) -> f32 {');
    const service = opened(files);
    const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
    const texts = [
      [at('lum(sc.key'), 'function lum(l: Light, scale: f32): f32'],
      [at('mk()'), 'function mk(): Light'],
      [at('third(1.)'), 'function third(K: f32): f32'],
      [at('DEF, one'), 'const DEF: Light'],
      [at('made = '), 'const made: Light'],
      [at('sc.key', 3), '(property) Scene.key: Light'],
      [at('sc.all', 3), '(property) Scene.all: array<Light, 2>'],
      // This file's own, which the module emits under their written names.
      [at('mine: Light'), 'const mine: Light'],
      [at('inner(mine'), 'function inner(third: f32): f32'],
    ] as const;
    for (const [hover, text] of texts) expect(hover).toBe(bare(text));
    expect(at('one.power')).toBe(
      lines('const one: Light', 'uniform resource at @group(0) @binding(0)'),
    );
    for (const [hover] of texts) expect(hover).not.toMatch(/lib_|main_/);
    // The library shows the same texts for its own declarations.
    expect(hoverAt(service, files, LIB, 'lum(l')).toBe(
      bare('function lum(l: Light, scale: f32): f32'),
    );
    expect(hoverAt(service, files, LIB, 'third(K')).toBe(bare('function third(K: f32): f32'));
  });

  it('a file named as the struct it declares: the linker’s prefix is the struct’s own name', () => {
    const NAMED = '/p/Light.shade.ts';
    const files: Files = {
      [NAMED]: `"use typeshade";
export interface Light {
  power: f32;
}
export function glow(l: Light): f32 {
  return l.power;
}
`,
      [MAIN]: `"use typeshade";
import { glow } from "./Light.shade.ts";
interface Light {
  c: f32;
}
@fragment
export function fs(): vec4 {
  const own: Light = { c: 1. };
  return vec4(glow({ power: own.c }), 0., 0., 1.);
}
`,
    };
    expect(errorsOf(files, MAIN)).toEqual([]);
    expect(compiled(files, MAIN).wgsl).toContain('struct Light_Light {');
    const service = opened(files);
    expect(hoverAt(service, files, MAIN, 'glow(', 0, 'fs()')).toBe(
      bare('function glow(l: Light): f32'),
    );
    expect(hoverAt(service, files, MAIN, 'power:', 0, 'fs()')).toBe(
      bare('(property) Light.power: f32'),
    );
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

describe('a declaration lowered as more than one instance keeps TypeScript’s quick info', () => {
  // The front end lowers a generic function and a generic class once for each instance, and
  // records each at the one declaration. A hover must not show a call the type of another
  // instance (Rule 12.7).
  const GENERIC = `
export function twice<T extends f32 | vec3>(x: T): T {
  return x;
}
export class Box<T extends f32 | vec3> {
  v: T;
}
`;
  const USES = `
@fragment
export function fs(): vec4 {
  const q = twice(vec3(2.));
  const p = twice(1.);
  const bf = new Box<f32>();
  const bv = new Box<vec3>();
  return vec4(q.x + p + bf.v + bv.v.x, 0., 0., 1.);
}
`;
  const files: Files = {
    [ONE]: `"use typeshade";${GENERIC}${USES}`,
    [LIB]: `"use typeshade";${GENERIC}`,
    [MAIN]: `"use typeshade";\nimport { twice, Box } from "./lib.shade.ts";${USES}`,
  };
  const service = opened(files);
  const at = (name: string, needle: string, skip = 0) =>
    hoverAt(service, files, name, needle, skip, 'fs()');

  it('both programs emit both instances', () => {
    for (const name of [ONE, MAIN]) {
      expect(errorsOf(files, name)).toEqual([]);
      const wgsl = compiled(files, name).wgsl!;
      for (const declaration of [
        'fn twice_vec3(x: vec3<f32>) -> vec3<f32> {',
        'fn twice_f32(x: f32) -> f32 {',
        'struct Box_f32 {',
        'struct Box_vec3 {',
      ])
        expect(wgsl, `${name}: ${declaration}`).toContain(declaration);
    }
  });

  it('each call of a generic function names its own instance', () => {
    expect(at(MAIN, 'twice(vec3')).toBe(bare('(alias) twice<vec3>(x: vec3): vec3\nimport twice'));
    expect(at(MAIN, 'twice(1.')).toBe(bare('(alias) twice<1>(x: 1): 1\nimport twice'));
    expect(at(ONE, 'twice(vec3')).toBe(bare('function twice<vec3>(x: vec3): vec3'));
    expect(at(ONE, 'twice(1.')).toBe(bare('function twice<1>(x: 1): 1'));
    // No hover shows a call the other instance.
    expect(at(MAIN, 'twice(1.')).not.toContain('vec3');
    expect(at(ONE, 'twice(1.')).not.toContain('vec3');
  });

  it('each field of a generic class names its own instance', () => {
    for (const name of [ONE, MAIN]) {
      expect(at(name, 'bf.v', 3), name).toBe(bare('(property) Box<f32>.v: f32'));
      expect(at(name, 'bv.v', 3), name).toBe(bare('(property) Box<vec3>.v: vec3'));
    }
    // At the declaration, which is no one instance, the text is the generic one.
    expect(hoverAt(service, files, LIB, 'v: T')).toBe(
      bare('(property) Box<T extends f32 | vec3>.v: T extends f32 | vec3'),
    );
  });

  it('a generic function’s declaration in the library is not read in an importing program', () => {
    // The library's own program lowers no instance. Only a field is read in the program of a
    // document that imports the file.
    expect(hoverAt(service, files, LIB, 'twice<T')).toBe(
      bare('function twice<T extends f32 | vec3>(x: T): T'),
    );
  });
});

describe('an import the hovered file’s program does not keep', () => {
  const files: Files = {
    [LIB]: `"use typeshade";
export const K = 0.5;
export const J: u32 = 3;
export function g(@inout a: f32): f32 {
  a = a + 1.;
  return a;
}
`,
    [MAIN]: `"use typeshade";
import { K, J, g } from "./lib.shade.ts";
@fragment
export function fs(): vec4 {
  return vec4(f32(J), 0., 0., 1.);
}
`,
  };

  it('reads the declaring document’s own program, when that document is open', () => {
    // `K` and `g` are imported and not used yet, so the program of `main.shade.ts` drops them.
    expect(errorsOf(files, MAIN)).toEqual([]);
    const wgsl = compiled(files, MAIN).wgsl!;
    expect(wgsl).toContain('const J: u32 = 3u;');
    expect(wgsl).not.toContain('const K');
    expect(wgsl).not.toContain('fn g(');
    // The library's own program holds them, as the types its hover shows.
    expect(compiled(files, LIB).wgsl).toContain('const K: f32 = 0.5;');
    const service = opened(files);
    const inImport = (needle: string) => hoverAt(service, files, MAIN, needle, 0, 'import {');
    expect(inImport('K,')).toBe(bare('const K: f32'));
    expect(inImport('g }')).toBe(bare('function g(@inout a: f32): f32'));
    expect(inImport('J,')).toBe(bare('const J: u32'));
    expect(hoverAt(service, files, LIB, 'K = ')).toBe(bare('const K: f32'));
  });

  it('keeps TypeScript’s quick info when the declaring document is not open', () => {
    const service = createTypeshadeLanguageService({ readDocument: (uri) => files[uri] });
    service.openDocument(MAIN, files[MAIN]!);
    expect(hoverAt(service, files, MAIN, 'K,', 0, 'import {')).toBe(
      bare('(alias) const K: 0.5\nimport K'),
    );
    // A used import is read in this document's program, open or not.
    expect(hoverAt(service, files, MAIN, 'J,', 0, 'import {')).toBe(bare('const J: u32'));
  });
});

describe('an override in the file that declares it reads the compiler’s type', () => {
  it('override<bool> is `bool`, and an exported override has no `export` line', () => {
    const SOLO = '/p/solo.shade.ts';
    const files: Files = {
      [SOLO]: `"use typeshade";
export const flag: override<bool> = true;
const bias: override<f32> = 0.5;
export { bias };
@fragment
export function fs(): vec4 {
  return vec4(flag ? bias : 0., 0., 0., 1.);
}
`,
    };
    expect(errorsOf(files, SOLO)).toEqual([]);
    const wgsl = compiled(files, SOLO).wgsl!;
    expect(wgsl).toContain('override flag: bool = true;');
    expect(wgsl).toContain('override bias: f32 = 0.5;');
    const service = opened(files);
    // TypeScript's quick info said `const flag: boolean`.
    expect(hoverAt(service, files, SOLO, 'flag: override')).toBe(bare('const flag: bool'));
    expect(hoverAt(service, files, SOLO, 'flag ?')).toBe(bare('const flag: bool'));
    // TypeScript's quick info said `(alias) const bias: f32` and `export bias`.
    expect(hoverAt(service, files, SOLO, 'bias }')).toBe(bare('const bias: f32'));
    expect(hoverAt(service, files, SOLO, 'bias :')).toBe(bare('const bias: f32'));
  });
});

describe('a function’s parameters are joined by their declaration', () => {
  // The front end keeps no parameter that takes a function, so the symbol's list is shorter
  // than the declaration's. A qualifier must stay on the parameter that writes it (Rule 8.25).
  const DECLS = `
export function apply(f: (x: f32) => f32, @inout v: f32, k: f32): void {
  v = f(v) * k;
}
export function both(g: (x: f32) => f32, @inout v: f32, h: (x: f32) => f32, @out w: f32): void {
  v = g(v);
  w = h(v);
}
`;
  const USES = `
function dbl(x: f32): f32 {
  return x * 2.;
}
@fragment
export function fs(): vec4 {
  let a = 1.;
  let b: f32;
  apply(dbl, a, 2.);
  both(dbl, a, dbl, b);
  return vec4(a, b, 0., 1.);
}
`;
  const files: Files = {
    [ONE]: `"use typeshade";${DECLS}${USES}`,
    [LIB]: `"use typeshade";${DECLS}`,
    [MAIN]: `"use typeshade";\nimport { apply, both } from "./lib.shade.ts";${USES}`,
  };
  it('a function-typed parameter before a qualified one does not move the qualifier', () => {
    const service = opened(files);
    for (const name of [ONE, MAIN]) {
      expect(errorsOf(files, name)).toEqual([]);
      const wgsl = compiled(files, name).wgsl!;
      // The pointers are the qualified parameters, in both halves.
      expect(wgsl).toMatch(/fn apply\w*\(v: ptr<function, f32>, k: f32\)/);
      expect(wgsl).toMatch(/fn both\w*\(v: ptr<function, f32>, w: ptr<function, f32>\)/);
      expect(hoverAt(service, files, name, 'apply(dbl', 0, 'fs()'), name).toBe(
        bare('function apply(@inout v: f32, k: f32): void'),
      );
      expect(hoverAt(service, files, name, 'both(dbl', 0, 'fs()'), name).toBe(
        bare('function both(@inout v: f32, @out w: f32): void'),
      );
    }
    // At the declaration, in the file that calls it.
    expect(hoverAt(service, files, ONE, 'apply(f')).toBe(
      bare('function apply(@inout v: f32, k: f32): void'),
    );
  });
});

describe('a struct reads by the name of its declaration, never by a part of a text', () => {
  it('two files declare one name, and the importing file gives one of them a name of its own', () => {
    const A = '/p/a.shade.ts';
    const B = '/p/b.shade.ts';
    const files: Files = {
      [A]: `"use typeshade";
export interface Params {
  gain: f32;
}
export function amp(p: Params): f32 {
  return p.gain;
}
`,
      [B]: `"use typeshade";
export interface Params {
  hue: f32;
}
export const DEF: Params = { hue: 0.5 };
export function tint(p: Params): f32 {
  return p.hue;
}
`,
      [MAIN]: `"use typeshade";
import { Params as P, amp } from "./a.shade.ts";
import { tint, DEF } from "./b.shade.ts";
@fragment
export function fs(): vec4 {
  const mine: P = { gain: 2. };
  return vec4(amp(mine), tint(DEF), DEF.hue, mine.gain);
}
`,
    };
    expect(errorsOf(files, MAIN)).toEqual([]);
    const wgsl = compiled(files, MAIN).wgsl!;
    expect(wgsl).toContain('struct b_Params {');
    expect(wgsl).toMatch(/fn tint\(p: (ptr<function, )?b_Params>?\) -> f32/);
    const service = opened(files);
    const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
    // The struct of `a.shade.ts` is `P` here. The struct of `b.shade.ts` has no name here, and
    // reads by its declared one. The alias of the first never reaches the second.
    expect(at('amp(mine')).toBe(bare('function amp(p: P): f32'));
    expect(at('mine.gain', 5)).toBe(bare('(property) P.gain: f32'));
    expect(at('tint(DEF')).toBe(bare('function tint(p: Params): f32'));
    expect(at('DEF)')).toBe(bare('const DEF: Params'));
    expect(at('DEF.hue', 4)).toBe(bare('(property) Params.hue: f32'));
  });

  it('two files of one stem: the second generated name has a number, and none shows', () => {
    const A = '/p/a/lib.shade.ts';
    const B = '/p/b/lib.shade.ts';
    const files: Files = {
      [A]: `"use typeshade";
export interface Light {
  p: f32;
}
export function fa(l: Light): f32 {
  return l.p;
}
`,
      [B]: `"use typeshade";
export interface Light {
  q: f32;
}
export function fb(l: Light): f32 {
  return l.q;
}
`,
      [MAIN]: `"use typeshade";
import { fa } from "./a/lib.shade.ts";
import { fb } from "./b/lib.shade.ts";
interface Light {
  c: f32;
}
@fragment
export function fs(): vec4 {
  const m: Light = { c: 1. };
  return vec4(fa({ p: 1. }), fb({ q: 2. }), m.c, 1.);
}
`,
    };
    expect(errorsOf(files, MAIN)).toEqual([]);
    const wgsl = compiled(files, MAIN).wgsl!;
    expect(wgsl).toContain('struct lib_Light {');
    expect(wgsl).toContain('struct lib_Light_2 {');
    const service = opened(files);
    const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
    expect(at('fa(')).toBe(bare('function fa(l: Light): f32'));
    expect(at('fb(')).toBe(bare('function fb(l: Light): f32'));
    expect(at('q: 2.')).toBe(bare('(property) Light.q: f32'));
    expect(at('m.c', 2)).toBe(bare('(property) Light.c: f32'));
  });

  it('an author’s own names that hold a generated name or an alias as a part are not changed', () => {
    const files: Files = {
      [LIB]: `"use typeshade";
export interface Light {
  power: f32;
}
export interface Light_Info {
  Light: Light;
  Light_count: i32;
}
export const K = 0.25;
export const HALF = 0.5;
export function mk_Light(Light: f32): Light {
  return { power: Light * K };
}
`,
      [MAIN]: `"use typeshade";
import { Light as L, Light_Info, mk_Light, HALF as Light } from "./lib.shade.ts";
interface Cfg {
  lib_Light_gain: f32;
  my_lib_K: f32;
}
const K = 2.;
function use_lib_Light_now(lib_K_x: f32, L_y: L): f32 {
  return lib_K_x * K + L_y.power;
}
@fragment
export function fs(): vec4 {
  const cfg: Cfg = { lib_Light_gain: 1., my_lib_K: 2. };
  const info: Light_Info = { Light: mk_Light(1.), Light_count: 1 };
  const lib_K_local = cfg.lib_Light_gain + cfg.my_lib_K;
  const L_local = use_lib_Light_now(lib_K_local, info.Light) * Light;
  return vec4(L_local, f32(info.Light_count), 0., 1.);
}
`,
    };
    expect(errorsOf(files, MAIN)).toEqual([]);
    // The module does emit the generated names that the author's own names hold as a part.
    const wgsl = compiled(files, MAIN).wgsl!;
    expect(wgsl).toContain('const lib_K: f32 = 0.25;');
    expect(wgsl).toContain('  lib_Light_gain: f32,');
    const service = opened(files);
    const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
    expect(at('cfg.lib_Light_gain', 4)).toBe(bare('(property) Cfg.lib_Light_gain: f32'));
    expect(at('cfg.my_lib_K', 4)).toBe(bare('(property) Cfg.my_lib_K: f32'));
    expect(at('lib_K_local =')).toBe(bare('const lib_K_local: f32'));
    expect(at('L_local =')).toBe(bare('const L_local: f32'));
    expect(at('use_lib_Light_now(')).toBe(
      bare('function use_lib_Light_now(lib_K_x: f32, L_y: L): f32'),
    );
    // The imported function keeps its name and its parameter's name. Only the struct in the
    // type position reads by this file's name for it.
    expect(at('mk_Light(')).toBe(bare('function mk_Light(Light: f32): L'));
    expect(at('info: Light_Info')).toBe(bare('const info: Light_Info'));
    expect(at('info.Light)', 5)).toBe(bare('(property) Light_Info.Light: L'));
    expect(at('info.Light_count', 5)).toBe(bare('(property) Light_Info.Light_count: i32'));
    // The constant this file calls `Light` is a constant, whatever a struct is called.
    expect(at('* Light;', 2)).toBe(bare('const Light: f32'));
  });

  it('a re-export under another name: the importing file’s name for the struct', () => {
    const MIDDLE = '/p/mid.shade.ts';
    const files: Files = {
      [LIB]: `"use typeshade";
export interface Light {
  dir: vec3;
}
export function lum(l: Light): f32 {
  return l.dir.x;
}
`,
      [MIDDLE]: `"use typeshade";
export { Light as Lamp, lum } from "./lib.shade.ts";
`,
      [MAIN]: `"use typeshade";
import { Lamp, lum } from "./mid.shade.ts";
@fragment
export function fs(): vec4 {
  const a: Lamp = { dir: vec3(1., 0., 0.) };
  return vec4(lum(a), a.dir.y, 0., 1.);
}
`,
    };
    expect(errorsOf(files, MAIN)).toEqual([]);
    expect(compiled(files, MAIN).wgsl).toContain('struct Light {');
    const service = opened(files);
    const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
    expect(at('lum(a')).toBe(bare('function lum(l: Lamp): f32'));
    expect(signaturesAt(service, files, MAIN, 'lum(')).toEqual(['lum(l: Lamp): f32']);
    expect(at('a: Lamp')).toBe(bare('const a: Lamp'));
    expect(at('a.dir', 2)).toBe(bare('(property) Lamp.dir: vec3<f32>'));
    expect(hoverAt(service, files, LIB, 'lum(l')).toBe(bare('function lum(l: Light): f32'));
  });

  it('one name for a struct applies wherever the struct stands; two names give the declared one', () => {
    const lib = `"use typeshade";
export interface Light {
  power: f32;
}
export interface L {
  other: f32;
}
export const DEF: Light = { power: 1. };
export function lum(l: Light): f32 {
  return l.power;
}
export function both(a: Light, b: L): f32 {
  return a.power + b.other;
}
`;
    const body = `
@fragment
export function fs(): vec4 {
  return vec4(lum(DEF), both(DEF, { other: 1. }), 0., 1.);
}
`;
    const ONCE = '/p/once.shade.ts';
    const TWICE = '/p/twice.shade.ts';
    const UNUSED = '/p/unused.shade.ts';
    const files: Files = {
      [LIB]: lib,
      [ONCE]: `"use typeshade";\nimport { Light as L, lum, both, DEF } from "./lib.shade.ts";${body}`,
      [TWICE]: `"use typeshade";\nimport { Light, Light as L, Light as M, lum, both, DEF } from "./lib.shade.ts";${body}`,
      // \`DEF\` and \`lum\` are imported and not used: the declaring document's program answers.
      [UNUSED]: `"use typeshade";\nimport { Light as L, lum, DEF } from "./lib.shade.ts";
@fragment
export function fs(): vec4 {
  const mine: L = { power: 1. };
  return vec4(mine.power, 0., 0., 1.);
}
`,
    };
    for (const name of [ONCE, TWICE, UNUSED]) expect(errorsOf(files, name), name).toEqual([]);
    expect(compiled(files, ONCE).wgsl).toMatch(/fn both\(a: (ptr<function, )?Light>?, b: /);
    const service = opened(files);
    const at = (name: string, needle: string) => hoverAt(service, files, name, needle, 0, 'fs()');
    // One name: the struct reads \`L\` in the type of an imported function's parameter and of an
    // imported constant too. The library's own struct \`L\`, which this file does not import,
    // reads by its declared name, so two structs read \`L\` here, as in TypeScript's quick info.
    expect(at(ONCE, 'lum(DEF')).toBe(bare('function lum(l: L): f32'));
    expect(at(ONCE, 'DEF)')).toBe(bare('const DEF: L'));
    expect(at(ONCE, 'both(')).toBe(bare('function both(a: L, b: L): f32'));
    // Three names: no one of them is the file's, and the struct reads by its declared name.
    expect(at(TWICE, 'lum(DEF')).toBe(bare('function lum(l: Light): f32'));
    expect(at(TWICE, 'DEF)')).toBe(bare('const DEF: Light'));
    expect(at(TWICE, 'both(')).toBe(bare('function both(a: Light, b: L): f32'));
    // An import the program does not keep reads the same names.
    const imports = (needle: string) => hoverAt(service, files, UNUSED, needle, 0, 'import {');
    expect(imports('DEF }')).toBe(bare('const DEF: L'));
    expect(imports('lum,')).toBe(bare('function lum(l: L): f32'));
    // The library names its structs as it declares them: another file's alias is not its own.
    expect(hoverAt(service, files, LIB, 'lum(l')).toBe(bare('function lum(l: Light): f32'));
    expect(hoverAt(service, files, LIB, 'DEF: Light')).toBe(bare('const DEF: Light'));
  });
});

describe('a declaration that holds symbols of more than one kind or struct', () => {
  it('a parameter property is a field where it is read as one, in one file and imported', () => {
    const DECLS = `
export class Ring {
  constructor(public center: vec2, public r: f32) {}
}
`;
    const USES = `
@fragment
export function fs(): vec4 {
  const ring = new Ring(vec2(1., 2.), 3.);
  return vec4(ring.center.x, ring.r, 0., 1.);
}
`;
    const files: Files = {
      [ONE]: `"use typeshade";${DECLS}${USES}`,
      [LIB]: `"use typeshade";${DECLS}`,
      [MAIN]: `"use typeshade";\nimport { Ring } from "./lib.shade.ts";${USES}`,
    };
    const service = opened(files);
    for (const name of [ONE, MAIN]) {
      expect(errorsOf(files, name)).toEqual([]);
      expect(compiled(files, name).wgsl).toContain('  center: vec2<f32>,');
      expect(hoverAt(service, files, name, 'ring.center', 5, 'fs()'), name).toBe(
        bare('(property) Ring.center: vec2<f32>'),
      );
      expect(hoverAt(service, files, name, 'ring.r,', 5, 'fs()'), name).toBe(
        bare('(property) Ring.r: f32'),
      );
    }
  });

  it('a field of a generic class whose type is no type parameter keeps the compiler’s type', () => {
    // Two instances hold \`n\`, each as an \`i32\`. No one struct owns the hovered field, so the
    // owner is TypeScript's, which names the instance, and the type is the compiler's.
    const DECLS = `
export class Box<T extends f32 | vec3> {
  v: T;
  n: vec2;
}
`;
    const USES = `
@fragment
export function fs(): vec4 {
  const bf = new Box<f32>();
  const bv = new Box<vec3>();
  return vec4(bf.v + bv.v.x, bf.n.x + bv.n.y, 0., 1.);
}
`;
    const files: Files = {
      [ONE]: `"use typeshade";${DECLS}${USES}`,
      [LIB]: `"use typeshade";${DECLS}`,
      [MAIN]: `"use typeshade";\nimport { Box } from "./lib.shade.ts";${USES}`,
    };
    const service = opened(files);
    for (const name of [ONE, MAIN]) {
      expect(errorsOf(files, name)).toEqual([]);
      const wgsl = compiled(files, name).wgsl!;
      expect(wgsl).toContain('struct Box_f32 {');
      expect(wgsl).toContain('struct Box_vec3 {');
      expect(wgsl).toContain('  n: vec2<f32>,');
      expect(hoverAt(service, files, name, 'bf.n', 3, 'fs()'), name).toBe(
        bare('(property) Box<f32>.n: vec2<f32>'),
      );
      // TypeScript names the owner of this use in its own way, and never as the other
      // instance. The type is the compiler's.
      const second = hoverAt(service, files, name, 'bv.n', 3, 'fs()');
      expect(second, name).toMatch(/^```ts\n\(property\) Box<.*>\.n: vec2<f32>\n```$/);
      expect(second, name).not.toContain('f32>.n');
      // The field whose type is the parameter differs by instance, and keeps TypeScript's text.
      expect(hoverAt(service, files, name, 'bv.v', 3, 'fs()'), name).toBe(
        bare('(property) Box<vec3>.v: vec3'),
      );
    }
  });

  it('a field of a mixin, which two classes hold, keeps the compiler’s type in one file', () => {
    const MIXIN = 'examples/mixin-surface.shade.ts';
    const files: Files = { [MIXIN]: readFileSync(MIXIN, 'utf8') };
    expect(errorsOf(files, MIXIN)).toEqual([]);
    // Each applying class has the field in its own struct.
    expect(compiled(files, MIXIN).wgsl!.match(/^ {2}tint: vec3<f32>,$/gm)).toHaveLength(2);
    const service = opened(files);
    expect(hoverAt(service, files, MIXIN, 'this.tint', 5)).toBe(
      bare('(property) (Anonymous class).tint: vec3<f32>'),
    );
  });

  it('an instance of a generic class that the module emits under a generated name', () => {
    const files: Files = {
      [LIB]: `"use typeshade";
export class Box<T extends f32 | vec3> {
  v: T;
}
export function open(b: Box<f32>): f32 {
  return b.v;
}
`,
      [MAIN]: `"use typeshade";
import { Box as Crate, open } from "./lib.shade.ts";
const Box = 2.;
@fragment
export function fs(): vec4 {
  const c = new Crate<f32>();
  return vec4(open(c), c.v, Box, 1.);
}
`,
    };
    expect(errorsOf(files, MAIN)).toEqual([]);
    expect(compiled(files, MAIN).wgsl).toContain('struct lib_Box_f32 {');
    const service = opened(files);
    const at = (needle: string, skip = 0) => hoverAt(service, files, MAIN, needle, skip, 'fs()');
    // The declared identifier is replaced as the whole part before the instance's suffix.
    expect(at('c.v', 2)).toBe(bare('(property) Crate_f32.v: f32'));
    expect(at('open(c')).toBe(bare('function open(b: Crate_f32): f32'));
    expect(at('Box, 1.')).toBe(bare('const Box: f32'));
    expect(hoverAt(service, files, LIB, 'open(b')).toBe(bare('function open(b: Box_f32): f32'));
  });

  it('two instances of a generic function that differ in a parameter only', () => {
    const files: Files = {
      [ONE]: `"use typeshade";
function weight<T extends f32 | vec3>(x: T, k: f32): f32 {
  return k;
}
@fragment
export function fs(): vec4 {
  return vec4(weight(1., 2.), weight(vec3(1.), 3.), 0., 1.);
}
`,
    };
    expect(errorsOf(files, ONE)).toEqual([]);
    const wgsl = compiled(files, ONE).wgsl!;
    expect(wgsl).toContain('fn weight_f32(');
    expect(wgsl).toContain('fn weight_vec3(');
    const service = opened(files);
    // The two instances return one type and differ in the type of \`x\`.
    expect(hoverAt(service, files, ONE, 'weight(vec3', 0, 'fs()')).toBe(
      bare('function weight<vec3>(x: vec3, k: f32): f32'),
    );
  });
});

describe('what a hover reads of other documents', () => {
  const lib = `"use typeshade";
export interface Light {
  power: f32;
}
export const K = 0.5;
export let frame: u32 = 0;
declare const scene: uniform<Light>;
export { scene };
export namespace Tone {
  export const GAMMA = 2.2;
}
export function g(x: f32): f32 {
  return x + f32(frame) + scene.power + Tone.GAMMA;
}
`;
  const UNUSED = '/p/unused.shade.ts';
  const OTHER = '/p/other.shade.ts';
  const files: Files = {
    [LIB]: lib,
    [UNUSED]: `"use typeshade";
import { K, frame, scene, Tone, g } from "./lib.shade.ts";
@fragment
export function fs(): vec4 {
  return vec4(g(1.), 0., 0., 1.);
}
`,
    [OTHER]: `"use typeshade";
import { g } from "./lib.shade.ts";
@fragment
export function fs(): vec4 {
  return vec4(g(2.), 0., 0., 1.);
}
`,
  };

  it('an import the program does not keep: each kind as the declaring document has it', () => {
    expect(errorsOf(files, UNUSED)).toEqual([]);
    expect(compiled(files, UNUSED).wgsl).not.toContain('const K');
    const service = opened(files);
    const imports = (needle: string) => hoverAt(service, files, UNUSED, needle, 0, 'import {');
    expect(imports('K,')).toBe(bare('const K: f32'));
    // A module variable is \`let\`, as in the declaring file.
    expect(imports('frame,')).toBe(bare('let frame: u32'));
    expect(hoverAt(service, files, LIB, 'frame: u32')).toBe(bare('let frame: u32'));
    // \`frame\` and \`scene\` are in this program, since \`g\` reads them: the binding has the slot
    // it has here.
    expect(imports('scene,')).toBe(
      lines('const scene: Light', 'uniform resource at @group(0) @binding(0)'),
    );
    // A namespace keeps TypeScript's quick info, as its members do.
    expect(imports('Tone,')).toBe(bare('(alias) namespace Tone\nimport Tone'));
  });

  it('a binding the program does not keep has no resource line', () => {
    const NOBIND = '/p/nobind.shade.ts';
    const more: Files = {
      ...files,
      [NOBIND]: `"use typeshade";
import { scene, frame, K } from "./lib.shade.ts";
@fragment
export function fs(): vec4 {
  return vec4(K, 0., 0., 1.);
}
`,
    };
    expect(errorsOf(more, NOBIND)).toEqual([]);
    expect(compiled(more, NOBIND).wgsl).not.toContain('scene');
    const service = opened(more);
    expect(hoverAt(service, more, NOBIND, 'scene,', 0, 'import {')).toBe(
      bare('const scene: Light'),
    );
    // A module variable the program does not keep is `let`, as in the declaring file.
    expect(compiled(more, NOBIND).wgsl).not.toContain('frame');
    expect(hoverAt(service, more, NOBIND, 'frame,', 0, 'import {')).toBe(bare('let frame: u32'));
    expect(hoverAt(service, more, LIB, 'frame: u32')).toBe(bare('let frame: u32'));
    // In the declaring file the binding has its slot.
    expect(hoverAt(service, more, LIB, 'scene: uniform')).toBe(
      lines('const scene: Light', 'uniform resource at @group(0) @binding(0)'),
    );
  });

  it('an import the program does not keep analyses the declaring document alone', () => {
    let runs: string[] = [];
    const analyze = (sf: ts.SourceFile, imports?: Parameters<typeof analyzeSourceFile>[1]) => {
      runs.push(sf.fileName);
      return analyzeSourceFile(sf, imports);
    };
    const service = opened(files, createTypeshadeLanguageServiceWith({}, analyze));
    runs = [];
    expect(hoverAt(service, files, UNUSED, 'K,', 0, 'import {')).toBe(bare('const K: f32'));
    // The hovered document and the declaring document. \`other.shade.ts\` links the declaring
    // file too, and is not analysed.
    expect(runs).toEqual([UNUSED, LIB]);
  });

  it('a field read in the importing programs needs them to agree', () => {
    // \`Slot\` is generic and unused in its own file. One importing program makes it of \`f32\`
    // and the other of \`vec3\`, so the declaring file has no one type to show.
    const A = '/p/a.shade.ts';
    const B = '/p/b.shade.ts';
    const slot: Files = {
      [LIB]: `"use typeshade";
export class Slot<T extends f32 | vec3> {
  v: T;
  n: vec2;
}
`,
      [A]: `"use typeshade";
import { Slot } from "./lib.shade.ts";
@fragment
export function fs(): vec4 {
  const s = new Slot<f32>();
  return vec4(s.v, s.n.x, 0., 1.);
}
`,
      [B]: `"use typeshade";
import { Slot } from "./lib.shade.ts";
@fragment
export function fs(): vec4 {
  const s = new Slot<vec3>();
  return vec4(s.v.x, s.n.x, 0., 1.);
}
`,
    };
    expect(errorsOf(slot, A)).toEqual([]);
    expect(errorsOf(slot, B)).toEqual([]);
    expect(compiled(slot, A).wgsl).toContain('struct Slot_f32 {');
    expect(compiled(slot, B).wgsl).toContain('struct Slot_vec3 {');
    const service = opened(slot);
    expect(hoverAt(service, slot, LIB, 'v: T')).toBe(
      bare('(property) Slot<T extends f32 | vec3>.v: T extends f32 | vec3'),
    );
    // The field both programs type alike keeps the compiler's type, under TypeScript's owner.
    expect(hoverAt(service, slot, LIB, 'n: vec2')).toBe(
      bare('(property) Slot<T extends f32 | vec3>.n: vec2<f32>'),
    );
    // With one importing program, its instance is the one type.
    service.closeDocument(B);
    expect(hoverAt(service, slot, LIB, 'v: T')).toBe(bare('(property) Slot_f32.v: f32'));
  });
});

describe('the third review: stale names, another program’s instance, overloads', () => {
  it('an edit of the declaring file renames nothing in an importing file that did not change', () => {
    // The importing file's names for the library's declarations are offsets in the library,
    // so they are read again when the library changes, though the importing file did not.
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
    // The library's own program holds `twice_f32` and `Box_f32` alone. The importing program
    // holds both instances of each, so no one of them is the type of every use there.
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
    // The front end joins a namespace and a class with `_`, in one file too.
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

  it('an overloaded function reads its implementation, with its qualifiers, in one file and imported', () => {
    const DECLS = `
export function bump(v: f32, k: f32): void;
export function bump(@inout v: f32, k: f32): void {
  v = v * k;
}
`;
    const USES = `
@fragment
export function fs(): vec4 {
  let a = 1.;
  bump(a, 2.);
  return vec4(a, 0., 0., 1.);
}
`;
    const files: Files = {
      [ONE]: `"use typeshade";${DECLS}${USES}`,
      [LIB]: `"use typeshade";${DECLS}`,
      [MAIN]: `"use typeshade";\nimport { bump as bp } from "./lib.shade.ts";${USES.replace('bump(a', 'bp(a')}`,
    };
    for (const name of [ONE, MAIN]) {
      expect(errorsOf(files, name)).toEqual([]);
      expect(compiled(files, name).wgsl).toContain('fn bump(v: ptr<function, f32>, k: f32) {');
    }
    const service = opened(files);
    expect(hoverAt(service, files, ONE, 'bump(a', 0, 'fs()')).toBe(
      bare('function bump(@inout v: f32, k: f32): void'),
    );
    expect(hoverAt(service, files, MAIN, 'bp(a', 0, 'fs()')).toBe(
      bare('function bp(@inout v: f32, k: f32): void'),
    );
  });

  it('a shorthand property reads the local it stands for, as before this change', () => {
    // TypeScript resolves `{ pos, uv }` to the locals, and the table holds no field there.
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
