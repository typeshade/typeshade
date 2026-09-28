// Verifies: Rule 3.9 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 3.2 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.9 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.13 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 9.5 (docs/language-design.md; traced in reqs/).
//
// A shader file imports what another exports (change 0022, surface §68), and the program they
// make is read twice: by `compile()`, which links it into one module, and by the language
// service, whose TypeScript half resolves the import as TypeScript does and whose TypeShade half
// runs the same linker. Each program here is asserted on both halves, on the same files: both
// accept it, or both refuse it with the same TS8072 sentence on the same import (Rule 12.7,
// Rule 12.4). Before 0022 every public path compiled one file, and each accepted program below
// was TS8004 on the call into the other file in `compile()` and in the editor alike. A file may
// import a package's shader module by the package's name too (change 0024), found in
// `node_modules` through the `package.json` files the same `readDocument` reads.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSources } from './module.js';
import { TS_CODES } from './codes.js';
import { validate } from '../../core/passes/validate.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

/** A program: file path to text, the entry first. */
type Files = Readonly<Record<string, string>>;

const D = '"use typeshade";\n';
const entryOf = (files: Files): string => Object.keys(files)[0]!;

/** `compile()` of the entry, reading the rest of the program from `files`. */
const compiled = (files: Files) => {
  const entry = entryOf(files);
  return compile(files[entry]!, { fileName: entry, readDocument: (f) => files[f] });
};

/** The editor's merged list for the entry, the other files read through the host. */
const edited = (files: Files, uri = entryOf(files)) => {
  const service = createTypeshadeLanguageService({ readDocument: (u) => files[u] });
  service.openDocument(uri, files[uri]!);
  return service.getDiagnostics(uri);
};

const errorsOf = (files: Files): string[] =>
  compiled(files)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.fileName}:${d.line}:${d.character} ${d.code} ${d.message}`);

const NOISE = `${D}
function hash32(x: u32): u32 {
  const a = (x ^ (x >> 16)) * 0x85ebca77;
  const b = (a ^ (a >> 13)) * 0xc2b2ae3d;
  return b ^ (b >> 16);
}

function hash(p: vec2): f32 {
  const h = hash32(u32(i32(p.x)) ^ hash32(u32(i32(p.y))));
  return f32(h >> 8) * 5.9604644775390625e-8;
}

export function noise(p: vec2): f32 {
  const i = floor(p);
  const f = fract(p);
  const u: vec2 = f * f * (vec2(3.) - f * 2.);
  return mix(
    mix(hash(i), hash(i + vec2(1., 0.)), u.x),
    mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x),
    u.y,
  );
}

export function fbm(p: vec2): f32 {
  return noise(p) * 0.5 + noise(p * 2.02) * 0.25 + noise(p * 4.08) * 0.125;
}
`;

/** A `package.json`, as `readDocument` returns it. */
const manifest = (fields: object): string => JSON.stringify(fields);

/** `shade-noise` at `root`, publishing `src/*.shade.ts` under the `typeshade` condition beside
 *  the JavaScript it publishes for hosts, as surface §68's example writes it. */
const SHADE_NOISE = (root: string, version = '1.2.0'): Files => ({
  [`${root}package.json`]: manifest({
    name: 'shade-noise',
    version,
    exports: {
      '.': { typeshade: './src/index.shade.ts', default: './dist/index.js' },
      './*': { typeshade: './src/*.shade.ts' },
    },
  }),
  [`${root}src/index.shade.ts`]: `${D}export { fbm } from "./noise.shade.ts";\n`,
  [`${root}src/noise.shade.ts`]: NOISE,
  [`${root}src/scale.shade.ts`]: `${D}export function scale(x: f32): f32 {\n  return x * 3.;\n}\n`,
  [`${root}dist/index.js`]: 'export function fbm() {\n  return 0;\n}\n',
});

/** Programs both halves accept, each with what `eval` of the entry's `f` answers, when it has
 *  one. Each is a row the second table of the proposal measured refused before 0022, or a
 *  package import 0024 measured refused. */
