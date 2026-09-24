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
function hostErrors(source: string, host: string): string[] {
  const f = face(source, 'terrain');
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-view-'));
  dirs.push(dir);
  // The source beside its view, so the check proves the view wins over it.
  writeFileSync(join(dir, 'terrain.shade.ts'), source);
  writeFileSync(join(dir, 'terrain.shade.typeshade.ts'), f.view);
  writeFileSync(join(dir, 'app.ts'), host);
  const program = ts.createProgram([join(dir, 'app.ts')], {
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
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => `${d.file ? d.file.fileName.slice(dir.length + 1) : ''} TS${d.code}`);
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

@fragment
export function fs(): vec4 { return vec4(helper(1.), 0., 0., 1.); }
`);
    const k = kinds(f.exports);
    expect(k.helper).toBe('function');
    expect(k.usesIdent).toBe('function');
    expect(k.ident).toMatch(/^it is generic/);
    expect(k.apply).toMatch(/^it takes a function/);
    expect(k.readsBinding).toMatch(/^it reaches a resource binding/);
    expect(k.reachesBinding).toMatch(/^it reaches a resource binding/);
    expect(k.derivative).toMatch(/^it reaches dpdx, which only a GPU computes/);
    expect(k.sampled).toMatch(/resource binding|only a GPU computes/);
    expect(k.fromTile).toMatch(/^it reaches a workgroup variable/);
    expect(k.fs).toMatch(/^it is a fragment entry, drawn into a canvas/);
    // Each refusal names the work that adds it, or says none does yet.
    for (const e of f.exports)
      if (e.kind === 'never')
        expect(e.reason).toMatch(/roadmap item 1[56] adds it|no proposal|Rule 8\.24|change 0016/);
  });

  it('refuses a parameter or a result with no host value, naming the type', () => {
    const f = face(`"use typeshade";
export function tex(t: texture_2d<f32>, uv: vec2i): vec4 { return textureLoad(t, uv, 0); }
`);
    expect(kinds(f.exports).tex).toMatch(/^parameter "t": a texture_2d<f32> has no host value/);
  });

  it('carries a constant and an enum as values, and a struct as a type', () => {
    const f = face(`"use typeshade";
export const K: f32 = 2.;
export enum Mode { A, B = 4 }
export class P { x: f32 = 0.; v: vec2 = vec2(0., 0.); }
export function mk(a: f32): P { const p = new P(); p.x = a; return p; }
`);
    expect(kinds(f.exports)).toEqual({ K: 'const', Mode: 'enum', P: 'struct', mk: 'function' });
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
  it('declares every row of the host value table', () => {
    const f = face(`"use typeshade";
export class S { a: f32 = 0.; v: vec2 = vec2(0., 0.); }
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
    expect(f.view).toContain('export interface S { a: number; v: [number, number] }');
    expect(f.view).toContain(
      'export declare function record(s: { readonly a: number; readonly v: readonly [number, number] }): S;',
    );
    expect(f.view).toContain('export declare function nothing(x: number): void;');
  });

  it('declares an export with no host face never, with the reason', () => {
    const f = face(`"use typeshade";
@fragment
export function fs(): vec4 { return vec4(1.); }
`);
    expect(f.view).toContain(
      '/** Not callable from host code (Rule 8.20): it is a fragment entry, drawn into a canvas through the import by the second part of change 0016. */\nexport declare const fs: never;',
    );
  });

  it('type-checks a host program with plain tsc, the view winning over the source', () => {
    expect(
      hostErrors(
        TERRAIN,
        `import { height } from './terrain.shade.ts';\nconst h: number = height([0.5, 0.5], [1, 0.5, 2, 0.25]);\nexport { h };\n`,
      ),
    ).toEqual([]);
  });

  it('catches a wrong host call at the host line', () => {
    expect(
      hostErrors(
        TERRAIN,
        `import { height } from './terrain.shade.ts';\nexport const h = height([0.5], [1, 0.5, 2, 0.25]);\n`,
      ),
    ).toEqual(['app.ts TS2345']);
  });

  it('makes a call of an export with no host face a type error', () => {
    const src = `"use typeshade";
@fragment
export function fs(): vec4 { return vec4(1.); }
`;
    expect(
      hostErrors(src, `import { fs } from './terrain.shade.ts';\nexport const c = fs();\n`),
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
@fragment
export function fs(): vec4 { return vec4(1.); }
`);
    expect(() => (m.fs as () => unknown)()).toThrow(
      'fs cannot be called from host code: it is a fragment entry',
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
`;
  const CASES: Record<string, unknown[][]> = {
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
@fragment
export function fs(): vec4 { return vec4(dpdx(1.)); }
`);
    expect(f.code).toContain('"helper": function');
    expect(f.code).not.toContain('"fs": function');
  });
});
