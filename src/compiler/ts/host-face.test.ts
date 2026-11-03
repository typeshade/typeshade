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
import { buildManifest } from '../../core/manifest.js';
import { layoutFromPack } from '../../core/manifest-types.js';
import { Misfit, pack as packBytes } from '../../core/host-entry.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
/** The host type family (change 0116), which a view imports from its runtime. */
const FAMILY = resolve(__dirname, '../../runtime/host-types.ts');
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
    expect(k.bump).toMatch(/^parameter "v" is inout<T> or out<T>/);
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
    expect(f.view).toContain('export interface I { x: f32 }');
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
    expect(f.view).toContain('export declare function scale(x: f32): f32;');
    // `P` is not an export of this module, so the view spells its layout where the signature
    // names it.
    expect(f.view).toContain('export declare function mk(a: f32): { x: f32; v: vec2 };');
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
    // Each binding spelled with the host type family (change 0116): a runtime-sized storage
    // array is `array<T>`, which holds its `Resident`, and a uniform struct is its fields.
    const viewT = `{ readonly viewProj: mat4x4 | ${numbers}; readonly time: f32 }`;
    expect(f.view).toContain(
      `declare const program: Pack<{ readonly vs: { readonly view: ${viewT} | Resident<${viewT}> | ${gpu}; readonly cells: array<vec2> | ${gpu} }; readonly fs: { readonly albedo: object; readonly samp: object } }>;`,
    );
    expect(f.view).toContain('import type { f32, vec2, mat4x4, array } from');
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
    // Each row in the host type family's names (change 0116), an argument and a result alike
    // (decision D1); a struct goes by its name as an argument and as a result (decision D7).
    expect(f.view).toContain(
      'export declare function scalars(a: f32, b: i32, c: u32, d: bool): f32;',
    );
    expect(f.view).toContain(
      'export declare function vectors(a: vec3, b: vec2i, c: vec4u, d: vec2b): vec2b;',
    );
    expect(f.view).toContain('export declare function matrix(m: mat2x3): mat2x3;');
    expect(f.view).toContain('export declare function list(xs: array<f32, 3>): array<vec2, 2>;');
    // A class is a value and an interface a type (change 0109): the row of a struct splits.
    expect(f.view).toContain(
      'export declare class S {\n  constructor();\n  a: f32;\n  v: vec2;\n}',
    );
    expect(f.view).toContain('export interface J { a: f32; v: vec2 }');
    expect(f.view).toContain('export declare function record(s: S): S;');
    expect(f.view).toContain('export declare function jx(j: J): J;');
    expect(f.view).toContain('export declare function nothing(x: f32): void;');
    // The view imports the names it writes, in the family's order, and no other.
    expect(f.view).toContain(
      'import type { f32, i32, u32, bool, vec2, vec3, vec4u, vec2i, vec2b, mat2x3, array } from',
    );
  });

  it('writes a struct by its name as an argument, a binding and an element (change 0116, D7 and D8)', async () => {
    const source = `"use typeshade";
export interface Cam { scale: vec2; time: f32; }
export class P { x: f32 = 0.; v: vec2 = vec2(0., 0.); len(): f32 { return this.x; } }
class Hidden { a: f32; }
type Channel = "r" | "g" | "b";
export interface Keyed { c: Channel; w: f32; }
export const ORIGIN: Cam = { scale: vec2(1., 1.), time: 0. };
export abstract class Shape { w: f32 = 1.; abstract sdf(p: f32): f32; }
export class Ball extends Shape { sdf(p: f32): f32 { return p - this.w; } }
declare const cam: uniform<Cam>;
declare const ps: storage<array<P>, "read_write">;
declare const hs: storage<array<Hidden>>;
export function use(c: Cam, h: Hidden, k: Keyed, p: P): P { return p; }
export function area(s: Shape): f32 { return s.w; }
export function asShape(w: f32): Shape { return { w: w }; }
export function kern(xs: array<P>, ks: array<Keyed>, out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { out[i] = xs[i].x + ks[i].w; }
}
@compute([8])
export function step(@builtin("global_invocation_id") gid: vec3u) {
  ps[gid.x].x = cam.time + hs[gid.x].a;
}
`;
    expect(compile(source).diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const v = face(source).view;
    // An interface by its name, an exported class by the class, a struct the view declares no
    // name for by its fields (D7).
    expect(v).toContain(
      'export declare function use(c: Cam, h: { readonly a: f32 }, k: Keyed, p: P): P;',
    );
    // An abstract class is the class as an argument, and an object of its fields as a result,
    // which is no instance (change 0109); a constant is a frozen object of its fields.
    expect(v).toContain('export declare function area(s: Shape): f32;');
    expect(v).toContain('export declare function asShape(w: f32): { w: f32 };');
    expect(v).toContain(
      'export declare const ORIGIN: { readonly scale: vec2; readonly time: f32 };',
    );
    // In an array with no size a struct that holds a key is its fields, with the key's id.
    expect(v).toContain(
      'export declare function kern(xs: array<P>, ks: array<{ readonly c: u32; readonly w: f32 }>, out: array<f32>): Promise<void>;',
    );
    // An entry's bindings object takes the names too, and the manifest writes each struct
    // binding's name beside its packed forms (D8).
    expect(v).toContain(
      'bindings: { readonly cam: Cam; readonly ps: array<P>; readonly hs: array<{ readonly a: f32 }> }',
    );
    const numbers = 'Float32Array | Int32Array | Uint32Array | Float64Array';
    const gpu = '{ readonly mapAsync: unknown; readonly getMappedRange: unknown }';
    const packed = `{ readonly scale: vec2 | ${numbers}; readonly time: f32 }`;
    expect(v).toContain(`readonly cam: Cam | ${packed} | Resident<Cam | ${packed}> | ${gpu};`);
    expect(v).toContain(
      `readonly ps: array<P | { readonly x: f32; readonly v: vec2 | ${numbers} }> | ${gpu};`,
    );
    // Under tsc: a plain object where the interface goes, an instance where the class goes, and
    // a packed form where the manifest takes one. A plain object where a class with a method goes
    // is refused (D10); a class of fields alone takes one, as TypeScript compares by shape.
    const runtime = JSON.stringify(resolve(__dirname, '../../runtime.ts'));
    const host = (line: string): string =>
      `import { use, area, kern, step, Ball, P } from './terrain.shade.ts';\nimport program from './terrain.shade.ts';\nimport type { BindingsOf } from ${runtime};\nconst ks = [{ c: 1, w: 2 }];\n${line}\nexport {};\n`;
    expect(
      await hostErrors(
        source,
        host(
          [
            "const p: P = use({ scale: [1, 2], time: 0 }, { a: 1 }, { c: 'r', w: 1 }, new P());",
            'const a: number = area(new Ball());',
            'await kern([p], ks, new Float32Array(1));',
            'await step({ cam: { scale: [1, 1], time: 0 }, ps: [p], hs: [{ a: 1 }] }, 1);',
            "const b: BindingsOf<typeof program, 'step'> = { cam: { scale: new Float32Array(2), time: 0 }, ps: [p], hs: [{ a: 1 }] };",
            'void a; void b;',
          ].join('\n'),
        ),
      ),
    ).toEqual([]);
    expect(
      await hostErrors(
        source,
        host("use({ scale: [1, 2], time: 0 }, { a: 1 }, { c: 'r', w: 1 }, { x: 0, v: [0, 0] });"),
      ),
    ).toEqual(['app.ts TS2345']);
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

  it('type-checks a host program that writes the names of the host type family (change 0116)', async () => {
    // A host file imports the names from `typeshade/runtime` (here its source), and they meet the
    // view's: a plain literal is a value of each, and a name is not another name.
    const runtime = JSON.stringify(resolve(__dirname, '../../runtime.ts'));
    const host = (line: string): string =>
      `import type { f32, u32, vec2, vec4 } from ${runtime};\nimport { height } from './terrain.shade.ts';\nconst p: vec2 = [0.5, 0.5];\nconst k: vec4 = [1, 0.5, 2, 0.25];\n${line}\n`;
    expect(await hostErrors(TERRAIN, host('export const h: f32 = height(p, k);'))).toEqual([]);
    expect(await hostErrors(TERRAIN, host('export const n: u32 = height(p, k);'))).toEqual([
      'app.ts TS2322',
    ]);
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
    [
      '/app/runtime.ts',
      `export type Resident<T> = T;\nexport type Pack<T> = T;\nexport type * from ${JSON.stringify(FAMILY)};\n`,
    ],
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
    `A \`compute([${shape}], f)\` entry: \`workgroups\` counts workgroups, dispatched as written, or is \`{ indirect, offset? }\`, the three counts at element \`offset\` of a Resident a call wrote (change 0075); each binding the entry writes is read back into your value in place, or stays on the device in a Resident. The shape shown is its default; options.constants selects declared overrides without changing workgroups (Rules 8.24 and 11.8).`;
  const FRAGMENT =
    'A full-screen `fragment(f)` entry: draws one frame into `target`, filling its width by height, on WebGPU, then WebGL2, then the CPU. The first draw into a canvas decides its tier. The promise resolves when the frame is submitted; nothing is read back (Rule 8.24).';
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
      '/** The step of the finite difference. */\nexport declare const EPS: f32;\n',
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
  pos: vec2;
  /** How fast it moves. */
  vel: vec2;
  mass: f32;
}
`);
    // An interface and a type alias stay `export interface`, where the module uses them as structs.
    // The continuation lines of a block take the indentation of the view, not that of the source.
    expect(f.view).toContain(`/** What a probe read. */
export interface Probe {
  /**
   * The reading, indented four spaces in the source.
   */
  value: f32;
  id: u32;
}
`);
    expect(f.view).toContain(`export interface Pair {
  /** The left one. */
  left: f32;
  right: f32;
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
  x: f32;
  y: f32;
}
/** A circle. */
export declare class Circle extends Shape {
  constructor();
  /** The radius. */
  r: f32;
}
`);
    // A base the module does not export is not extended: the class holds its fields, and their comments.
    expect(view).toContain(`export declare class Shown {
  constructor();
  /** The hidden field. */
  h: f32;
  s: f32;
}
`);
    expect(view).toContain(`export interface Tagged {
  /** The id. */
  id: u32;
  /** The tag. */
  tag: u32;
}
`);
    // A base another file declares is found in the linked source and read in its own file.
    expect(view).toContain(`export declare class Derived {
  constructor();
  /** The base's own field, from the library. */
  id: f32;
  /** Its own. */
  n: f32;
}
`);
  });

  it('writes the JSDoc of an exported class, of its fields and of its members, each on its line', () => {
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
    // The comment of the class, of each field and of each member the view declares is carried (item
    // 4): the constructor, the method, and the member declared `never` with the sentence of change
    // 0109 at the end of its block. A static field is no member of the host class (§26), so the view
    // declares it nowhere and carries no comment of it.
    const lines = f.view.split('\n');
    const at = lines.indexOf('export declare class OnePole {');
    expect(lines.slice(at - 1, at + 9)).toEqual([
      '/** A one-pole lowpass with its state. */',
      'export declare class OnePole {',
      '  /** Builds the filter. */',
      '  constructor(k: f32);',
      '  /** The state of the filter. */',
      '  z: f32;',
      '  k: f32;',
      '  /** One sample through the filter. */',
      '  tick(x: f32): f32;',
      '  /** Reads a binding, so a host cannot call it.',
    ]);
    expect(lines[at + 9]).toBe('   *');
    expect(lines[at + 10]).toMatch(
      /^ {3}\* Not callable from host code \(Rule 8\.20\): it reaches/,
    );
    expect(lines.slice(at + 11, at + 14)).toEqual(['   */', '  scaled: never;', '}']);
    expect(f.view).not.toMatch(/static field|LIMIT/);
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
  n: u32;
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
    expect(f.view).toContain('/** A probe. */\nexport interface Probe { value: f32; id: u32 }\n');
    // A class is written as change 0109 declares it, with the comment of the class above it.
    expect(f.view).toContain(
      '/** A particle. */\nexport declare class Particle {\n  constructor();\n  pos: vec2;\n  mass: f32;\n}\n',
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
  pos: vec2;
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
    expect(view).toContain('/** The limit of the library. */\nexport declare const LIMIT: f32;\n');
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
      '/** The pair. */\nexport declare const A: f32;\nexport declare const B: f32;\n',
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
    expect(lines).toContain('export declare const EPS: f32;');
    expect(lines).toContain(
      'export declare const Mode: { readonly A: 0; readonly B: 4; readonly [value: number]: string };',
    );
    const at = lines.indexOf('export declare class Particle {');
    expect(lines.slice(at, at + 5)).toEqual([
      'export declare class Particle {',
      '  constructor();',
      '  pos: vec2;',
      '  mass: f32;',
      '}',
    ]);
    // A class with a field that has no host value is a type, with the reason on its line (change 0109).
    expect(lines).toContain('export interface Holder { n: u32; v: never }');
    expect(commentAbove(f.view, 'export interface Holder')).toEqual([
      expect.stringMatching(/^\/\*\* A type with no host value \(Rule 8\.21\): .* \*\/$/),
    ]);
    expect(lines).toContain('export declare function twice(x: f32): f32;');
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

// Item 4 of change 0108 (Amendment 1): the members of an exported class. The view declares a class
// over several lines (change 0109), so the comment of a member stands on the member's line, as that
// of a field does. Each case reads the text of the view, which is what `tsc` and the editor take, and
// the last one reads the editor's hover on a host file.
describe('the view carries the comments of the members of an exported class (change 0108, item 4)', () => {
  const BINDING =
    'it reaches a resource binding, which a helper call passes none of; call the entry that uses it (Rule 8.24)';
  const TAKES_FUNCTION =
    'it takes a function, and such a function exists only as the copies the module uses; no proposal adds it yet';
  /** The sentence of change 0109 for a member the view declares `never`. */
  const refused = (reason: string): string => `Not callable from host code (Rule 8.20): ${reason}.`;

  /** Both readers of the shader take the program with no diagnostic (Rule 12.7): `compile()` and
   *  the editor's language service. `files` holds the module, `/app/m.shade.ts`, and the files it
   *  imports. */
  function bothHalvesTake(files: Readonly<Record<string, string>>): void {
    const compiled = compile(files['/app/m.shade.ts']!, {
      fileName: '/app/m.shade.ts',
      readDocument: (name) => files[name],
    });
    expect(compiled.diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService({ readDocument: (name) => files[name] });
    for (const [name, text] of Object.entries(files)) {
      service.openDocument(name, text);
      expect(service.getDiagnostics(name), name).toEqual([]);
    }
  }

  /** The face of `source` as `m.shade.ts`, once both readers of the shader have taken it. */
  function faceOf(source: string) {
    bothHalvesTake({ '/app/m.shade.ts': source });
    return face(source);
  }

  it('writes the JSDoc of a constructor on its line', () => {
    const f = faceOf(`"use typeshade";

/** A one-pole lowpass with its state. */
export class OnePole {
  z: f32 = 0.;
  k: f32;
  /**
   * Builds the filter.
   * @param k the smoothing factor
   */
  constructor(k: f32) {
    this.k = k;
  }
}

/** A class with no constructor has none to document. */
export class Plain {
  v: f32 = 1.;
}
`);
    expect(f.view).toContain(`/** A one-pole lowpass with its state. */
export declare class OnePole {
  /**
   * Builds the filter.
   * @param k the smoothing factor
   */
  constructor(k: f32);
  z: f32;
  k: f32;
}
`);
    expect(f.view).toContain(`export declare class Plain {
  constructor();
  v: f32;
}
`);
  });

  it('writes the JSDoc of a method on its line, every block of it, and that of a field that holds a function', () => {
    const f = faceOf(`"use typeshade";

export class OnePole {
  z: f32 = 0.;
  k: f32 = 0.5;
  /**
   * One sample through the filter.
   * @param x the input sample
   * @returns the filtered sample
   */
  tick(x: f32): f32 {
    this.z = this.z + this.k * (x - this.z);
    return this.z;
  }
  // A line comment is not JSDoc.
  /** The first block. */
  /** The second block, which the editor shows. */
  peek(x: f32): f32 {
    /** Inside a body, a comment belongs to nothing. */
    return this.z + this.k * (x - this.z);
  }
  reset(): void {
    this.z = 0.;
  }
  /** Called with the distance of a hit. */
  onHit = (d: f32): f32 => d * this.k;
}
`);
    expect(f.view).toContain(`export declare class OnePole {
  constructor();
  z: f32;
  k: f32;
  /**
   * One sample through the filter.
   * @param x the input sample
   * @returns the filtered sample
   */
  tick(x: f32): f32;
  /** The first block. */
  /** The second block, which the editor shows. */
  peek(x: f32): f32;
  reset(): void;
  /** Called with the distance of a hit. */
  onHit(d: f32): f32;
}
`);
    expect(f.view).not.toMatch(/line comment|Inside a body/);
  });

  it('writes the JSDoc of a getter and of a setter, each on the line of its half', () => {
    const f = faceOf(`"use typeshade";

export class Slider {
  v: f32 = 0.;
  /** The value, clamped to the unit range. */
  get value(): f32 {
    return clamp(this.v, 0., 1.);
  }
  /**
   * Sets the value.
   * The getter clamps it.
   */
  set value(x: f32) {
    this.v = x;
  }
  /** A getter alone. */
  get half(): f32 {
    return this.v * 0.5;
  }
  set twice(x: f32) {
    this.v = x * 0.5;
  }
}
`);
    expect(f.view).toContain(`export declare class Slider {
  constructor();
  v: f32;
  /** The value, clamped to the unit range. */
  get value(): f32;
  /**
   * Sets the value.
   * The getter clamps it.
   */
  set value(x: f32);
  /** A getter alone. */
  get half(): f32;
  set twice(x: f32);
}
`);
  });

  it('leaves the comment of a static field out, since the view declares no static field (§26)', () => {
    const f = faceOf(`"use typeshade";

export class Limits {
  /** The upper limit. */
  static MAX: f32 = 4.;
  /** The unit. */
  static readonly UNIT: f32 = 1.;
  v: f32 = 0.;
  /** Doubles \`x\`. */
  static twice(x: f32): f32 {
    return x * 2.;
  }
}
`);
    // A static field is the module constant `Limits_MAX` and no member of the host class (change
    // 0109 declares the static functions), so no line of the view can carry its comment, and the
    // comment of the static function beside it stays on its own line.
    expect(f.view).toContain(`export declare class Limits {
  constructor();
  v: f32;
  /** Doubles \`x\`. */
  static twice(x: f32): f32;
}
`);
    expect(f.view).not.toMatch(/upper limit|The unit|MAX|UNIT/);
  });

  it('writes the JSDoc of a field with a private name on its private line, as a public field has it (#951)', () => {
    const source = `"use typeshade";

export class Counter {
  /** The count so far. */
  #n: u32 = 0;
  /**
   * The step of each tick.
   * @defaultValue 1
   */
  #step: u32 = 1;
  /** The tag, written with the keyword. */
  private tag: u32 = 2;
  /** The total, public. */
  total: u32 = 0;
  /** The ticks made, a static with a private name. */
  static #ticks: u32 = 0;
  /** Counts once. */
  tick(): u32 {
    this.#n += this.#step;
    return this.#n;
  }
}
`;
    // Both readers of the shader take the program (Rule 12.7), and it is the compiler that writes
    // the view. `#n` is the field `n` of the struct (Rule 8.12), which the view declares as `#n`
    // (§26, change 0109, Amendment 2): its line carries the author's blocks, with their tags, as
    // the line of a field written `private` or public does. A static field is a constant of the
    // module and has no line.
    const f = faceOf(source);
    expect(f.view).toContain(`export declare class Counter {
  constructor();
  /** The count so far. */
  #n: u32;
  /**
   * The step of each tick.
   * @defaultValue 1
   */
  #step: u32;
  /** The tag, written with the keyword. */
  private tag: u32;
  /** The total, public. */
  total: u32;
  /** Counts once. */
  tick(): u32;
}
`);
    expect(f.view).not.toMatch(/ticks/);
    // The editor's hover over a member in a host program shows the comment too. A field written
    // with the keyword is private to `tsc`, which refuses the access but hovers the member. A field
    // with a private name is no member a host can name, so there is nothing to hover and the
    // access is "does not exist" (TS2339), where the line keeps the comment for a reader of the
    // view.
    const keyword = `import { Counter } from './m.shade.ts';
const c = new Counter();
const v = c.tag;
export { v };
`;
    const read = hover(f.view!, keyword, 'tag;');
    expect(read.documentation).toBe('The tag, written with the keyword.');
    expect(read.errors).toEqual([
      "Property 'tag' is private and only accessible within class 'Counter'.",
    ]);
    const named = `import { Counter } from './m.shade.ts';
const c = new Counter();
const v = c.n;
export { v };
`;
    expect(hover(f.view!, named, 'n;').errors).toEqual([
      "Property 'n' does not exist on type 'Counter'.",
    ]);
  });

  it('gives a private-name field its comment in a flat declaration and in a class below an exported base (#951)', () => {
    const f = faceOf(`"use typeshade";

class Hidden {
  /** The level of the hidden class. */
  #level: f32 = 0.;
  /** Reads the level. */
  peek(): f32 {
    return this.#level;
  }
}

export class Shown extends Hidden {
  /** Its own field. */
  #own: f32 = 1.;
  s: f32 = 0.;
}

export class Base {
  /** The base's count. */
  #count: f32 = 0.;
  /** Reads the count. */
  total(): f32 {
    return this.#count;
  }
}

export class Derived extends Base {
  /** Its own, private. */
  #mine: f32 = 0.;
}
`);
    // `Hidden` is no export, so `Shown` is declared whole, and the private field it takes carries
    // the comment of the base's `#level`. `Derived` stands below an exported base, which keeps the
    // line and the comment of `#count`, and declares its own. Each line is the private name as
    // itself (change 0109, Amendment 2).
    expect(f.view).toContain(`export declare class Shown {
  constructor();
  /** The level of the hidden class. */
  #level: f32;
  /** Its own field. */
  #own: f32;
  s: f32;
  /** Reads the level. */
  peek(): f32;
}
export declare class Base {
  constructor();
  /** The base's count. */
  #count: f32;
  /** Reads the count. */
  total(): f32;
}
export declare class Derived extends Base {
  constructor();
  /** Its own, private. */
  #mine: f32;
}
`);
  });

  it('writes the JSDoc of a static method and of a static accessor on their lines', () => {
    const f = faceOf(`"use typeshade";

export class OnePole {
  z: f32 = 0.;
  k: f32;
  constructor(k: f32) {
    this.k = k;
  }
  /** A filter that passes its input. */
  static unit(): OnePole {
    return new OnePole(1.);
  }
  /** The boiling point of water, in degrees. */
  static get boiling(): f32 {
    return 100.;
  }
  /** Sets nothing, but a static setter has a comment too. */
  static set ignored(x: f32) {
    const y = x;
  }
}
`);
    expect(f.view).toContain(`export declare class OnePole {
  constructor(k: f32);
  z: f32;
  k: f32;
  /** A filter that passes its input. */
  static unit(): OnePole;
  /** The boiling point of water, in degrees. */
  static get boiling(): f32;
  /** Sets nothing, but a static setter has a comment too. */
  static set ignored(x: f32);
}
`);
  });

  it('writes the JSDoc of a member declared never before the sentence of change 0109, in one block', () => {
    const f = faceOf(`"use typeshade";
declare const gain: uniform<f32>;

export class Probe {
  k: f32 = 1.;
  /**
   * Scales by the uniform.
   * @param x the sample
   */
  lit(x: f32): f32 {
    return x * gain;
  }
  /** The first block, which the editor does not show. */
  /** Takes a function. */
  apply(g: (x: f32) => f32): f32 {
    return g(this.k);
  }
  /** The brightness. */
  static bright(): f32 {
    return gain;
  }
  /** The getter reads the uniform. */
  get dim(): f32 {
    return gain;
  }
  /** The setter is part of the same member. */
  set dim(v: f32) {
    this.k = v;
  }
  unlit(x: f32): f32 {
    return x * gain;
  }
}

export class Lit {
  k: f32;
  /** Reads the uniform, so a host cannot build one. */
  constructor() {
    this.k = gain;
  }
}

export class Bare {
  k: f32;
  constructor() {
    this.k = gain;
  }
}
`);
    expect(f.view).toContain(`export declare class Probe {
  constructor();
  k: f32;
  /**
   * Scales by the uniform.
   * @param x the sample
   *
   * ${refused(BINDING)}
   */
  lit: never;
  /** The first block, which the editor does not show. */
  /** Takes a function.
   *
   * ${refused(TAKES_FUNCTION)}
   */
  apply: never;
  /** The brightness.
   *
   * ${refused(BINDING)}
   */
  static bright: never;
  /** The getter reads the uniform. */
  /** The setter is part of the same member.
   *
   * ${refused(BINDING)}
   */
  dim: never;
  /** ${refused(BINDING)} */
  unlit: never;
}
`);
    // A constructor a host cannot call is declared `protected`, and carries its comment the same way.
    expect(f.view).toContain(`export declare class Lit {
  /** Reads the uniform, so a host cannot build one.
   *
   * ${refused(BINDING)}
   */
  protected constructor();
  k: f32;
}
`);
    // With no comment of the author's, the sentence stands alone on one line, as change 0109 writes it.
    expect(f.view).toContain(`export declare class Bare {
  /** ${refused(BINDING)} */
  protected constructor();
  k: f32;
}
`);
  });

  it('stands a member a derived class takes from an exported base in the base, with its comment', () => {
    const f = faceOf(`"use typeshade";

/** A shape. */
export class Shape {
  x: f32 = 0.;
  /** Builds a shape at \`x\`. */
  constructor(x: f32) {
    this.x = x;
  }
  /** The area of the shape. */
  area(): f32 {
    return 0.;
  }
  /** Moves the shape along x. */
  move(dx: f32): void {
    this.x += dx;
  }
}

/** A circle. */
export class Circle extends Shape {
  r: f32 = 1.;
  /** The area of the circle, which the view takes from the base. */
  area(): f32 {
    return 3.14159 * this.r * this.r;
  }
  /** The radius, which only a circle has. */
  radius(): f32 {
    return this.r;
  }
}
`);
    // The base declares each member with its comment. The derived class declares what it adds, and
    // its constructor, which runs the base's, with the comment of that constructor. `move` and `area`
    // stand in the base: the view takes them from it, so it carries no second declaration of them.
    expect(f.view).toContain(`/** A shape. */
export declare class Shape {
  /** Builds a shape at \`x\`. */
  constructor(x: f32);
  x: f32;
  /** The area of the shape. */
  area(): f32;
  /** Moves the shape along x. */
  move(dx: f32): void;
}
/** A circle. */
export declare class Circle extends Shape {
  /** Builds a shape at \`x\`. */
  constructor(x: f32);
  r: f32;
  /** The radius, which only a circle has. */
  radius(): f32;
}
`);
    expect(f.view).not.toContain('which the view takes from the base');
  });

  it('carries the comment of an abstract member, and the concrete member below it takes that comment', () => {
    const f = faceOf(`"use typeshade";

/** A shape with an area. */
export abstract class Shape {
  x: f32 = 0.;
  /** The area, which a class below computes. */
  abstract area(): f32;
  /** Moves the shape along x. */
  move(dx: f32): void {
    this.x += dx;
  }
}

export class Square extends Shape {
  s: f32 = 1.;
  area(): f32 {
    return this.s * this.s;
  }
}
`);
    expect(f.view).toContain(`/** A shape with an area. */
export declare abstract class Shape {
  x: f32;
  /** The area, which a class below computes. */
  abstract area(): f32;
  /** Moves the shape along x. */
  move(dx: f32): void;
}
export declare class Square extends Shape {
  constructor();
  s: f32;
  /** The area, which a class below computes. */
  area(): f32;
}
`);
  });

  it('gives a flat declaration the comments of the base members it takes, its own comment first', () => {
    const files: Readonly<Record<string, string>> = {
      '/app/m.shade.ts': `"use typeshade";
import { Base } from "./lib.shade.ts";

class Hidden {
  h: f32 = 0.;
  /** Builds a hidden one. */
  constructor(h: f32) {
    this.h = h;
  }
  /** Reads the hidden field. */
  peek(): f32 {
    return this.h;
  }
  /** The note of the hidden class. */
  note(): f32 {
    return 1.;
  }
  /** The gain of the hidden class. */
  get gain(): f32 {
    return this.h * 2.;
  }
}

export class Shown extends Hidden {
  s: f32 = 0.;
  /** The note of the class that is shown. */
  note(): f32 {
    return 2.;
  }
}

export class Derived extends Base {
  /** Its own. */
  n: f32 = 0.;
  /** Its own method. */
  own(): f32 {
    return this.n;
  }
}
`,
      '/app/lib.shade.ts': `"use typeshade";

export class Base {
  /** The base's own field, from the library. */
  id: f32 = 0.;
  /** Builds the base, in the library. */
  constructor(id: f32) {
    this.id = id;
  }
  /** The base's method, from the library. */
  twice(): f32 {
    return this.id * 2.;
  }
  /** The library's constant, a static function. */
  static zero(): f32 {
    return 0.;
  }
}
`,
    };
    bothHalvesTake(files);
    const f = hostFace(files['/app/m.shade.ts']!, {
      fileName: '/app/m.shade.ts',
      runtime: RUNTIME,
      readDocument: (name) => files[name],
    });
    expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    // `Hidden` is no export, so `Shown` is declared whole: the constructor, the accessor and the
    // method it takes carry the comment of the base member, and its own `note` carries its own.
    expect(f.view).toContain(`export declare class Shown {
  /** Builds a hidden one. */
  constructor(h: f32);
  h: f32;
  s: f32;
  /** The note of the class that is shown. */
  note(): f32;
  /** Reads the hidden field. */
  peek(): f32;
  /** The gain of the hidden class. */
  get gain(): f32;
}
`);
    // A base another file declares is read in its own file, as its fields are.
    expect(f.view).toContain(`export declare class Derived {
  /** Builds the base, in the library. */
  constructor(id: f32);
  /** The base's own field, from the library. */
  id: f32;
  /** Its own. */
  n: f32;
  /** Its own method. */
  own(): f32;
  /** The base's method, from the library. */
  twice(): f32;
  /** The library's constant, a static function. */
  static zero(): f32;
}
`);
  });

  it('writes the members of a class a module re-exports with the comments of the file that declares it (Rule 3.9)', () => {
    const files: Readonly<Record<string, string>> = {
      '/app/m.shade.ts': `"use typeshade";
export { Wave } from "./lib.shade.ts";
`,
      '/app/lib.shade.ts': `"use typeshade";

/** A wave. */
export class Wave {
  a: f32 = 1.;
  /** Builds a wave. */
  constructor(a: f32) {
    this.a = a;
  }
  /** The height at \`x\`. */
  at(x: f32): f32 {
    return this.a * sin(x);
  }
  /** The period of every wave. */
  static get period(): f32 {
    return 6.28318;
  }
}
`,
    };
    bothHalvesTake(files);
    const f = hostFace(files['/app/m.shade.ts']!, {
      fileName: '/app/m.shade.ts',
      runtime: RUNTIME,
      readDocument: (name) => files[name],
    });
    expect(f.diagnostics).toEqual([]);
    expect(f.view).toContain(`/** A wave. */
export declare class Wave {
  /** Builds a wave. */
  constructor(a: f32);
  a: f32;
  /** The height at \`x\`. */
  at(x: f32): f32;
  /** The period of every wave. */
  static get period(): f32;
}
`);
  });

  it('does not carry the comment of an overload signature: the face reads the implementation', () => {
    const f = faceOf(`"use typeshade";

export class Mixer {
  k: f32 = 1.;
  /** The comment of the first signature. */
  constructor(a: f32);
  /** The comment of the second signature. */
  constructor(a: f32);
  /** Builds the mixer. */
  constructor(a: f32) {
    this.k = a;
  }
  /** The comment of the first signature. */
  mix(a: f32): f32;
  /** The comment of the second signature. */
  mix(a: f32): f32;
  /** Mixes \`a\` with the gain. */
  mix(a: f32): f32 {
    return a * this.k;
  }
  /** The comment of a signature whose implementation has none. */
  scale(a: f32): f32;
  scale(a: f32): f32 {
    return a * this.k;
  }
}
`);
    expect(f.view).toContain(`export declare class Mixer {
  /** Builds the mixer. */
  constructor(a: f32);
  k: f32;
  /** Mixes \`a\` with the gain. */
  mix(a: f32): f32;
  scale(a: f32): f32;
}
`);
    expect(f.view).not.toMatch(/first signature|second signature|whose implementation/);
  });

  it('shows the editor the comment of a constructor, a method, an accessor and a static member of a host class', () => {
    const source = `"use typeshade";
declare const gain: uniform<f32>;

/** A one-pole lowpass with its state. */
export class OnePole {
  z: f32 = 0.;
  k: f32;
  /** Builds the filter with the smoothing factor \`k\`. */
  constructor(k: f32) {
    this.k = k;
  }
  /** One sample through the filter. */
  tick(x: f32): f32 {
    this.z = this.z + this.k * (x - this.z);
    return this.z;
  }
  /** The gain of the filter. */
  get gain(): f32 {
    return this.k * 2.;
  }
  /** Sets the gain of the filter. */
  set gain(g: f32) {
    this.k = g / 2.;
  }
  /** A filter that passes its input. */
  static unit(): OnePole {
    return new OnePole(1.);
  }
  /** Scales by the uniform. */
  lit(x: f32): f32 {
    return x * gain;
  }
}
`;
    // Both halves read the same source: the compiler gives no diagnostic, the editor gives none, and
    // the view the compiler writes is what the editor's TypeScript reads for the host file.
    expect(compile(source, { fileName: 'm.shade.ts' }).diagnostics).toEqual([]);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: './runtime.ts' });
    expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const host = `import { OnePole } from './m.shade.ts';
const f = new OnePole(0.1);
const t = f.tick(1);
const g = f.gain;
f.gain = 2;
const u = OnePole.unit();
f.lit;
export { t, g, u };
`;
    const read = (at: string) => hover(f.view!, host, at);
    expect(read('tick(1').errors).toEqual([]);
    expect(read('tick(1').documentation).toBe('One sample through the filter.');
    expect(read('OnePole(0.1').documentation).toBe(
      'Builds the filter with the smoothing factor `k`.',
    );
    // The editor shows the comment of both halves of an accessor, on a read and on a write.
    expect(read('gain;').documentation).toBe(
      'The gain of the filter.\nSets the gain of the filter.',
    );
    expect(read('gain = 2').documentation).toBe(
      'The gain of the filter.\nSets the gain of the filter.',
    );
    expect(read('unit()').documentation).toBe('A filter that passes its input.');
    // A member declared `never` shows the author's words first and the sentence of change 0109 after.
    const never = read('lit;').documentation;
    expect(never.startsWith('Scales by the uniform.')).toBe(true);
    expect(never).toContain(refused(BINDING));
  });

  describe('the static builder of an abstract class (#974)', () => {
    // `new this()` under the `this` parameter of change 0020 builds the class a call names, so the
    // module has no function of that static for the abstract class: it is lowered for `Saw` and for
    // `Square`. The view declares it `never` on the abstract class, and the reason is the sentence
    // the compiler gives a call through that class (TS8035), not the one every member that was not
    // lowered gets.
    const source = `"use typeshade";

/** A source of samples. */
export abstract class Oscillator {
  protected inc: f32 = 0.;
  protected abstract wave(p: f32): f32;
  /** Builds the oscillator the call names. */
  static at<C extends Oscillator>(this: { new (): C }, f: f32, sr: f32): C {
    const o = new this();
    o.inc = f / sr;
    return o;
  }
  tick(): f32 {
    return this.wave(this.inc);
  }
}

export class Saw extends Oscillator {
  protected wave(p: f32): f32 {
    return 2. * p - 1.;
  }
}

export abstract class Mid extends Oscillator {}

export class Square extends Mid {
  protected wave(p: f32): f32 {
    return p < 0.5 ? 1. : -1.;
  }
}
`;
    const reason =
      '"Oscillator.at()" builds its value with "new this()", and "Oscillator" is abstract, so there is no instance of it to build. Call it through a class that extends it, "Saw.at()"';

    it('is declared never with that sentence as its reason, on its line of the view and in a host’s hover', () => {
      // Both halves of the shader take the program (Rule 12.7); the view is the compiler's.
      const f = faceOf(source);
      expect(f.view).toContain(`export declare abstract class Oscillator {
  protected inc: f32;
  /** Builds the oscillator the call names.
   *
   * ${refused(reason)}
   */
  static at: never;
  tick(): f32;
}
`);
      expect(f.view).not.toContain('was not lowered');
      // An abstract class below it names itself, and the class that extends that one.
      expect(f.view).toContain(`export declare abstract class Mid extends Oscillator {
  /** Builds the oscillator the call names.
   *
   * ${refused(
     '"Mid.at()" builds its value with "new this()", and "Mid" is abstract, so there is no instance of it to build. Call it through a class that extends it, "Square.at()"',
   )}
   */
  static at: never;
}
`);
      // The classes that extend it declare the static, and a host calls it through them.
      expect(f.view).toContain('  static at(f: f32, sr: f32): Saw;');
      expect(f.view).toContain('  static at(f: f32, sr: f32): Square;');
      // The editor's hover over the member in a host program shows the author's words and then the
      // reason, and the call is a type error at the host's line; the call through `Saw` is not.
      const host = `import { Oscillator, Saw } from './m.shade.ts';
const a = Oscillator.at(0.25, 1);
const b = Saw.at(0.5, 1);
export { a, b };
`;
      const read = hover(f.view!, host, 'at(0.25');
      expect(read.documentation).toBe(
        `Builds the oscillator the call names.\n\n${refused(reason)}`,
      );
      expect(read.errors).toHaveLength(1);
      expect(read.errors[0]).toMatch(
        /^This expression is not callable\.\s+Type 'never' has no call signatures\.$/,
      );
      expect(hover(f.view!, host, 'at(0.5').documentation).toBe(
        'Builds the oscillator the call names.',
      );
    });

    it('is the sentence the compiler gives a call through the abstract class, in both halves', () => {
      const called = `${source}
export function make(): f32 {
  let o = Oscillator.at(0.25, 1.);
  return o.tick();
}
`;
      const said = `${reason}.`;
      expect(
        compile(called, { fileName: 'm.shade.ts' }).diagnostics.map((d) => [d.code, d.message]),
      ).toEqual([['TS8035', said]]);
      const service = createTypeshadeLanguageService();
      service.openDocument('m.shade.ts', called);
      expect(
        service
          .getDiagnostics('m.shade.ts')
          .filter((d) => d.severity === 'error')
          .map((d) => [d.code, d.message]),
      ).toEqual([['TS8035', said]]);
      // The view of the program that has no such call says it word for word.
      expect(faceOf(source).view).toContain(said);
    });

    it('is thrown by the generated module, whose classes below the abstract one build', async () => {
      const m = await load(source);
      const Oscillator = m.Oscillator as { at(f: number, sr: number): unknown };
      expect(() => Oscillator.at(0.25, 1)).toThrow(
        new TypeError(`Oscillator.at cannot be called from host code: ${reason}`),
      );
      const Saw = m.Saw as { at(f: number, sr: number): { tick(): number } };
      expect(Saw.at(0.25, 1).tick()).toBe(-0.5);
    });
  });

  describe('the instance members of an abstract class that no exported class a host can build extends (#989)', () => {
    // A member is lowered for the classes below its class (Rule 8.9), and `Oscillator` has no class
    // below it that is not abstract, so no function of the module is its `tick`, its `step`, its
    // `scale` or its `wave`. The view declares each `never` on the class, and the reason is what a
    // host needs to know: the class is abstract, so no instance of it runs the member, and no
    // exported class a host can build extends it. It is not the reason of every member that was not
    // lowered.
    const source = `"use typeshade";

/** A source of samples. */
export abstract class Oscillator {
  protected inc: f32 = 0.;
  /** The next sample. */
  tick(): f32 {
    return this.inc;
  }
  /** The step of one sample. */
  get step(): f32 {
    return this.inc;
  }
  /** Scales a sample. */
  scale = (x: f32): f32 => x * this.inc;
  abstract wave(p: f32): f32;
  static unit(): f32 {
    return 1.;
  }
}

/** A class between the two. */
export abstract class Mid extends Oscillator {}
`;
    const reason = (shown: string, member: string): string =>
      `"${shown}" is abstract, so there is no instance of it on which "${member}" could run. No exported class that a host can build extends it. Add an exported class that extends it`;

    it('is declared never with that sentence as its reason, on each member’s line of the view and in a host’s hover', () => {
      // Both halves of the shader take the program (Rule 12.7); the view is the compiler's.
      const f = faceOf(source);
      expect(f.view).toContain(`/** A source of samples. */
export declare abstract class Oscillator {
  protected inc: f32;
  /** The next sample.
   *
   * ${refused(reason('Oscillator', 'tick'))}
   */
  tick: never;
  /** The step of one sample.
   *
   * ${refused(reason('Oscillator', 'step'))}
   */
  step: never;
  /** Scales a sample.
   *
   * ${refused(reason('Oscillator', 'scale'))}
   */
  scale: never;
  /** ${refused(reason('Oscillator', 'wave'))} */
  wave: never;
  static unit(): f32;
}
`);
      expect(f.view).not.toContain('was not lowered');
      // An abstract class below it names itself, since a host holds a value of that class too.
      expect(f.view).toContain(`/** A class between the two. */
export declare abstract class Mid extends Oscillator {
  /** The next sample.
   *
   * ${refused(reason('Mid', 'tick'))}
   */
  tick: never;
  /** The step of one sample.
   *
   * ${refused(reason('Mid', 'step'))}
   */
  step: never;
  /** Scales a sample.
   *
   * ${refused(reason('Mid', 'scale'))}
   */
  scale: never;
  /** ${refused(reason('Mid', 'wave'))} */
  wave: never;
}
`);
      // The editor's hover over each member in a host program shows the author's words and then the
      // reason, and a call of a method is a type error at the host's line.
      const host = `import type { Oscillator } from './m.shade.ts';
export function use(o: Oscillator): void {
  o.tick();
  o.step;
  o.scale(1);
  o.wave(0.5);
}
`;
      const read = (at: string) => hover(f.view!, host, at);
      expect(read('tick()').documentation).toBe(
        `The next sample.\n\n${refused(reason('Oscillator', 'tick'))}`,
      );
      expect(read('step;').documentation).toBe(
        `The step of one sample.\n\n${refused(reason('Oscillator', 'step'))}`,
      );
      expect(read('scale(1)').documentation).toBe(
        `Scales a sample.\n\n${refused(reason('Oscillator', 'scale'))}`,
      );
      expect(read('wave(0.5)').documentation).toBe(refused(reason('Oscillator', 'wave')));
      const { errors } = read('tick()');
      expect(errors).toHaveLength(3);
      for (const error of errors)
        expect(error).toMatch(
          /^This expression is not callable\.\s+Type 'never' has no call signatures\.$/,
        );
    });

    it('names the abstract class by the name a host imports', () => {
      const f = faceOf(`"use typeshade";

abstract class Form {
  w: f32 = 1.;
  area(): f32 {
    return this.w * 2.;
  }
}

export { Form as Shape };
`);
      expect(f.view).toContain(`export declare abstract class Shape {
  w: f32;
  /** ${refused(reason('Shape', 'area'))} */
  area: never;
}
`);
    });

    it('is thrown by the generated module, as for every member declared never', async () => {
      const m = await load(source);
      const Oscillator = m.Oscillator as { prototype: Record<string, unknown>; unit(): number };
      const thrown = (member: string): TypeError =>
        new TypeError(
          `Oscillator.${member} cannot be called from host code: ${reason('Oscillator', member)}`,
        );
      for (const member of ['tick', 'scale', 'wave'])
        expect(() => (Oscillator.prototype[member] as () => unknown)()).toThrow(thrown(member));
      expect(() => Oscillator.prototype.step).toThrow(thrown('step'));
      // The static works, and `new` of the class is refused as it was.
      expect(Oscillator.unit()).toBe(1);
      expect(() => new (m.Oscillator as new () => unknown)()).toThrow(
        new TypeError(
          'new Oscillator cannot be called from host code: it is abstract, so there is no instance of it to build; construct a class that extends it',
        ),
      );
    });

    it('holds when the only class below is generic and the module builds none of it', () => {
      // A generic class exists as the instances the module uses, and there is none: the view
      // declares the class `never` with its own reason, and no instance runs a member of the base.
      const f = faceOf(`"use typeshade";

export abstract class Shape {
  w: f32 = 1.;
  area(): f32 {
    return this.w;
  }
}

export class Box<T> extends Shape {}
`);
      expect(f.view).toContain(`export declare abstract class Shape {
  w: f32;
  /** ${refused(reason('Shape', 'area'))} */
  area: never;
}
`);
      expect(f.view).toContain(
        'Not callable from host code (Rule 8.20): it is generic, and its struct exists only as the instances the module uses.',
      );
    });

    it('is not the reason of a member a class below the abstract one runs', async () => {
      const abstractClass = `export abstract class Shape {
  w: f32 = 1.;
  area(): f32 {
    return this.w;
  }
  get twice(): f32 {
    return this.w * 2.;
  }
}
`;
      // A class that is exported and a class that is not: the members take the types of the
      // functions lowered for it, and the view declares them as functions of the class.
      for (const below of [
        'export class Square extends Shape {}',
        'class Square extends Shape {}',
      ]) {
        const f = faceOf(`"use typeshade";\n\n${abstractClass}\n${below}\n`);
        expect(f.view).toContain(`export declare abstract class Shape {
  w: f32;
  area(): f32;
  get twice(): f32;
}
`);
        expect(f.view).not.toContain('Add an exported class');
      }
      // The classes below carry the members, so the abstract class's own prototype has none.
      const m = await load(
        `"use typeshade";\n\n${abstractClass}\nexport class Square extends Shape {}\n`,
      );
      const Shape = m.Shape as { prototype: object };
      expect(Object.getOwnPropertyNames(Shape.prototype)).toEqual(['constructor']);
    });
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

// ═══ A private name beside a public member of its name (change 0109, Amendment 2, issue #971) ═══
//
// A class that pairs a private name with an accessor or a method of one name is the ordinary
// pairing (surface §26): `#n` is the struct member `n`, and `get n()` is the function `Counter_get_n`.
// The view declared the field `private n` and the accessor `get n`, which `tsc` reads as TS2300, and
// the generated class made the field the own property `n`, which an accessor of that name on the
// prototype answers for. The view declares a private name as itself, `#n`, and an instance holds the
// field under the key "#n" (decision D6). The program is taken by both halves of the shader
// (Rule 12.7), and the view by its two readers: `tsc` and the editor's hover.
describe('a private name beside a public member of its name (change 0109, Amendment 2, #971)', () => {
  /** The program of issue #971: a private field and the accessor of its name. */
  const COUNTER = `"use typeshade";

export class Counter {
  /** The count so far. */
  #n: u32 = 0;
  /** The count, read through the accessor. */
  get n(): u32 {
    return this.#n;
  }
  /** Counts once. */
  tick(): u32 {
    this.#n = this.#n + 1;
    return this.#n;
  }
}

export function level(c: Counter): u32 {
  return c.n;
}
`;

  /** A private field and a method of its name, and a field no private name stands beside. */
  const GAUGE = `"use typeshade";

export class Gauge {
  /** The level. */
  #level: f32 = 0.;
  /** Reads the level. */
  level(): f32 {
    return this.#level;
  }
  /** The id, which nothing changes. */
  readonly #id: u32 = 7;
  /** The scale, public. */
  scale: f32 = 1.;
  /** Sets the level. */
  set(v: f32): void {
    this.#level = v;
  }
}
`;

  /** A class no export declares as a value, which a signature names: the view spells it by its
   *  fields, and a private name is a key that is not an identifier. */
  const HIDDEN = `"use typeshade";

class Hidden {
  #x: f32 = 0.;
  y: f32 = 1.;
  get x(): f32 {
    return this.#x;
  }
}

export function peek(h: Hidden): f32 {
  return h.x;
}

export function make(): Hidden {
  return new Hidden();
}
`;

  it('is taken by both halves of the shader, the compiler and the editor (Rule 12.7)', () => {
    for (const [name, source] of Object.entries({ COUNTER, GAUGE, HIDDEN })) {
      expect([name, compile(source, { fileName: 'm.shade.ts' }).diagnostics]).toEqual([name, []]);
      const service = createTypeshadeLanguageService();
      service.openDocument('m.shade.ts', source);
      expect([name, service.getDiagnostics('m.shade.ts')]).toEqual([name, []]);
    }
  });

  it('declares the private name as itself beside the accessor of its name, with its comment', () => {
    const v = face(COUNTER).view;
    expect(v).toContain(`export declare class Counter {
  constructor();
  /** The count so far. */
  #n: u32;
  /** The count, read through the accessor. */
  get n(): u32;
  /** Counts once. */
  tick(): u32;
}
`);
    // `private n` and `get n` were one name twice.
    expect(v).not.toMatch(/\bprivate n\b/);
  });

  it('declares the private name as itself beside a method of its name, and keeps each comment on its line', () => {
    const v = face(GAUGE).view;
    expect(v).toContain(`export declare class Gauge {
  constructor();
  /** The level. */
  #level: f32;
  /** The id, which nothing changes. */
  readonly #id: u32;
  /** The scale, public. */
  scale: f32;
  /** Reads the level. */
  level(): f32;
  /** Sets the level. */
  set(v: f32): void;
}
`);
  });

  it('is type-checked by tsc: a host reads the accessor and cannot name the field', async () => {
    const head = `import { Counter, level } from './terrain.shade.ts';\nconst c = new Counter();\n`;
    // Before the change the view was TS2300, twice, and a host file did not type-check at all.
    expect(
      await hostErrors(
        COUNTER,
        `${head}export const n: number = c.n;\nexport const t: number = c.tick();\nexport const l: number = level(c);\n`,
      ),
    ).toEqual([]);
    // The field is the class's own (`#n` is TypeScript's private name), and a plain object is no
    // `Counter`: it lacks the brand the private name gives the class.
    expect(
      await hostErrors(
        COUNTER,
        `${head}export const a = c.#n;\nexport const b = level({ n: 1 });\n`,
      ),
    ).toEqual(['app.ts TS18013', 'app.ts TS2345']);
    expect(
      await hostErrors(
        GAUGE,
        `import { Gauge } from './terrain.shade.ts';\nconst g = new Gauge();\nexport const v: number = g.level() + g.scale;\ng.set(2);\n`,
      ),
    ).toEqual([]);
  });

  it('shows the accessor on hover over the read of a name the field shares, in the editor', () => {
    const f = face(COUNTER);
    const host = `import { Counter } from './m.shade.ts';
const c = new Counter();
export const v = c.n;
`;
    const read = hover(f.view, host, 'n;');
    expect(read.errors).toEqual([]);
    expect(read.documentation).toBe('The count, read through the accessor.');
  });

  it('spells a class no export declares by its fields, a private name as a quoted key', async () => {
    const f = face(HIDDEN);
    expect(f.view).toContain(
      'export declare function peek(h: { readonly "#x": f32; readonly y: f32 }): f32;',
    );
    expect(f.view).toContain('export declare function make(): { "#x": f32; y: f32 };');
    expect(
      await hostErrors(
        HIDDEN,
        `import { make, peek } from './terrain.shade.ts';\nexport const a: number = peek(make());\n`,
      ),
    ).toEqual([]);
    // An object built by hand lacks the key (a literal would be an excess property, TS2353).
    expect(
      await hostErrors(
        HIDDEN,
        `import { peek } from './terrain.shade.ts';\nconst plain = { x: 0, y: 1 };\nexport const a = peek(plain);\n`,
      ),
    ).toEqual(['app.ts TS2345']);
    // The module holds the key too: what `make()` returns is a plain object of the fields, since
    // no export makes it a class, and `peek` takes it back; one without the key is refused.
    const m = await load(HIDDEN);
    const made = (m.make as () => object)();
    expect(Object.keys(made)).toEqual(['#x', 'y']);
    expect((m.peek as (h: object) => number)(made)).toBe(0);
    expect(() => (m.peek as (h: object) => number)({ x: 0, y: 1 })).toThrow(
      new TypeError(
        'peek(): parameter "h" (Hidden): at .#x, the field is missing. "#x" is a private name, which an instance holds and a plain object does not. Build the value with new.',
      ),
    );
  });

  /** A private name in a struct that an entry reaches as a uniform and as a storage array. */
  const BINDINGS = `"use typeshade";

export class Gain {
  #g: f32 = 1.;
  get g(): f32 {
    return this.#g;
  }
  scale: f32 = 2.;
}

declare const gain: uniform<Gain>;
declare const bank: storage<array<Gain>, "read_write">;
declare const buf: storage<array<f32>, "read_write">;

export const scaled = compute([64], function scaled(gid: builtin<"global_invocation_id", vec3u>) {
  if (gid.x >= buf.length) {
    return;
  }
  buf[gid.x] = buf[gid.x] * gain.g * bank[0].scale;
});
`;

  it('names the private field by its host key in the layouts of the call layer, the WebGL2 pass program among them, and moves no byte', async () => {
    const f = face(BINDINGS);
    const entry = f.exports.find((e) => e.name === 'scaled');
    expect(entry?.kind).toBe('compute');
    if (entry?.kind !== 'compute') return;
    // The entry's bindings, which the call packs and reads back by.
    const names = (l: unknown): string[] =>
      [...JSON.stringify(l).matchAll(/\["(#?[a-z]+)",\d+,/g)].map((x) => x[1]!);
    const gain = entry.entry.bindings.find((b) => b.name === 'gain');
    expect(gain && 'layout' in gain ? names(gain.layout) : []).toEqual(['#g', 'scale']);
    // The pass program the WebGL2 tier runs packs its uniform from the same host value.
    expect('gl' in entry.entry).toBe(true);
    if (!('gl' in entry.entry)) return;
    const uniform = entry.entry.gl.uniforms.find((u) => u.name === 'gain')!;
    expect(JSON.stringify(uniform.layout)).toContain('"name":"#g"');
    // The key is the only difference from the layout the module's own structs give: offsets, sizes
    // and strides are the same.
    const own = compile(BINDINGS).module;
    const plain = buildManifest(own, {}, compile(BINDINGS).wgsl);
    const was = plain.gl?.computes?.scaled;
    expect(was && !('none' in was) ? JSON.stringify(was.uniforms[0]!.layout) : '').toBe(
      JSON.stringify(uniform.layout).replaceAll('"#g"', '"g"'),
    );
    // The call packs an instance by that layout, and refuses a plain object of the fields.
    const m = await load(BINDINGS);
    const Gain = m.Gain as new () => object;
    const layout = layoutFromPack(uniform.layout);
    const bytes = new DataView(new ArrayBuffer(16));
    packBytes(bytes, 0, layout, new Gain(), 'gain');
    expect([bytes.getFloat32(0, true), bytes.getFloat32(4, true)]).toEqual([1, 2]);
    expect(() => packBytes(bytes, 0, layout, { g: 1, scale: 2 }, 'gain')).toThrow(Misfit);
    // The manifest is built from the IR alone, with no TypeScript (Rule 11.10): it is the one the
    // module's own structs give, a private field named without its `#`.
    const program = m.default as typeof plain;
    expect(JSON.stringify(program.bindings.map((b) => b.layout))).toBe(
      JSON.stringify(plain.bindings.map((b) => b.layout)),
    );
    expect(JSON.stringify(program.bindings)).not.toContain('"#g"');
  });
});