const ACCEPTED: readonly (readonly [string, Files, (readonly unknown[])?, unknown?])[] = [
  [
    'a function, called from an entry point',
    {
      '/p/clouds.shade.ts': `${D}import { fbm } from "./noise.shade.ts";

class Uniforms {
  time: f32;
}

declare const U: uniform<Uniforms>;

class VsOut {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}

@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const x = f32(vi & 1) * 4. - 1.;
  const y = f32(vi >> 1) * 4. - 1.;
  return { pos: vec4(x, y, 0., 1.), uv: vec2(x * 0.5 + 0.5, y * 0.5 + 0.5) };
}

@fragment
export function fs(vo: VsOut): vec4 {
  const f = fbm(vo.uv * 6. + vec2(U.time * 0.1, 0.));
  return vec4(vec3(f), 1.);
}
`,
      '/p/noise.shade.ts': NOISE,
    },
  ],
  [
    'a class, named as a parameter type and as a local type',
    {
      '/p/main.shade.ts': `${D}import { Light, make } from "./light.shade.ts";
export function f(x: f32, l: Light): f32 {
  const m: Light = make(x);
  return m.power + l.power;
}
`,
      '/p/light.shade.ts': `${D}export class Light {
  dir: vec3;
  power: f32;
}
export function make(x: f32): Light {
  return { dir: vec3(0., 0., 1.), power: x };
}
`,
    },
    [2, { dir: [0, 0, 1], power: 3 }],
    5,
  ],
  [
    "an enum, a constant, the library's own constant and a constant read at module scope",
    {
      '/p/main.shade.ts': `${D}import { Mode, PI, scale } from "./lib.shade.ts";
const TAU: f32 = 2. * PI;
export function f(x: f32, m: i32): f32 {
  if (m === Mode.B) {
    return scale(x) + TAU;
  }
  return x;
}
`,
      '/p/lib.shade.ts': `${D}const K: f32 = 2.;
export const PI: f32 = 3.;
export enum Mode {
  A = 0,
  B = 1,
}
export function scale(x: f32): f32 {
  return x * K;
}
`,
    },
    [5, 1],
    16,
  ],
  [
    'a generic function, under another name, through the `.js` specifier',
    {
      '/p/main.shade.ts': `${D}import { twice as tw } from "./lib.shade.js";
export function f(x: f32): f32 {
  return tw(x) + tw(vec2(x, 1.)).y;
}
`,
      '/p/lib.shade.ts': `${D}export function twice<T extends f32 | vec2>(x: T): T {
  return x + x;
}
`,
    },
    [3],
    8,
  ],
  [
    'a re-export by name and every export of a file',
    {
      '/p/main.shade.ts': `${D}import { g, h } from "./index.shade.ts";
export function f(x: f32): f32 {
  return g(x) + h(x);
}
`,
      '/p/index.shade.ts': `${D}export { g } from "./g.shade.ts";
export * from "./h.shade.ts";
`,
      '/p/g.shade.ts': `${D}export function g(x: f32): f32 {
  return x + 10.;
}
`,
      '/p/h.shade.ts': `${D}export function h(x: f32): f32 {
  return x * 100.;
}
`,
    },
    [1],
    111,
  ],
  [
    'a module namespace, read as a value and as a type',
    {
      '/p/main.shade.ts': `${D}import * as geo from "./geo.shade.ts";
export function f(p: vec2): f32 {
  const q: geo.Pt = { v: p };
  return geo.len(q);
}
`,
      '/p/geo.shade.ts': `${D}export class Pt {
  v: vec2;
}
export function len(p: Pt): f32 {
  return length(p.v);
}
`,
    },
    [[3, 4]],
    5,
  ],
  [
    'two files that import each other, with no call cycle',
    {
      '/p/a.shade.ts': `${D}import { b } from "./b.shade.ts";
export function f(x: f32): f32 {
  return b(x) + 1.;
}
export function a(x: f32): f32 {
  return x * 2.;
}
`,
      '/p/b.shade.ts': `${D}import { a } from "./a.shade.ts";
export function b(x: f32): f32 {
  return a(x) + 3.;
}
`,
    },
    [1],
    6,
  ],
  [
    "a binding and a module variable of the library's, read through its functions",
    {
      '/p/main.shade.ts': `${D}import { bump, Camera, camera } from "./lib.shade.ts";
@fragment
export function fs(): vec4 {
  const c: Camera = camera;
  return vec4(bump() + c.exposure);
}
`,
      '/p/lib.shade.ts': `${D}export class Camera {
  exposure: f32;
}
export declare const camera: uniform<Camera>;
let count: f32 = 0.;
export function bump(): f32 {
  count += 1.;
  return count;
}
`,
    },
  ],
  [
    'a function from a package, by its name, through the "typeshade" condition, two directories up',
    {
      '/p/src/scenes/main.shade.ts': `${D}import { fbm } from "shade-noise";
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  return vec4(vec3(fbm(uv * 6.)), 1.);
}
`,
      ...SHADE_NOISE('/p/node_modules/shade-noise/'),
    },
  ],
  [
    'a subpath of a package, by a * pattern of its "exports"',
    {
      '/p/main.shade.ts': `${D}import { scale } from "shade-noise/scale";
export function f(x: f32): f32 {
  return scale(x);
}
`,
      ...SHADE_NOISE('/p/node_modules/shade-noise/'),
    },
    [2],
    6,
  ],
  [
    'a scoped package with no "exports", by the path of its file',
    {
      '/p/main.shade.ts': `${D}import { scale } from "@shade/lib/scale.shade.js";
export function f(x: f32): f32 {
  return scale(x) + 1.;
}
`,
      '/p/node_modules/@shade/lib/package.json': manifest({ name: '@shade/lib', version: '0.1.0' }),
      '/p/node_modules/@shade/lib/scale.shade.ts': `${D}export function scale(x: f32): f32 {\n  return x * 4.;\n}\n`,
    },
    [2],
    9,
  ],
  [
    'a package that imports a package installed inside it',
    {
      '/p/main.shade.ts': `${D}import { warp } from "shade-warp";
export function f(x: f32): f32 {
  return warp(x);
}
`,
      '/p/node_modules/shade-warp/package.json': manifest({
        name: 'shade-warp',
        version: '0.3.0',
        exports: { '.': { typeshade: './src/warp.shade.ts' } },
      }),
      '/p/node_modules/shade-warp/src/warp.shade.ts': `${D}import { scale } from "shade-noise/scale";
export function warp(x: f32): f32 {
  return scale(x) + 0.5;
}
`,
      ...SHADE_NOISE('/p/node_modules/shade-warp/node_modules/shade-noise/'),
    },
    [2],
    6.5,
  ],
];

