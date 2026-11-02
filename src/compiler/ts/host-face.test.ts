// Verifies: Rule 8.20 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.7 (docs/language-design.md; traced in reqs/).
//
// The host face of a shader module (change 0009): which exports a host file can call, the host
// view `tsc` reads for the import, and the generated module a bundler reads for it. A host call
// is read by two readers, as a shader is: `tsc` reads the view, and the program runs the module.
// So each part is checked on both: the view is type-checked in a real host program resolved the
// way the documented `tsconfig` resolves it (`moduleSuffixes`), and the module is imported and
// called.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace, type HostExport } from './host-face.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** The face of `source` as `name.shade.ts`, which must compile. */
function face(source: string, name = 'm') {
  const f = hostFace(source, { fileName: `/app/${name}.shade.ts`, runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

/** Write the generated module to disk and import it, as the bundler would. */
async function load(source: string): Promise<Record<string, unknown>> {
  const f = face(source);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-host-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, f.code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

/** Type-check `host` against the view of `source`, resolved through `moduleSuffixes` as the
 *  documented `tsconfig` resolves it, under a strict host `tsconfig` with the DOM lib. */
async function hostErrors(source: string, host: string): Promise<string[]> {
  const f = face(source, 'terrain');
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-view-'));
  dirs.push(dir);
  // The source beside its view, so the check proves the view wins over it.
  writeFileSync(join(dir, 'terrain.shade.ts'), source);
  writeFileSync(join(dir, 'terrain.shade.typeshade.ts'), f.view);
  writeFileSync(join(dir, 'app.ts'), host);
  const diagnostics = await tscDiagnostics([join(dir, 'app.ts')], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    moduleSuffixes: ['.typeshade', ''],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
  });
  return diagnostics.map(
    (d) => `${d.fileName ? d.fileName.slice(dir.length + 1) : ''} TS${d.code}`,
  );
}

const kinds = (exports: readonly HostExport[]) =>
  Object.fromEntries(exports.map((e) => [e.name, e.kind === 'never' ? e.reason : e.kind]));

const TERRAIN = `"use typeshade";

export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
`;

describe('which exports a host can call (Rule 8.20)', () => {
  it('calls a plain helper, and says why each other export is not callable', () => {
    const f = face(`"use typeshade";
declare const frame: uniform<vec4>;
declare const albedo: texture_2d<f32>;
declare const samp: sampler;
let tile: workgroup<array<u32, 64>>;

export function helper(x: f32): f32 { return x * 2.; }
export function ident<T>(x: T): T { return x; }
export function apply(f: (x: f32) => f32, x: f32): f32 { return f(x); }
export function readsBinding(x: f32): f32 { return x * frame.x; }
function inner(x: f32): f32 { return x + frame.y; }
export function reachesBinding(x: f32): f32 { return inner(x); }
export function derivative(x: f32): f32 { return dpdx(x); }
export function sampled(uv: vec2): vec4 { return textureSample(albedo, samp, uv); }
export function fromTile(i: u32): u32 { return tile[i]; }
export function usesIdent(x: f32): f32 { return ident(x) + apply(helper, x); }
export function bump(v: inout<f32>): void { v += 1.; }
export function usesBump(x: f32): f32 { let y = x; bump(y); return y; }

export const fs = fragment(function fs(uv: location<0, vec2>): vec4 { return vec4(helper(uv.x), 0., 0., 1.); });
`);
    const k = kinds(f.exports);
    expect(k.helper).toBe('function');
    expect(k.usesIdent).toBe('function');
    expect(k.ident).toMatch(/^it is generic/);
    expect(k.apply).toMatch(/^it takes a function/);
    // Verifies: Rule 8.25. A host call passes values, and a reference names a shader's place.
    expect(k.bump).toMatch(/^parameter "v" is @inout or @out/);
    expect(k.usesBump).toBe('function');
    expect(k.readsBinding).toMatch(/^it reaches a resource binding/);
    expect(k.reachesBinding).toMatch(/^it reaches a resource binding/);
    expect(k.derivative).toMatch(/^it reaches dpdx, which only a GPU computes/);
    expect(k.sampled).toMatch(/resource binding|only a GPU computes/);
    expect(k.fromTile).toMatch(/^it reaches a workgroup variable/);
    expect(k.fs).toMatch(/^parameter "uv" is what a vertex entry writes/);
    // Each refusal names the work that adds it, or says none does yet.
    for (const e of f.exports)
      if (e.kind === 'never')
        expect(e.reason).toMatch(/roadmap item 1[56] adds it|no proposal|Rule 8\.24|#204/);
  });

  it('refuses a parameter or a result with no host value, naming the type', () => {
    const f = face(`"use typeshade";
export function tex(t: texture_2d<f32>, uv: vec2i): vec4 { return textureLoad(t, uv, 0); }
`);
    expect(kinds(f.exports).tex).toMatch(/^parameter "t": a texture_2d<f32> has no host value/);
  });

  it('carries a constant, an enum and a class as values, and an interface as a type', () => {
    const f = face(`"use typeshade";
export const K: f32 = 2.;
export enum Mode { A, B = 4 }
export class P { x: f32 = 0.; v: vec2 = vec2(0., 0.); }
export interface I { x: f32; }
export function mk(a: f32): P { const p = new P(); p.x = a; return p; }
export function ix(i: I): f32 { return i.x; }
`);
    // `exports` reports a class as the struct it is (change 0109): the view and the module carry
    // the class, a value besides.
    expect(kinds(f.exports)).toEqual({
      K: 'const',
      Mode: 'enum',
      P: 'struct',
      I: 'struct',
      mk: 'function',
      ix: 'function',
    });
    expect(f.view).toContain('export declare class P {');
    expect(f.view).toContain('export interface I { x: number }');
    expect(f.code).toContain('__ts_x');
    expect(f.code).toMatch(/__ts_x\d+ as P\b/);
    expect(f.code).not.toMatch(/__ts_x\d+ as I\b/);
  });

  it('carries a re-export of a shader file, and a struct another file declares (Rule 3.9)', async () => {
    const files: Readonly<Record<string, string>> = {
      '/app/m.shade.ts': `"use typeshade";
export { scale } from "./lib.shade.ts";
import { P, make } from "./lib.shade.ts";
export function mk(a: f32): P {
  return make(a);
}
`,
      '/app/lib.shade.ts': `"use typeshade";
export class P {
  x: f32;
  v: vec2;
}
export function make(a: f32): P {
  return { x: a, v: vec2(a, a) };
}
export function scale(x: f32): f32 {
  return x * 3.;
}
`,
    };
    const f = hostFace(files['/app/m.shade.ts']!, {
      fileName: '/app/m.shade.ts',
      runtime: RUNTIME,
      readDocument: (name) => files[name],
    });
    expect(f.diagnostics).toEqual([]);
    expect(kinds(f.exports ?? [])).toEqual({ scale: 'function', mk: 'function' });
    expect(f.view).toContain('export declare function scale(x: number): number;');
    // `P` is not an export of this module, so the view spells its layout where the signature
    // names it.
    expect(f.view).toContain(
      'export declare function mk(a: number): { x: number; v: [number, number] };',
    );
    // The files the face was read from, which the plugin watches.
    expect(f.files).toEqual(['/app/m.shade.ts', '/app/lib.shade.ts']);
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-host-'));
    dirs.push(dir);
    const file = join(dir, 'm.shade.mjs');
    writeFileSync(file, f.code ?? '');
    const m = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
      scale(x: number): number;
      mk(a: number): unknown;
    };
    expect(m.scale(2)).toBe(6);
    expect(m.mk(2)).toEqual({ x: 2, v: [2, 2] });
  });

  it('a module with an error has no face, only its diagnostics', () => {
    const f = hostFace(`"use typeshade";\nexport function f(x: f32): f32 { return y; }\n`, {
      fileName: '/app/bad.shade.ts',
    });
    expect(
      f.diagnostics.some((d) => d.category === 'error' && /^TS80\d\d$/.test(d.code ?? '')),
    ).toBe(true);
    expect(f.view).toBeUndefined();
    expect(f.code).toBeUndefined();
  });
});

describe('the host view (Rule 8.21)', () => {
  it('types the default export with the bindings each entry reaches (change 0030)', () => {
    const f = face(`"use typeshade";
class View { viewProj!: mat4x4; time!: f32; }
interface VsOut { pos: builtin<"position", vec4>; uv: location<0, vec2>; }
declare const view: uniform<View>;
declare const cells: storage<array<vec2>>;
declare const albedo: texture_2d<f32>;
declare const samp: sampler;
export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): VsOut {
  return { pos: view.viewProj * vec4(cells[i], 0., 1.), uv: cells[i] };
});
export const fs = fragment(function fs(v: VsOut): vec4 { return textureSample(albedo, samp, v.uv); });
`);
    const gpu = '{ readonly mapAsync: unknown; readonly getMappedRange: unknown }';
    const numbers = 'Float32Array | Int32Array | Uint32Array | Float64Array';
    const viewT = `{ readonly viewProj: readonly number[] | ${numbers}; readonly time: number }`;
    expect(f.view).toContain(
      `declare const program: Pack<{ readonly vs: { readonly view: ${viewT} | Resident<${viewT}> | ${gpu}; readonly cells: Float32Array | Resident<Float32Array> | ${gpu} }; readonly fs: { readonly albedo: object; readonly samp: object } }>;`,
    );
    expect(f.view).toContain('import type { Resident }');
  });

  it('declares every row of the host value table', () => {
    const f = face(`"use typeshade";
export class S { a: f32 = 0.; v: vec2 = vec2(0., 0.); }
export interface J { a: f32; v: vec2; }
export function jx(j: J): J { return j; }
export function scalars(a: f32, b: i32, c: u32, d: bool): f32 { return a; }
export function vectors(a: vec3, b: vec2i, c: vec4u, d: vec2b): vec2b { return d; }
export function matrix(m: mat2x3): mat2x3 { return m; }
export function list(xs: array<f32, 3>): array<vec2, 2> { return array(vec2(xs[0], 0.), vec2(0., 0.)); }
export function record(s: S): S { return s; }
export function nothing(x: f32) { let y = x; }
`);
    expect(f.view).toContain(
      'export declare function scalars(a: number, b: number, c: number, d: boolean): number;',
    );
    expect(f.view).toContain(
      'export declare function vectors(a: readonly [number, number, number], b: readonly [number, number], c: readonly [number, number, number, number], d: readonly [boolean, boolean]): [boolean, boolean];',
    );
    expect(f.view).toContain('export declare function matrix(m: readonly number[]): number[];');
    expect(f.view).toContain(
      'export declare function list(xs: readonly number[]): [number, number][];',
    );
    // A class is a value and an interface a type (change 0109): the row of a struct splits.
    expect(f.view).toContain(
      'export declare class S {\n  constructor();\n  a: number;\n  v: [number, number];\n}',
    );
    expect(f.view).toContain('export interface J { a: number; v: [number, number] }');
    expect(f.view).toContain(
      'export declare function record(s: { readonly a: number; readonly v: readonly [number, number] }): S;',
    );
    expect(f.view).toContain('export declare function nothing(x: number): void;');
  });

  it('declares an export with no host face never, with the reason', () => {
    const f = face(`"use typeshade";
export const fs = fragment(function fs(uv: location<0, vec2>): vec4 { return vec4(uv, 0., 1.); });
`);
    expect(f.view).toContain(
      '/** Not callable from host code (Rule 8.20): parameter "uv" is what a vertex entry writes, and a draw has no vertex entry but its full-screen triangle; #204, the rendering design, adds a mesh. */\nexport declare const fs: never;',
    );
  });

  it('type-checks a host program with plain tsc, the view winning over the source', async () => {
    expect(
      await hostErrors(
        TERRAIN,
        `import { height } from './terrain.shade.ts';\nconst h: number = height([0.5, 0.5], [1, 0.5, 2, 0.25]);\nexport { h };\n`,
      ),
    ).toEqual([]);
  });

  it('catches a wrong host call at the host line', async () => {
    expect(
      await hostErrors(
        TERRAIN,
        `import { height } from './terrain.shade.ts';\nexport const h = height([0.5], [1, 0.5, 2, 0.25]);\n`,
      ),
    ).toEqual(['app.ts TS2345']);
  });

  it('makes a call of an export with no host face a type error', async () => {
    const src = `"use typeshade";
export const fs = fragment(function fs(uv: location<0, vec2>): vec4 { return vec4(uv, 0., 1.); });
`;
    expect(
      await hostErrors(src, `import { fs } from './terrain.shade.ts';\nexport const c = fs();\n`),
    ).toEqual(['app.ts TS2349']);
  });

  it('the source itself is what a host program without the view would read (the 29 errors)', () => {
    // The instrument, proved: without moduleSuffixes the import reads the shader source, which a
    // host program cannot type-check (change 0009, "Why" 1). The view is what makes the zero.
    const dir = mkdtempSync(join(tmpdir(), 'typeshade-view-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'terrain.shade.ts'), TERRAIN);
    writeFileSync(
      join(dir, 'app.ts'),
      `import { height } from './terrain.shade.ts';\nexport const h = height([0.5, 0.5], [1, 0.5, 2, 0.25]);\n`,
    );
    const program = ts.createProgram([join(dir, 'app.ts')], {
      strict: true,
      noEmit: true,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      allowImportingTsExtensions: true,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      types: [],
    });
    expect(ts.getPreEmitDiagnostics(program).length).toBeGreaterThan(0);
  });
});

/** The lines of the comment that ends on the line above the first line of `view` that begins
 *  with `declaration`. */
function commentAbove(view: string, declaration: string): string[] {
  const lines = view.split('\n');
  const at = lines.findIndex((l) => l.startsWith(declaration));
  expect(at, `the view declares ${declaration}`).toBeGreaterThan(-1);
  let from = at;
  while (from > 0 && /^(\/\*\*| \*)/.test(lines[from - 1]!)) from--;
  return lines.slice(from, at);
}

/** What the editor shows on hover over the text `at` of `host`, a program that imports `./m.shade.ts`
 *  and so reads `view`, `moduleSuffixes` resolving the import to it: the documentation, and any error
 *  the view or the program has. The view's own `runtime` is the stub, so the program stays small. */
function hover(
  view: string,
  host: string,
  at: string,
): { documentation: string; errors: string[] } {
  const files = new Map([
    ['/app/m.shade.typeshade.ts', view],
    ['/app/runtime.ts', 'export type Resident<T> = T;\nexport type Pack<T> = T;\n'],
    ['/app/app.ts', host],
  ]);
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    moduleSuffixes: ['.typeshade', ''],
    lib: ['lib.es2022.d.ts'],
    types: [],
  };
  const service = ts.createLanguageService({
    getScriptFileNames: () => ['/app/app.ts'],
    getScriptVersion: () => '1',
    getScriptSnapshot: (name) => {
      const text = files.get(name) ?? ts.sys.readFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => '/app',
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (name) => files.has(name) || ts.sys.fileExists(name),
    readFile: (name) => files.get(name) ?? ts.sys.readFile(name),
    directoryExists: (name) => name === '/app' || ts.sys.directoryExists(name),
  });
  const errors = ['/app/app.ts', '/app/m.shade.typeshade.ts'].flatMap((name) => [
    ...service.getSyntacticDiagnostics(name),
    ...service.getSemanticDiagnostics(name),
  ]);
  const position = host.indexOf(at);
  expect(position, `the host program has ${at}`).toBeGreaterThan(-1);
  const info = service.getQuickInfoAtPosition('/app/app.ts', position);
  service.dispose();
  return {
    documentation: ts.displayPartsToString(info?.documentation ?? []),
    errors: errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')),
  };
}

// The view carries the author's JSDoc (change 0108, surface §64). A view is text that two readers
// take: `tsc` and the editor. So each row of the proposal is checked on the text of the view, and the
// editor's hover is checked on the rows a developer hovers: what the author wrote shows first, and
// the compiler's sentence follows it.
describe("the host view carries the author's JSDoc (change 0108)", () => {
  // The sentences the view writes itself (the "Not callable" reason aside), as they stand.
  const KERNEL =
    'A kernel function (Rule 8.22). Each of its loops runs on the GPU, one invocation per iteration, where there is WebGPU, and on the CPU otherwise. Each array it writes is read back into yours in place, or stays on the device in a Resident (Rules 8.21 and 11.8).';
  const compute = (shape: string): string =>
    `A \`@compute\` entry, \`@workgroup_size(${shape})\`: \`workgroups\` counts workgroups, dispatched as written, or is \`{ indirect, offset? }\`, the three counts at element \`offset\` of a Resident a call wrote (change 0075); each binding the entry writes is read back into your value in place, or stays on the device in a Resident. The shape shown is its default; options.constants selects declared overrides without changing workgroups (Rules 8.24 and 11.8).`;
  const FRAGMENT =
    'A full-screen `@fragment` entry: draws one frame into `target`, filling its width by height, on WebGPU, then WebGL2, then the CPU. The first draw into a canvas decides its tier. The promise resolves when the frame is submitted; nothing is read back (Rule 8.24).';
  const GENERIC =
    'Not callable from host code (Rule 8.20): it is generic, and a generic function exists only as the instances the module uses; no proposal adds it yet.';
  // Item 3: how a call made without `await` is queued and awaited.
  const queued = (written: 'arrays' | 'bindings'): string =>
    `A call whose written ${written} are all Residents and that returns nothing may be made without await: it is queued and runs in order, and read() of a Resident it writes waits for it and throws its error (Rule 11.8); the signature returning void is that call.`;

  it('writes the JSDoc of a helper above it, verbatim, and no other comment', () => {
    const f = face(`"use typeshade";

// A line comment is not JSDoc.
/* Neither is a block comment. */
/**
 * The height of the terrain at \`p\`.
 *
 * @param p the point
 * @param k the four wave constants
 */
export function height(p: vec2, k: vec4): f32 {
  /** Inside a body, a comment belongs to nothing. */
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
`);
    expect(commentAbove(f.view, 'export declare function height(')).toEqual([
      '/**',
      ' * The height of the terrain at `p`.',
      ' *',
      ' * @param p the point',
      ' * @param k the four wave constants',
      ' */',
    ]);
    expect(f.view).not.toMatch(/line comment|block comment|Inside a body/);
  });

  it('writes the JSDoc of a constant above it', () => {
    const f = face(`"use typeshade";

/** The step of the finite difference. */
export const EPS: f32 = 0.001;
`);
    expect(f.view).toContain(
      '/** The step of the finite difference. */\nexport declare const EPS: number;\n',
    );
  });

  it('writes the JSDoc of an enum above it, and that of a member on the member', () => {
    const f = face(`"use typeshade";

/** How the terrain is shaded. */
export enum Shading {
  /** Flat colours. */
  Flat,
  Smooth = 4,
  /**
   * Smooth, with the normals of the wave.
   */
  Waves,
}
`);
    expect(f.view).toContain(`/** How the terrain is shaded. */
export declare const Shading: {
  /** Flat colours. */
  readonly Flat: 0;
  readonly Smooth: 4;
  /**
   * Smooth, with the normals of the wave.
   */
  readonly Waves: 5;
  readonly [value: number]: string;
};
export type Shading = 0 | 4 | 5;
`);
  });

  it('writes the JSDoc of a class, an interface and a type above it, and that of a field on its line', () => {
    const f = face(`"use typeshade";

/** A particle. */
export class Particle {
  /**
   * Where it is, in world units.
   */
  pos: vec2 = vec2(0., 0.);
  /** How fast it moves. */
  vel: vec2 = vec2(0., 0.);
  mass: f32 = 1.;
}

/** What a probe read. */
export interface Probe {
    /**
     * The reading, indented four spaces in the source.
     */
    value: f32;
    id: u32;
}

export type Pair = {
  /** The left one. */
  left: f32;
  right: f32;
};

// An interface and a type alias are structs where the module uses them.
export function use(p: Probe, q: Pair): f32 {
  return p.value + q.left + q.right;
}
`);
    // A class is declared as a class (change 0109), and its fields carry their comments.
    expect(f.view).toContain(`/** A particle. */
export declare class Particle {
  constructor();
  /**
   * Where it is, in world units.
   */
  pos: [number, number];
  /** How fast it moves. */
  vel: [number, number];
  mass: number;
}
`);
    // An interface and a type alias stay `export interface`, where the module uses them as structs.
    // The continuation lines of a block take the indentation of the view, not that of the source.
    expect(f.view).toContain(`/** What a probe read. */
export interface Probe {
  /**
   * The reading, indented four spaces in the source.
   */
  value: number;
  id: number;
}
`);
    expect(f.view).toContain(`export interface Pair {
  /** The left one. */
  left: number;
  right: number;
}
`);
  });

  it('gives a struct the comments of the fields it inherits, as TypeScript’s hover does', () => {
    const files: Readonly<Record<string, string>> = {
      '/app/m.shade.ts': `"use typeshade";
import { Base } from "./lib.shade.ts";

/** A shape. */
export class Shape {
  /** The x position. */
  x: f32 = 0.;
  y: f32 = 0.;
}

/** A circle. */
export class Circle extends Shape {
  /** The radius. */
  r: f32 = 1.;
}

class Hidden {
  /** The hidden field. */
  h: f32 = 0.;
}

export class Shown extends Hidden {
  s: f32 = 0.;
}

export interface Named {
  /** The id. */
  id: u32;
}

export interface Tagged extends Named {
  /** The tag. */
  tag: u32;
}

export function tagOf(t: Tagged): u32 {
  return t.id + t.tag;
}

export class Derived extends Base {
  /** Its own. */
  n: f32 = 0.;
}
`,
      '/app/lib.shade.ts': `"use typeshade";

export class Base {
  /** The base's own field, from the library. */
  id: f32 = 0.;
}
`,
    };
    const f = hostFace(files['/app/m.shade.ts']!, {
      fileName: '/app/m.shade.ts',
      runtime: RUNTIME,
      readDocument: (name) => files[name],
    });
    expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const view = f.view!;
    // A class below an exported class extends it (change 0109), so the field comes from the base,
    // which carries its comment.
    expect(view).toContain(`/** A shape. */
export declare class Shape {
  constructor();
  /** The x position. */
  x: number;
  y: number;
}
/** A circle. */
export declare class Circle extends Shape {
  constructor();
  /** The radius. */
  r: number;
}
`);
    // A base the module does not export is not extended: the class holds its fields, and their comments.
    expect(view).toContain(`export declare class Shown {
  constructor();
  /** The hidden field. */
  h: number;
  s: number;
}
`);
    expect(view).toContain(`export interface Tagged {
  /** The id. */
  id: number;
  /** The tag. */
  tag: number;
}
`);
    // A base another file declares is found in the linked source and read in its own file.
    expect(view).toContain(`export declare class Derived {
  constructor();
  /** The base's own field, from the library. */
  id: number;
  /** Its own. */
  n: number;
}
`);
  });

  it('writes the JSDoc of an exported class and of its fields, and leaves its other members as change 0109 declares them', () => {
    const f = face(`"use typeshade";
declare const gain: uniform<f32>;

/** A one-pole lowpass with its state. */
export class OnePole {
  /** The state of the filter. */
  z: f32 = 0.;
  k: f32;
  /** Builds the filter. */
  constructor(k: f32) {
    this.k = k;
  }
  /** One sample through the filter. */
  tick(x: f32): f32 {
    this.z = this.z + this.k * (x - this.z);
    return this.z;
  }
  /** Reads a binding, so a host cannot call it. */
  scaled(x: f32): f32 {
    return x * gain;
  }
  /** A static field is no field of the struct. */
  static LIMIT: f32 = 4.;
}
`);
    // The comment of the class and of each field is carried. The comment of the constructor, of a
    // method, of a member declared `never` and of a static member is not: the approved text of
    // change 0108 names the fields of a struct and not the other members of a class.
    const lines = f.view.split('\n');
    const at = lines.indexOf('export declare class OnePole {');
    expect(lines.slice(at - 1, at + 6)).toEqual([
      '/** A one-pole lowpass with its state. */',
      'export declare class OnePole {',
      '  constructor(k: number);',
      '  /** The state of the filter. */',
      '  z: number;',
      '  k: number;',
      '  tick(x: number): number;',
    ]);
    expect(lines[at + 6]).toMatch(
      /^ {2}\/\*\* Not callable from host code \(Rule 8\.20\): it reaches/,
    );
    expect(lines.slice(at + 7, at + 9)).toEqual(['  scaled: never;', '}']);
    expect(f.view).not.toMatch(/Builds the filter|One sample through|Reads a binding|static field/);
  });

  it('writes the JSDoc of a class with a field that has no host value before the view’s sentence', () => {
    const f = face(`"use typeshade";

/** Holds a count and an optional value. */
export class Holder {
  /** The count. */
  n: u32 = 0;
  v?: f32;
}
`);
    const above = commentAbove(f.view, 'export interface Holder');
    expect(above.slice(0, 2)).toEqual(['/** Holds a count and an optional value.', ' *']);
    expect(above[2]).toMatch(/^ \* A type with no host value \(Rule 8\.21\): /);
    expect(above[3]).toBe(' */');
    expect(f.view).toContain(`export interface Holder {
  /** The count. */
  n: number;
  v: never;
}
`);
  });

  it('keeps an enum and an interface with no comment on a member on one line, as before', () => {
    const f = face(`"use typeshade";

/** The shading. */
export enum Shading { Flat, Smooth }
/** A particle. */
export class Particle { pos: vec2 = vec2(0., 0.); mass: f32 = 1.; }
/** A probe. */
export interface Probe { value: f32; id: u32; }
export function read(p: Probe): f32 { return p.value; }
`);
    expect(f.view).toContain(
      '/** The shading. */\nexport declare const Shading: { readonly Flat: 0; readonly Smooth: 1; readonly [value: number]: string };\n',
    );
    expect(f.view).toContain(
      '/** A probe. */\nexport interface Probe { value: number; id: number }\n',
    );
    // A class is written as change 0109 declares it, with the comment of the class above it.
    expect(f.view).toContain(
      '/** A particle. */\nexport declare class Particle {\n  constructor();\n  pos: [number, number];\n  mass: number;\n}\n',
    );
  });

  it('writes the JSDoc of a @compute entry before the compiler’s sentence, in one block', () => {
    const f = face(`"use typeshade";
declare const out: storage<array<u32>, "read_write">;

/** Fills \`out\` with the index of each invocation. */
export const fill = compute([64], function fill(gid: builtin<"global_invocation_id", vec3u>) {
  out[gid.x] = gid.x;
});
`);
    // The comment sits above the first of the two signatures, as the sentence did.
    expect(commentAbove(f.view, 'export declare function fill(')).toEqual([
      '/** Fills `out` with the index of each invocation.',
      ' *',
      ` * ${compute('64, 1, 1')} ${queued('bindings')}`,
      ' */',
    ]);
  });

  it('writes the JSDoc of a kernel function before the compiler’s sentence, in one block', () => {
    const f = face(`"use typeshade";

/**
 * Scales \`a\` in place.
 * @param s the factor
 */
export function scale(a: array<f32>, s: f32): void {
  for (let i = 0; i < a.length; i++) a[i] = a[i] * s;
}
`);
    expect(commentAbove(f.view, 'export declare function scale(')).toEqual([
      '/**',
      ' * Scales `a` in place.',
      ' * @param s the factor',
      ' *',
      ` * ${KERNEL} ${queued('arrays')}`,
      ' */',
    ]);
  });

  it('writes the JSDoc of a full-screen @fragment entry before the compiler’s sentence', () => {
    const f = face(`"use typeshade";

/** Paints the position. */
export const fs = fragment(function fs(p: builtin<"position", vec4>): vec4 {
  return p;
});
`);
    expect(commentAbove(f.view, 'export declare function fs(')).toEqual([
      '/** Paints the position.',
      ' *',
      ` * ${FRAGMENT}`,
      ' */',
    ]);
  });

  it('writes the JSDoc of an export declared never before the reason', () => {
    const f = face(`"use typeshade";

/**
 * Returns what it is given.
 */
export function ident<T>(x: T): T {
  return x;
}
`);
    expect(commentAbove(f.view, 'export declare const ident: never')).toEqual([
      '/**',
      ' * Returns what it is given.',
      ' *',
      ` * ${GENERIC}`,
      ' */',
    ]);
  });

  it('writes a re-export with the comment of the file that declares it (Rule 3.9)', () => {
    const files: Readonly<Record<string, string>> = {
      '/app/m.shade.ts': `"use typeshade";

/** This comment is above the export list, and it is no one's comment. */
export { scale, Particle, Shading, LIMIT } from "./lib.shade.ts";
import { Wave, make } from "./lib.shade.ts";

/** Makes a wave. */
export function mk(a: f32): Wave {
  return make(a);
}

/** The local helper, exported under another name. */
function local(x: f32): f32 {
  return x + 1.;
}
export { local as renamed };
`,
      '/app/lib.shade.ts': `"use typeshade";

export class Wave {
  amplitude: f32;
}
export function make(a: f32): Wave {
  return { amplitude: a };
}

/**
 * Scales by three.
 * @param x the input
 */
export function scale(x: f32): f32 {
  return x * 3.;
}

/** A particle of the library. */
export class Particle {
  /** Position, in the library's units. */
  pos: vec2 = vec2(0., 0.);
}

/** A shading of the library. */
export enum Shading {
  /** Library flat. */
  Flat,
  Smooth,
}

/** The limit of the library. */
export const LIMIT: f32 = 4.;
`,
    };
    const f = hostFace(files['/app/m.shade.ts']!, {
      fileName: '/app/m.shade.ts',
      runtime: RUNTIME,
      readDocument: (name) => files[name],
    });
    expect(f.diagnostics).toEqual([]);
    const view = f.view!;
    expect(commentAbove(view, 'export declare function scale(')).toEqual([
      '/**',
      ' * Scales by three.',
      ' * @param x the input',
      ' */',
    ]);
    expect(view).toContain(`/** A particle of the library. */
export declare class Particle {
  constructor();
  /** Position, in the library's units. */
  pos: [number, number];
}
`);
    expect(view).toContain(`/** A shading of the library. */
export declare const Shading: {
  /** Library flat. */
  readonly Flat: 0;
  readonly Smooth: 1;
  readonly [value: number]: string;
};
`);
    expect(view).toContain(
      '/** The limit of the library. */\nexport declare const LIMIT: number;\n',
    );
    // The module's own export and its renamed one keep the comment of their declarations.
    expect(view).toContain('/** Makes a wave. */\nexport declare function mk(');
    expect(view).toContain(
      '/** The local helper, exported under another name. */\nexport declare function renamed(',
    );
    expect(view).not.toContain('no one');
  });

  it('copies every block attached to a declaration, in source order (decision D1)', () => {
    const f = face(`"use typeshade";

/** The first block. */
// Between the blocks, a line comment is not copied.
/** The second block. */
export function dbl(x: f32): f32 {
  return x * 2.;
}

/** The first of two. */
/** The last of two. */
export function bad<T>(x: T): T {
  return x;
}
`);
    expect(commentAbove(f.view, 'export declare function dbl(')).toEqual([
      '/** The first block. */',
      '/** The second block. */',
    ]);
    // The compiler's sentence goes in the last block, which is the one the editor shows.
    expect(commentAbove(f.view, 'export declare const bad: never')).toEqual([
      '/** The first of two. */',
      '/** The last of two.',
      ' *',
      ` * ${GENERIC}`,
      ' */',
    ]);
  });

  it('copies the tags and does not check them (decision D2)', () => {
    const f = face(`"use typeshade";

/**
 * @param nobody there is no such parameter
 * @deprecated use something else
 */
export function old(x: f32): f32 {
  return x;
}
`);
    expect(commentAbove(f.view, 'export declare function old(')).toEqual([
      '/**',
      ' * @param nobody there is no such parameter',
      ' * @deprecated use something else',
      ' */',
    ]);
  });

  it('gives the comment above a statement to its first declarator, as TypeScript does', () => {
    const f = face(`"use typeshade";

/** The pair. */
export const A: f32 = 1., B: f32 = 2.;
`);
    expect(f.view).toContain(
      '/** The pair. */\nexport declare const A: number;\nexport declare const B: number;\n',
    );
  });

  it('gives a comment above the directive to no export', () => {
    const f = face(`/** The module. */
"use typeshade";

export function f(): f32 {
  return 1.;
}
`);
    expect(f.view).not.toContain('The module.');
  });

  it('writes the same view for a source with Windows line breaks', () => {
    const lf = `"use typeshade";

/**
 * Two lines.
 * Of text.
 */
export function f(): f32 {
  return 1.;
}
`;
    expect(face(lf.replace(/\n/g, '\r\n')).view).toBe(face(lf).view);
    expect(face(lf).view).not.toContain('\r');
  });

  it('changes the view of a module with no JSDoc by the queue sentence alone (item 3)', () => {
    const f = face(`"use typeshade";
declare const out: storage<array<u32>, "read_write">;
declare const k: uniform<f32>;
declare const fixed: storage<array<f32, 8>, "read_write">;

export const EPS: f32 = 0.001;
export enum Mode { A, B = 4 }
export class Particle { pos: vec2 = vec2(0., 0.); mass: f32 = 1.; }
export class Holder { n: u32 = 0; v?: f32; }

export function twice(x: f32): f32 {
  return x * 2.;
}

export function scale(a: array<f32>, s: f32): void {
  for (let i = 0; i < a.length; i++) a[i] = a[i] * s;
}

export function total(a: array<f32>): f32 {
  let sum = 0.;
  for (let i = 0; i < a.length; i++) sum += a[i];
  return sum;
}

export const fill = compute([64], function fill(gid: builtin<"global_invocation_id", vec3u>) {
  out[gid.x] = gid.x;
});

export const sized = compute([8], function sized(gid: builtin<"global_invocation_id", vec3u>) {
  fixed[gid.x] = k;
});

export const fs = fragment(function fs(p: builtin<"position", vec4>): vec4 {
  return p;
});

export function ident<T>(x: T): T {
  return x;
}
`);
    const lines = f.view.split('\n');
    // No comment but the compiler's own, each on one line, as before.
    expect(lines.filter((l) => l.startsWith('/**')).every((l) => l.endsWith(' */'))).toBe(true);
    expect(lines.some((l) => l.startsWith(' *'))).toBe(false);
    expect(lines).toContain('export declare const EPS: number;');
    expect(lines).toContain(
      'export declare const Mode: { readonly A: 0; readonly B: 4; readonly [value: number]: string };',
    );
    const at = lines.indexOf('export declare class Particle {');
    expect(lines.slice(at, at + 5)).toEqual([
      'export declare class Particle {',
      '  constructor();',
      '  pos: [number, number];',
      '  mass: number;',
      '}',
    ]);
    // A class with a field that has no host value is a type, with the reason on its line (change 0109).
    expect(lines).toContain('export interface Holder { n: number; v: never }');
    expect(commentAbove(f.view, 'export interface Holder')).toEqual([
      expect.stringMatching(/^\/\*\* A type with no host value \(Rule 8\.21\): .* \*\/$/),
    ]);
    expect(lines).toContain('export declare function twice(x: number): number;');
    // The sentences of a kernel function and of a @compute entry, each ending with the queue sentence.
    const one = (declaration: string): string[] => commentAbove(f.view, declaration);
    expect(one('export declare function scale(')).toEqual([`/** ${KERNEL} ${queued('arrays')} */`]);
    expect(one('export declare function total(')).toEqual([`/** ${KERNEL} ${queued('arrays')} */`]);
    expect(one('export declare function fill(')).toEqual([
      `/** ${compute('64, 1, 1')} ${queued('bindings')} */`,
    ]);
    expect(one('export declare function sized(')).toEqual([
      `/** ${compute('8, 1, 1')} ${queued('bindings')} */`,
    ]);
    // The sentences of a full-screen @fragment entry and of an export declared never are as they were.
    expect(one('export declare function fs(')).toEqual([`/** ${FRAGMENT} */`]);
    expect(one('export declare const ident: never')).toEqual([`/** ${GENERIC} */`]);
  });

  it('shows the editor the author’s words first and the compiler’s sentence after them', () => {
    const files: Readonly<Record<string, string>> = {
      '/app/m.shade.ts': `"use typeshade";

/** The height of the terrain at \`p\`. */
export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}

/** How the terrain is shaded. */
export enum Shading {
  /** Flat colours. */
  Flat,
  Smooth,
}

export class Particle {
  /** Where it is. */
  pos: vec2 = vec2(0., 0.);
}

/** Scales \`a\` in place. */
export function scale(a: array<f32>, s: f32): void {
  for (let i = 0; i < a.length; i++) a[i] = a[i] * s;
}

/** The first block, which the editor does not show. */
/** Returns what it is given. */
export function ident<T>(x: T): T {
  return x;
}
`,
    };
    const f = hostFace(files['/app/m.shade.ts']!, {
      fileName: '/app/m.shade.ts',
      runtime: './runtime.ts',
    });
    expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const host = `import { height, Shading, scale, ident } from './m.shade.ts';
import type { Particle } from './m.shade.ts';
const h = height([1, 2], [1, 2, 3, 4]);
let s = Shading.Flat;
const p: Particle = { pos: [1, 2] };
scale(new Float32Array(4), 2);
ident;
export { h, s, p };
`;
    const read = (at: string) => hover(f.view!, host, at);
    expect(read('height([1').errors).toEqual([]);
    expect(read('height([1').documentation).toBe('The height of the terrain at `p`.');
    expect(read('Shading.Flat').documentation).toBe('How the terrain is shaded.');
    expect(read('Flat;').documentation).toBe('Flat colours.');
    expect(read('pos: [1').documentation).toBe('Where it is.');
    const scaled = read('scale(new').documentation;
    expect(scaled.startsWith('Scales `a` in place.')).toBe(true);
    expect(scaled).toContain(KERNEL);
    expect(scaled).toContain(queued('arrays'));
    // The editor shows the last block of a declaration, which is where the sentence stands.
    const never = read('ident;').documentation;
    expect(never.startsWith('Returns what it is given.')).toBe(true);
    expect(never).toContain(GENERIC);
    expect(never).not.toContain('The first block');
  });
});

describe('a host call (Rule 8.21)', () => {
  it('checks and converts each argument, a Float32Array vector included', async () => {
    const m = await load(TERRAIN);
    const height = m.height as (p: ArrayLike<number>, k: ArrayLike<number>) => number;
    const want = height([0.5, 0.5], [1, 0.5, 2, 0.25]);
    expect(typeof want).toBe('number');
    expect(height(new Float32Array([0.5, 0.5]), new Float32Array([1, 0.5, 2, 0.25]))).toBe(want);
  });

  it('refuses a value that does not fit with a TypeError naming the function, the parameter and its type', async () => {
    const m = await load(`"use typeshade";
export class S { a: f32 = 0.; }
export function f(v: vec2, i: i32, u: u32, b: vec2b, s: S, xs: array<f32, 2>): f32 { return v.x; }
`);
    const f = m.f as (...a: unknown[]) => number;
    const ok = [[1, 2], 1, 2, [true, false], { a: 1 }, [1, 2]];
    expect(f(...ok)).toBe(1);
    const call = (i: number, v: unknown) => () => f(...ok.map((x, j) => (j === i ? v : x)));
    expect(call(0, [1])).toThrow(
      new TypeError('f(): parameter "v" (vec2): got an array of length 1.'),
    );
    expect(call(0, 'ab')).toThrow(/^f\(\): parameter "v" \(vec2\): got the string "ab"\.$/);
    expect(call(0, [1, '2'])).toThrow('f(): parameter "v" (vec2): at [1], got the string "2".');
    expect(call(1, 1.5)).toThrow(
      'f(): parameter "i" (i32): got 1.5, which is not a whole number in the i32 range.',
    );
    expect(call(2, -1)).toThrow('parameter "u" (u32): got -1');
    expect(call(2, 2 ** 32)).toThrow('parameter "u" (u32)');
    expect(call(3, [1, 0])).toThrow('f(): parameter "b" (vec2b): at [0], got number 1.');
    expect(call(4, {})).toThrow('f(): parameter "s" (S): at .a, the field is missing.');
    expect(call(5, [1, 2, 3])).toThrow('parameter "xs" (array<f32, 2>): got an array of length 3');
    expect(() => f(...ok.slice(1))).toThrow(new TypeError('f() takes 6 arguments; got 5.'));
    for (const t of [call(0, [1]), call(1, 1.5)]) expect(t).toThrow(TypeError);
  });

  it('refuses a call of an export with no host face, with the reason', async () => {
    const m = await load(`"use typeshade";
export const fs = fragment(function fs(uv: location<0, vec2>): vec4 { return vec4(uv, 0., 1.); });
`);
    expect(() => (m.fs as () => unknown)()).toThrow(
      'fs cannot be called from host code: parameter "uv" is what a vertex entry writes',
    );
  });

  it('returns a value that aliases no argument, and a constant the host cannot write', async () => {
    const m = await load(`"use typeshade";
export const V = vec3(1., 2., 3.);
export class S { v: vec2 = vec2(0., 0.); }
export function echo(v: vec2): vec2 { return v; }
export function wrap(s: S): S { return s; }
export function readV(): vec3 { return V; }
`);
    const arg = [1, 2];
    const out = (m.echo as (v: number[]) => number[])(arg);
    expect(out).toEqual([1, 2]);
    expect(out).not.toBe(arg);
    out[0] = 9;
    expect(arg).toEqual([1, 2]);
    const s = { v: [3, 4] };
    const back = (m.wrap as (s: { v: number[] }) => { v: number[] })(s);
    expect(back).toEqual(s);
    expect(back).not.toBe(s);
    expect(back.v).not.toBe(s.v);
    expect(m.V).toEqual([1, 2, 3]);
    expect(Object.isFrozen(m.V)).toBe(true);
    expect(() => {
      (m.V as number[])[0] = 7;
    }).toThrow(TypeError);
    expect((m.readV as () => number[])()).toEqual([1, 2, 3]);
  });

  it('exports an enum as its members, both ways', async () => {
    const m = await load(`"use typeshade";
export enum Mode { A, B = 4 }
export function isB(m: i32): bool { return m === Mode.B; }
`);
    expect(m.Mode).toEqual({ A: 0, B: 4, 0: 'A', 4: 'B' });
    expect((m.isB as (x: number) => boolean)(4)).toBe(true);
  });

  it('loads a module whose exports are named after the globals its code reads', async () => {
    // A name the file declares is the file's (Rule 2.1), and the generated module binds none of
    // them: each export is bound under a name of its own and exported under the file's. Bound as
    // written, an export `Object` beside an enum left its `Object.freeze` undefined, and `Math`
    // the `Math.imul` of an integer product and the `Math.fround` of a comparison, so the module
    // did not load; an enum `eval` was a module the host could not parse.
    const source = `"use typeshade";
export enum Mode { A, B = 4 }
export enum eval { C = 7 }
const K: f32 = 1.5;
export function Object(x: f32): f32 { return x * 2.; }
export function Math(a: i32, b: i32): i32 { return a * b; }
export function NaN(x: f32): bool { return x === K; }
export function Infinity(x: f32): f32 { return x + K; }
export function undefined(x: f32): f32 { return -x; }
export const Array: f32 = 1.;
export const Symbol: f32 = 2.;
export const globalThis: f32 = 3.;
export const Error: f32 = 4.;
export const Number: f32 = 5.;
`;
    // The code reads each global the exports would have shadowed: `Math.fround` once, where
    // the CPU tier's code binds it (#410).
    const code = face(source).code;
    for (const read of ['Object.freeze(', 'Math.imul(', 'const $fr = Math.fround;'])
      expect(code).toContain(read);
    const m = await load(source);
    const call = (name: string, ...args: number[]): unknown =>
      (m[name] as (...a: number[]) => unknown)(...args);
    expect(m.Mode).toEqual({ A: 0, B: 4, 0: 'A', 4: 'B' });
    expect(m.eval).toEqual({ C: 7, 7: 'C' });
    expect(call('Object', 3)).toBe(6);
    expect(call('Math', 3, 4)).toBe(12);
    expect(call('NaN', 1.5)).toBe(true);
    expect(call('Infinity', 1)).toBe(2.5);
    expect(call('undefined', 2)).toBe(-2);
    expect([m.Array, m.Symbol, m.globalThis, m.Error, m.Number]).toEqual([1, 2, 3, 4, 5]);
    // A callable export keeps the file's name as its own.
    expect((m.Object as () => unknown).name).toBe('Object');
  });

  it('starts a module private variable over at every call, as one invocation', async () => {
    const m = await load(`"use typeshade";
let count: f32 = 0.;
export function bump(x: f32): f32 { count += x; return count; }
`);
    const bump = m.bump as (x: number) => number;
    expect(bump(1)).toBe(1);
    expect(bump(1)).toBe(1);
  });
});

describe('the CPU tier runs at f32 precision (Rule 11.7)', () => {
  const SOURCE = `"use typeshade";
export function sum(a: f32, b: f32): f32 { return a + b; }
export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
export function lerp3(a: vec3, b: vec3, t: f32): vec3 { return mix(a, b, t); }
export function photoCell(q: vec3, k: vec4, grid: vec4): vec3 {
  const cell = floor((q.xy - grid.xy) / grid.zw);
  const d = max(q.z * k.w, 1e-4);
  return vec3(cell.x + k.x * d, cell.y + k.y * d, d * k.z);
}
export function seenEmpty(depth: f32, a: f32, b: f32, c: f32, d: f32, scale: f32): bool {
  const m = min(min(a, b), min(c, d));
  return depth * scale < m - 0.01;
}
`;
  const CASES: Record<string, unknown[][]> = {
    // The two functions #410 measured, written out per component by the CPU tier.
    photoCell: [
      [
        [0.3, 0.7, 2.5],
        [0.1, 0.2, 0.3, 0.9],
        [0, 0, 0.01, 0.01],
      ],
      [
        [-1.25, 3.1, 0.7],
        [0.5, -0.25, 1e-3, 0.7],
        [0.1, -0.2, 0.05, 0.3],
      ],
    ],
    seenEmpty: [
      [0.5, 0.6, 0.7, 0.8, 0.9, 1],
      [0.1, 0.2, 0.11, 0.3, 0.4, 0.3],
    ],
    sum: [
      [1, 1e-8],
      [0.1, 0.2],
      [16777216, 1],
    ],
    height: [
      [
        [0.1, 0.7],
        [1.3, 0.5, 2.1, 0.25],
      ],
      [
        [3.3, -1.7],
        [0.7, 1.9, 0.3, 4.1],
      ],
    ],
    lerp3: [
      [[0.1, 0.2, 0.3], [0.7, 0.11, 1e-9], 0.3],
      [[1, 2, 3], [4, 5, 6], 0.1],
    ],
  };

  it('every call equals compileModule(m, { precision: "f32" }) on inputs where f32 and f64 part', async () => {
    const m = await load(SOURCE);
    const mod = compile(SOURCE).module;
    const f32 = compileModule(mod, { precision: 'f32' });
    const f64 = compileModule(mod);
    let parted = 0;
    for (const [name, rows] of Object.entries(CASES)) {
      for (const args of rows) {
        // The oracle is handed what a buffer write would hold, as the host call converts it.
        const rounded = args.map((a) =>
          Array.isArray(a) ? a.map((x) => Math.fround(x as number)) : Math.fround(a as number),
        );
        const got = (m[name] as (...a: unknown[]) => unknown)(...args);
        expect(got).toEqual(f32.fns[name]!(...(rounded as never[])));
        if (JSON.stringify(got) !== JSON.stringify(f64.fns[name]!(...(args as never[])))) parted++;
      }
    }
    // The inputs are chosen so the two precisions answer differently; a zero here would mean the
    // comparison could not tell the f32 tier from the f64 oracle (AGENTS.md#gate-discipline).
    expect(parted).toBeGreaterThanOrEqual(5);
  });

  it('ships no new Function: the CPU tier is module code', () => {
    const f = face(SOURCE);
    expect(f.code).not.toMatch(/new Function|\beval\(/);
    expect(f.code).toMatch(/^import \* as __ts_rt from /m);
  });

  it('generates code for the functions a host call reaches, and not an entry point', () => {
    const f = face(`"use typeshade";
export function helper(x: f32): f32 { return x * 2.; }
export const fs = fragment(function fs(): vec4 { return vec4(dpdx(1.)); });
`);
    expect(f.code).toContain('"helper": function');
    expect(f.code).not.toContain('"fs": function');
  });
});