describe('a program the two halves both accept (Rule 3.9)', () => {
  for (const [name, files, args, answer] of ACCEPTED) {
    it(name, () => {
      expect(errorsOf(files)).toEqual([]);
      expect(edited(files).map((d) => `${d.source} ${d.code} ${d.message}`)).toEqual([]);
      const r = compiled(files);
      expect(r.wgsl).toBeDefined();
      if (args !== undefined) expect(r.eval('f', args)).toEqual(answer);
    });
  }
});

/** Programs both halves refuse, with the one TS8072 each reports on the entry. */
const REFUSED: readonly (readonly [string, Files, string])[] = [
  [
    'a path that names no file',
    {
      '/p/main.shade.ts': `${D}import { g } from "./nosie.shade.ts";\nexport function f(x: f32): f32 { return g(x); }\n`,
    },
    '2:19 Cannot find the shader module "./nosie.shade.ts" (looked for "/p/nosie.shade.ts").',
  ],
  [
    'a file that does not begin with the directive',
    {
      '/p/main.shade.ts': `${D}import { g } from "./util.ts";\nexport function f(x: f32): f32 { return g(x); }\n`,
      '/p/util.ts': 'export function g(x: number): number { return x; }\n',
    },
    '2:19 "./util.ts" is not a shader module: it does not begin with "use typeshade". A shader module imports only another shader module.',
  ],
  [
    'a package no node_modules holds',
    {
      '/p/main.shade.ts': `${D}import { fbm } from "shade-noise";\nexport function f(x: f32): f32 { return fbm(x); }\n`,
    },
    '2:21 Cannot find the package "shade-noise" (looked in node_modules from "/p" up).',
  ],
  [
    'a scoped package path no node_modules holds, found by its name',
    {
      '/p/src/main.shade.ts': `${D}import { fbm } from "@shade/noise/lib/noise.shade.js";\nexport function f(x: f32): f32 { return fbm(x); }\n`,
    },
    '2:21 Cannot find the package "@shade/noise" (looked in node_modules from "/p/src" up).',
  ],
  [
    'a subpath the package\'s "exports" does not name',
    {
      '/p/main.shade.ts': `${D}import { fbm } from "shade-noise/warp/domain";\nexport function f(x: f32): f32 { return fbm(x); }\n`,
      '/p/node_modules/shade-noise/package.json': manifest({
        name: 'shade-noise',
        exports: { '.': { typeshade: './src/index.shade.ts' } },
      }),
    },
    '2:21 "shade-noise" does not export "./warp/domain": its package.json "exports" names no module for it.',
  ],
  [
    'a subpath the package\'s "exports" maps to null',
    {
      '/p/main.shade.ts': `${D}import { fbm } from "shade-noise/internal/seed";\nexport function f(x: f32): f32 { return fbm(x); }\n`,
      '/p/node_modules/shade-noise/package.json': manifest({
        name: 'shade-noise',
        exports: { './*': { typeshade: './src/*.shade.ts' }, './internal/*': null },
      }),
      '/p/node_modules/shade-noise/src/internal/seed.shade.ts': NOISE,
    },
    '2:21 "shade-noise" does not export "./internal/seed": its package.json "exports" names no module for it.',
  ],
  [
    'the name alone of a package with no "exports", suggested from its main field',
    {
      '/p/main.shade.ts': `${D}import { fbm } from "shade-noise";\nexport function f(x: f32): f32 { return fbm(x); }\n`,
      '/p/node_modules/shade-noise/package.json': manifest({
        name: 'shade-noise',
        main: './noise.shade.js',
      }),
      '/p/node_modules/shade-noise/noise.shade.ts': NOISE,
    },
    '2:21 "shade-noise" has no module to import by its name alone: its package.json has no "exports". Import one of its files, such as "shade-noise/noise.shade.ts".',
  ],
  [
    'the name alone of a package with no "exports" and no shader module to suggest',
    {
      '/p/main.shade.ts': `${D}import { fbm } from "shade-noise";\nexport function f(x: f32): f32 { return fbm(x); }\n`,
      '/p/node_modules/shade-noise/package.json': manifest({
        name: 'shade-noise',
        main: 'dist/index.js',
      }),
    },
    '2:21 "shade-noise" has no module to import by its name alone: its package.json has no "exports". Import one of its files by its path in the package, "shade-noise/<path>".',
  ],
  [
    'a package whose "exports" names JavaScript and no shader module',
    {
      '/p/main.shade.ts': `${D}import { fbm } from "shade-noise";\nexport function f(x: f32): f32 { return fbm(x); }\n`,
      '/p/node_modules/shade-noise/package.json': manifest({
        name: 'shade-noise',
        exports: { '.': { import: './dist/index.js', require: './dist/index.cjs' } },
      }),
      '/p/node_modules/shade-noise/dist/index.js': 'export function fbm() {\n  return 0;\n}\n',
    },
    '2:21 "shade-noise" resolves to "node_modules/shade-noise/dist/index.js", which does not begin with "use typeshade". A package publishes its shader modules under the "typeshade" condition of "exports".',
  ],
  [
    'a package whose "exports" names a file it does not hold',
    {
      '/p/main.shade.ts': `${D}import { fbm } from "shade-noise";\nexport function f(x: f32): f32 { return fbm(x); }\n`,
      '/p/node_modules/shade-noise/package.json': manifest({
        name: 'shade-noise',
        exports: { typeshade: './src/index.shade.ts' },
      }),
    },
    '2:21 Cannot find the shader module "shade-noise" (looked for "node_modules/shade-noise/src/index.shade.ts").',
  ],
  [
    'a specifier of a package import map',
    {
      '/p/main.shade.ts': `${D}import { fbm } from "#noise";\nexport function f(x: f32): f32 { return fbm(x); }\n`,
    },
    '2:21 "#noise" names a package\'s own import map, which a shader module does not read. Import the file by a relative path.',
  ],
  [
    'an absolute path, suggested as a relative one',
    {
      '/p/main.shade.ts': `${D}import { fbm } from "/p/lib/noise.shade.ts";\nexport function f(x: f32): f32 { return fbm(x); }\n`,
      '/p/lib/noise.shade.ts': NOISE,
    },
    '2:21 "/p/lib/noise.shade.ts" is not a relative path or a package name. A shader module imports a file of its program by a relative path, such as "./noise.shade.ts", or a package by its name.',
  ],
  [
    'a name the file declares and does not export',
    {
      '/p/main.shade.ts': `${D}import { hash } from "./noise.shade.ts";\nexport function f(p: vec2): f32 { return hash(p); }\n`,
      '/p/noise.shade.ts': NOISE,
    },
    '2:10 "./noise.shade.ts" declares "hash" and does not export it. Export it there, or declare what you need in this file.',
  ],
  [
    'a name the file does not declare',
    {
      '/p/main.shade.ts': `${D}import { fmb } from "./noise.shade.ts";\nexport function f(p: vec2): f32 { return fmb(p); }\n`,
      '/p/noise.shade.ts': NOISE,
    },
    '2:10 "./noise.shade.ts" has no export "fmb". Did you mean "fbm"?',
  ],
  [
    'a default import',
    {
      '/p/main.shade.ts': `${D}import noise from "./noise.shade.ts";\nexport function f(p: vec2): f32 { return noise(p); }\n`,
      '/p/noise.shade.ts': NOISE,
    },
    '2:8 A shader module has no default export. Import the names you use: import { name } from "./noise.shade.ts".',
  ],
  [
    'an import that names nothing',
    {
      '/p/main.shade.ts': `${D}import "./noise.shade.ts";\nexport function f(x: f32): f32 { return x; }\n`,
      '/p/noise.shade.ts': NOISE,
    },
    '2:1 This import names nothing, and importing a shader module does nothing else. Import the names you use: import { name } from "./noise.shade.ts".',
  ],
  [
    'import(...) in a function body',
    {
      '/p/main.shade.ts': `${D}export function f(x: f32): f32 {\n  const m = import("./noise.shade.ts");\n  return x;\n}\n`,
      '/p/noise.shade.ts': NOISE,
    },
    '3:20 A shader module is imported by an import declaration at the top of the file: import { name } from "./noise.shade.ts".',
  ],
  [
    'require(...) in a function body',
    {
      '/p/main.shade.ts': `${D}export function f(x: f32): f32 {\n  const m = require("./noise.shade.ts");\n  return x;\n}\n`,
      '/p/noise.shade.ts': NOISE,
    },
    '3:13 A shader module is imported by an import declaration at the top of the file: import { name } from "./noise.shade.ts".',
  ],
  [
    'a module namespace read as a value',
    {
      '/p/main.shade.ts': `${D}import * as noise from "./noise.shade.ts";\nexport function f(p: vec2): f32 { const n = noise; return 1.; }\n`,
      '/p/noise.shade.ts': NOISE,
    },
    '3:45 "noise" is a module namespace, read one name at a time (noise.name). It is not a value.',
  ],
];

describe('an import the two halves both refuse, with one TS8072 (Rule 3.9, Rule 12.4)', () => {
  for (const [name, files, sentence] of REFUSED) {
    it(name, () => {
      const r = compiled(files);
      const refusals = r.diagnostics.map((d) => `${d.code} ${d.line}:${d.character} ${d.message}`);
      expect(refusals).toEqual([`${TS_CODES.IMPORT} ${sentence}`]);
      // The editor reports the same sentence on the same span, and TypeScript's report of the
      // same mistake (TS2307, TS2305, TS2724, TS2459, TS1192) is merged away.
      const editor = edited(files).map(
        (d) => `${d.code} ${d.range.start.line + 1}:${d.range.start.character + 1} ${d.message}`,
      );
      expect(editor).toEqual([`${TS_CODES.IMPORT} ${sentence}`]);
    });
  }

  it('an import in a compile that reads nothing, on the import alone', () => {
    const r = compile(
      `${D}import { g } from "./lib.shade.ts";\nexport function f(x: f32): f32 { return g(x); }\n`,
    );
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      `${TS_CODES.IMPORT} "./lib.shade.ts" was not read: this compile has no readDocument. Pass compile() a readDocument that returns the file's text.`,
    ]);
  });

  it('a package in a compile that reads nothing, on the import alone', () => {
    const r = compile(
      `${D}import { fbm } from "shade-noise";\nexport function f(x: f32): f32 { return fbm(x); }\n`,
    );
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      `${TS_CODES.IMPORT} "shade-noise" was not read: this compile has no readDocument. Pass compile() a readDocument that returns the file's text.`,
    ]);
  });
});

describe('a package, as the editor reads it (Rule 12.7)', () => {
  const files: Files = {
    '/p/main.shade.ts': `${D}import { scale } from "shade-noise/scale";
export function f(x: f32): f32 {
  return scale(x);
}
`,
    ...SHADE_NOISE('/p/node_modules/shade-noise/'),
  };

  it('shows a function from a package with the type its file declares', () => {
    const service = createTypeshadeLanguageService({ readDocument: (u) => files[u] });
    const text = files['/p/main.shade.ts']!;
    service.openDocument('/p/main.shade.ts', text);
    const at = text.indexOf('scale(x)');
    const position = service.positionAt('/p/main.shade.ts', at + 1);
    // TypeScript's hover of an imported name: `(alias) scale(x: f32): f32`.
    expect(service.getHover('/p/main.shade.ts', position)?.contents).toContain(
      'scale(x: f32): f32',
    );
    expect(compiled(files).eval('f', [2])).toBe(6);
  });

  it("asks readDocument for each package.json from the file's directory up, as compile() does", () => {
    const program: Record<string, string> = {
      ...files,
      '/p/src/main.shade.ts': files['/p/main.shade.ts']!,
    };
    delete program['/p/main.shade.ts'];
    const byCompile: string[] = [];
    compile(program['/p/src/main.shade.ts']!, {
      fileName: '/p/src/main.shade.ts',
      readDocument: (f) => (byCompile.push(f), program[f]),
    });
    const byEditor: string[] = [];
    const service = createTypeshadeLanguageService({
      readDocument: (u) => (byEditor.push(u), program[u]),
    });
    service.openDocument('/p/src/main.shade.ts', program['/p/src/main.shade.ts']!);
    expect(service.getDiagnostics('/p/src/main.shade.ts')).toEqual([]);
    const manifests = (names: string[]) => [
      ...new Set(names.filter((n) => n.endsWith('package.json'))),
    ];
    expect(manifests(byCompile)).toEqual([
      '/p/src/node_modules/shade-noise/package.json',
      '/p/node_modules/shade-noise/package.json',
    ]);
    expect(manifests(byEditor)).toEqual(manifests(byCompile));
  });

  it('sees a package installed while the document is open at its next edit', () => {
    let installed = false;
    const service = createTypeshadeLanguageService({
      readDocument: (u) => (installed || !u.includes('node_modules') ? files[u] : undefined),
    });
    const text = files['/p/main.shade.ts']!;
    service.openDocument('/p/main.shade.ts', text);
    expect(service.getDiagnostics('/p/main.shade.ts').map((d) => `${d.code} ${d.message}`)).toEqual(
      [
        `${TS_CODES.IMPORT} Cannot find the package "shade-noise" (looked in node_modules from "/p" up).`,
      ],
    );
    installed = true;
    service.updateDocument('/p/main.shade.ts', `${text}\n`);
    expect(service.getDiagnostics('/p/main.shade.ts')).toEqual([]);
  });
});

describe('one copy of one package version (surface §68)', () => {
  /** `shade-noise` at `root` and `version`: a binding, and a private helper `fbm` calls. */
  const noiseAt = (root: string, version: string, factor: string): Files => ({
    [`${root}package.json`]: manifest({
      name: 'shade-noise',
      version,
      exports: { typeshade: './src/noise.shade.ts' },
    }),
    [`${root}src/noise.shade.ts`]: `${D}export class NoiseParams {
  octaves: f32;
}
export declare const params: uniform<NoiseParams>;
function hash(x: f32): f32 {
  return x * ${factor};
}
export function fbm(x: f32): f32 {
  return hash(x);
}
export function octaves(): f32 {
  return params.octaves;
}
`,
  });
  /** An entry that calls `shade-noise` itself and through `shade-warp`, whose own
   *  `shade-noise` is installed inside it at `version`. */
  const program = (entry: string, version: string, factor: string): Files => ({
    '/p/main.shade.ts': entry,
    '/p/node_modules/shade-warp/package.json': manifest({
      name: 'shade-warp',
      version: '0.3.0',
      exports: { typeshade: './warp.shade.ts' },
    }),
    '/p/node_modules/shade-warp/warp.shade.ts': `${D}import { fbm, octaves } from "shade-noise";
export function warp(x: f32): f32 {
  return fbm(x) * 10.;
}
export function warpOctaves(): f32 {
  return octaves();
}
`,
    ...noiseAt('/p/node_modules/shade-noise/', '1.2.0', '2.'),
    ...noiseAt('/p/node_modules/shade-warp/node_modules/shade-noise/', version, factor),
  });
  const imports = `${D}import { fbm, octaves } from "shade-noise";
import { warp, warpOctaves } from "shade-warp";
`;
  const calls = `export function f(x: f32): f32 {
  return fbm(x) + warp(x);
}
`;

  it('reads one version reached by two paths once: one binding, one of each function', () => {
    const files = program(
      `${imports}${calls}@fragment
export function fs(): vec4 {
  return vec4(octaves() + warpOctaves());
}
`,
      '1.2.0',
      '2.',
    );
    expect(errorsOf(files)).toEqual([]);
    expect(edited(files).map((d) => `${d.source} ${d.code} ${d.message}`)).toEqual([]);
    const r = compiled(files);
    expect(r.wgsl!.match(/\bfn fbm\(/g)).toHaveLength(1);
    expect(r.wgsl!.match(/\bfn hash\(/g)).toHaveLength(1);
    expect(r.wgsl!.match(/var<uniform> params\b/g)).toHaveLength(1);
    expect(r.wgsl).not.toContain('shade_noise');
    expect(r.eval('f', [1])).toBe(2 + 20);
  });

  it('reads two versions as two copies, the second named for its package and file (Rule 3.2)', () => {
    const files = program(`${imports}${calls}`, '2.0.0', '3.');
    expect(errorsOf(files)).toEqual([]);
    expect(edited(files).map((d) => `${d.source} ${d.code} ${d.message}`)).toEqual([]);
    const r = compiled(files);
    expect(r.wgsl).toContain('fn fbm(x: f32) -> f32');
    expect(r.wgsl).toContain('fn shade_noise_noise_fbm(x: f32) -> f32');
    expect(r.wgsl).toContain('fn shade_noise_noise_hash(x: f32) -> f32');
    expect(r.eval('f', [1])).toBe(2 + 30);
  });

  it('numbers the second version of a declaration both versions rename (Rule 3.2)', () => {
    const files = program(
      `${imports}function hash(x: f32): f32 {
  return x;
}
export function f(x: f32): f32 {
  return fbm(x) + warp(x) + hash(x);
}
`,
      '2.0.0',
      '3.',
    );
    expect(errorsOf(files)).toEqual([]);
    expect(edited(files).map((d) => `${d.source} ${d.code} ${d.message}`)).toEqual([]);
    const r = compiled(files);
    expect(r.wgsl).toContain('fn hash(x: f32) -> f32');
    expect(r.wgsl).toContain('fn shade_noise_noise_hash(x: f32) -> f32');
    expect(r.wgsl).toContain('fn shade_noise_noise_hash_2(x: f32) -> f32');
    expect(r.eval('f', [1])).toBe(2 + 30 + 1);
  });
});

describe('the names one module emits (Rule 3.2)', () => {
  const TWO = {
    '/p/main.shade.ts': `${D}import { a } from "./a.shade.ts";
import { b } from "./b.shade.ts";
export function f(x: f32): f32 {
  return a(x) + b(x);
}
`,
    '/p/a.shade.ts': `${D}function hash(x: f32): f32 {\n  return x + 1.;\n}\nexport function a(x: f32): f32 {\n  return hash(x);\n}\n`,
    '/p/b.shade.ts': `${D}function hash(x: f32): f32 {\n  return x * 3.;\n}\nexport function b(x: f32): f32 {\n  return hash(x);\n}\n`,
  };

  it("gives each file's private helper of one name its own function", () => {
    // Measured before 0022 on the internal multi-file path: no diagnostic, and WGSL with two
    // `fn hash`, which `validate()` refuses (SD0020, dup-func).
    const r = compiled(TWO);
    expect(errorsOf(TWO)).toEqual([]);
    expect(() => validate(r.module)).not.toThrow();
    expect(r.wgsl).toContain('fn hash(x: f32) -> f32');
    expect(r.wgsl).toContain('fn b_hash(x: f32) -> f32');
    expect(r.eval('f', [2])).toBe(3 + 6);
  });

  it('keeps the name of a builtin another file calls for the builtin', () => {
    const files = {
      '/p/main.shade.ts': `${D}import { g } from "./lib.shade.ts";\nexport function f(x: f32): f32 {\n  return mix(0., 10., x) + g(x);\n}\n`,
      '/p/lib.shade.ts': `${D}function mix(a: f32, b: f32, t: f32): f32 {\n  return 1000.;\n}\nexport function g(x: f32): f32 {\n  return mix(0., 1., x);\n}\n`,
    };
    expect(errorsOf(files)).toEqual([]);
    expect(compiled(files).eval('f', [0.5])).toBe(5 + 1000);
  });

  it('names a renamed declaration in a sentence as its own file writes it', () => {
    // `g` of the second file is emitted `b_g`; the author wrote `g`, and the sentence is theirs.
    const files = {
      '/p/main.shade.ts': `${D}import { f1 } from "./b.shade.ts";\nfunction g(): f32 {\n  return 1.;\n}\nexport function f(x: f32): f32 {\n  return g() + f1(x);\n}\n`,
      '/p/b.shade.ts': `${D}function g(): f32 {\n  return 2.;\n}\nconst Q: f32 = g();\nexport function f1(x: f32): f32 {\n  return x + Q;\n}\n`,
    };
    const sentence = `${TS_CODES.TYPE_MISMATCH} Module const "Q" must be constant, and "g()" calls a function this file declares. A module constant is folded before any function exists, so build the value inside the function that reads it.`;
    expect(errorsOf(files)).toEqual([`/p/b.shade.ts:5:7 ${sentence}`]);
    expect(edited(files, '/p/b.shade.ts').map((d) => `${d.code} ${d.message}`)).toEqual([sentence]);
  });

  it('refuses two bindings of one name in one module, naming both files', () => {
    const files = {
      '/p/main.shade.ts': `${D}import { g } from "./lib.shade.ts";\nclass T {\n  v: f32;\n}\ndeclare const t: uniform<T>;\nexport function f(): f32 {\n  return t.v + g();\n}\n`,
      '/p/lib.shade.ts': `${D}class T {\n  v: f32;\n}\ndeclare const t: uniform<T>;\nexport function g(): f32 {\n  return t.v;\n}\n`,
    };
    expect(errorsOf(files)).toEqual([
      `/p/lib.shade.ts:5:15 ${TS_CODES.DUPLICATE_SYMBOL} Binding "t" is declared in both "/p/main.shade.ts" and "/p/lib.shade.ts". A program is one module, and the host knows a binding by its name; rename one.`,
    ]);
  });
});

describe('the names the host knows are never renamed (Rule 3.2)', () => {
  it('refuses two overrides of one name in one module, naming both files', () => {
    const files = {
      '/p/main.shade.ts': `${D}import { g } from "./lib.shade.ts";\nconst gain: override<f32> = 1.;\nexport function f(): f32 {\n  return gain + g();\n}\n`,
      '/p/lib.shade.ts': `${D}const gain: override<f32> = 2.;\nexport function g(): f32 {\n  return gain;\n}\n`,
    };
    expect(errorsOf(files)).toEqual([
      `/p/lib.shade.ts:2:7 ${TS_CODES.DUPLICATE_SYMBOL} Override "gain" is declared in both "/p/main.shade.ts" and "/p/lib.shade.ts". A program is one module, and the host knows an override by its name; rename one.`,
    ]);
  });

  it('refuses two entry points of one name in one module, naming both files', () => {
    // Only a program handed in as a list keeps another file's entry points (`compileTsSources`);
    // an import leaves them out (Rule 3.9).
    const r = compileTsSources([
      {
        fileName: 'a.ts',
        source: `${D}@fragment\nexport function fs(): vec4 {\n  return vec4(1.);\n}\n`,
      },
      {
        fileName: 'b.ts',
        source: `${D}@fragment\nexport function fs(): vec4 {\n  return vec4(0.);\n}\n`,
      },
    ]);
    expect(
      r.diagnostics.map((d) => `${d.fileName}:${d.line}:${d.character} ${d.code} ${d.message}`),
    ).toEqual([
      `b.ts:3:17 ${TS_CODES.DUPLICATE_SYMBOL} Entry point "fs" is declared in both "a.ts" and "b.ts". A program is one module, and the host knows an entry point by its name; rename one.`,
    ]);
  });
});

describe('per program, not per file (Rules 8.9, 8.13, 9.5)', () => {
  it('compiles a generic function once per set of type arguments the program uses (Rule 8.9)', () => {
    const files = {
      '/p/main.shade.ts': `${D}import { g, twice } from "./lib.shade.ts";\nexport function f(x: f32): f32 {\n  return twice(x) + g(x);\n}\n`,
      '/p/lib.shade.ts': `${D}export function twice<T extends f32 | vec2>(x: T): T {\n  return x + x;\n}\nexport function g(x: f32): f32 {\n  return twice(x) + twice(vec2(x, 0.)).x;\n}\n`,
    };
    expect(errorsOf(files)).toEqual([]);
    expect(edited(files)).toEqual([]);
    const r = compiled(files);
    // `twice` at `f32`, which both files call, is one function, and at `vec2` the other.
    expect(r.module.funcs.filter((fn) => fn.name.startsWith('twice'))).toHaveLength(2);
    expect(r.eval('f', [1])).toBe(2 + 2 + 2);
  });

  it('makes a static field another file writes a module variable (Rule 8.13)', () => {
    const files = {
      '/p/main.shade.ts': `${D}import { Counter, read } from "./lib.shade.ts";\nexport function f(x: f32): f32 {\n  Counter.n = x;\n  return read() + Counter.K;\n}\n`,
      '/p/lib.shade.ts': `${D}export class Counter {\n  static n: f32 = 1.;\n  static K: f32 = 10.;\n}\nexport function read(): f32 {\n  return Counter.n;\n}\n`,
    };
    expect(errorsOf(files)).toEqual([]);
    expect(edited(files)).toEqual([]);
    const r = compiled(files);
    // What the entry writes is a variable of the module; what nothing writes stays a constant.
    expect(r.module.vars?.map((v) => v.name)).toEqual(['Counter_n']);
    expect(r.module.consts.map((c) => c.name)).toContain('Counter_K');
    expect(r.eval('f', [7])).toBe(7 + 10);
  });

  it('lets a function the file imports win over a builtin of its name (Rule 9.5)', () => {
    const files = {
      '/p/main.shade.ts': `${D}import { saturate } from "./lib.shade.ts";\nexport function f(x: f32): f32 {\n  return saturate(x);\n}\n`,
      '/p/lib.shade.ts': `${D}export function saturate(x: f32): f32 {\n  return x * 10.;\n}\n`,
    };
    expect(errorsOf(files)).toEqual([]);
    expect(edited(files)).toEqual([]);
    expect(compiled(files).eval('f', [2])).toBe(20);
  });
});

describe('what the module holds (Rule 3.9)', () => {
  it("leaves out an imported file's own entry point, and the bindings only it reads", () => {
    const files = {
      '/p/main.shade.ts': `${D}import { fbm } from "./lib.shade.ts";\nexport function f(x: f32): f32 {\n  return fbm(x);\n}\n`,
      '/p/lib.shade.ts': `${D}class U {\n  t: f32;\n}\ndeclare const u: uniform<U>;\nexport function fbm(x: f32): f32 {\n  return x * 2.;\n}\n@fragment\nexport function demo(): vec4 {\n  return vec4(fbm(u.t));\n}\n`,
    };
    const r = compiled(files);
    expect(r.module.funcs.map((f) => f.name)).toEqual(['fbm', 'f']);
    expect(r.module.bindings).toEqual([]);
  });

  it("numbers the entry's own bindings first, so an import moves none of them", () => {
    const files = {
      '/p/main.shade.ts': `${D}import { tap } from "./lib.shade.ts";\ndeclare const lut: texture_2d<f32>;\ndeclare const smp2: sampler;\n@fragment\nexport function fs(@location(0) uv: vec2): vec4 {\n  return tap(uv) + textureSample(lut, smp2, uv);\n}\n`,
      '/p/lib.shade.ts': `${D}declare const atlas: texture_2d<f32>;\ndeclare const smp: sampler;\nexport function tap(uv: vec2): vec4 {\n  return textureSample(atlas, smp, uv);\n}\n`,
    };
    expect(compiled(files).module.bindings.map((b) => `${b.name}@${b.binding}`)).toEqual([
      'lut@0',
      'smp2@1',
      'atlas@2',
      'smp@3',
    ]);
  });
});

describe('a mistake belongs to the file it is in (Rule 3.9)', () => {
  const files = {
    '/p/main.shade.ts': `${D}import { g } from "./lib.shade.ts";\nexport function f(x: f32): f32 {\n  return g(x);\n}\n`,
    '/p/lib.shade.ts': `${D}\nexport function g(x: f32): f32 {\n  return zork(x);\n}\n`,
  };

  it('is reported by compile() with the file, line and column it is at', () => {
    expect(errorsOf(files)).toEqual([
      `/p/lib.shade.ts:4:10 ${TS_CODES.UNKNOWN_FN} Unknown function "zork". Declare it in this file, or import it from another shader module.`,
    ]);
  });

  it('is shown by the editor on that file, and not on the file that imports it', () => {
    expect(edited(files)).toEqual([]);
    expect(edited(files, '/p/lib.shade.ts').map((d) => `${d.code} ${d.message}`)).toEqual([
      `${TS_CODES.UNKNOWN_FN} Unknown function "zork". Declare it in this file, or import it from another shader module.`,
    ]);
  });

  it('carries its own file in the spans the IR holds', () => {
    const ok = {
      '/p/main.shade.ts': `${D}import { g } from "./lib.shade.ts";\nexport function f(x: f32): f32 {\n  return g(x);\n}\n`,
      '/p/lib.shade.ts': `${D}\nexport function g(x: f32): f32 {\n  return x;\n}\n`,
    };
    const spans = compiled(ok).module.funcs.map((f) => `${f.name} ${f.span?.file}:${f.span?.line}`);
    expect(spans).toEqual(['g /p/lib.shade.ts:2', 'f /p/main.shade.ts:2']);
  });
});
