// `tshc migrate` (change 0111, milestone 2, amendment 2): the decorated form rewritten to the
// stage calls and attribute types, keeping every byte it does not need to change. The rewrite
// is held to the compiler: each registered example, migrated, gives the WGSL, the GLSL ES 3.00
// and the diagnostic codes the decorated example gives. A parameter qualifier stays written before
// the parameter, `@inout v: f32`, and the type form of change 0111, `v: inout<f32>`, is rewritten
// back to it (Rule 8.25, change 0137).

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateSource } from './migrate.js';
import { runCli, type CliHost } from './run.js';
import { compile } from '../compiler/ts/compile.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('migrateSource', () => {
  it('rewrites each decorated form, and keeps the rest of the text', () => {
    const before = `"use typeshade";
// A comment the rewrite keeps.
class VsOut {
  @builtin("position") @invariant pos: vec4;
  @location(0) uv: vec2;
  @location(1) @interpolate("flat") id: u32;
}
class Light {
  dir: vec3;
  power = 1.;
}
function put(@out v: f32): void { v = 2.; }
@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.), id: i };
}
@fragment
@diagnostic("off", "derivative_uniformity")
export function fs(v: VsOut): vec4 {
  let b: f32;
  put(b);
  return vec4(v.uv, b, 1.);
}
@compute([8, 8])
export function main(@builtin("global_invocation_id") gid: vec3u): void {}
`;
    const after = `"use typeshade";
// A comment the rewrite keeps.
interface VsOut {
  pos: builtin<"position", vec4, { invariant: true }>;
  uv: location<0, vec2>;
  id: location<1, u32, { interpolate: "flat" }>;
}
class Light {
  dir!: vec3;
  power = 1.;
}
function put(@out v: f32): void { v = 2.; }
export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.), id: i };
});
export const fs = fragment(function fs(v: VsOut): vec4 {
  let b!: f32;
  put(b);
  return vec4(v.uv, b, 1.);
});
export const main = compute([8, 8], function main(gid: builtin<"global_invocation_id", vec3u>): void {});
`;
    const result = migrateSource(before);
    expect(result.text).toBe(after);
    expect(result.skipped).toEqual([]);
    // The rewrite is idempotent: a migrated file has nothing left to rewrite.
    expect(migrateSource(after)).toEqual({ text: after, changes: 0, skipped: [] });
  });

  it('keeps a qualifier before the parameter, and rewrites the type form to it (change 0137)', () => {
    const kept = `"use typeshade";
function swap(@inout a: f32, @inout b: f32): void { const t = a; a = b; b = t; }
function add(a: f32, b: f32, @out c: f32): void { c = a + b; }
`;
    expect(migrateSource(kept)).toEqual({ text: kept, changes: 0, skipped: [] });
    const typed = `"use typeshade";
function swap(a: inout<f32>, b: inout<f32>): void { const t = a; a = b; b = t; }
namespace N { export function grow(xs: inout<array<f32, 3>>, c: out<vec2>): void { c = vec2(xs[0]); } }
function both(@inout a: inout<f32>): void { a = 1.; }
`;
    const result = migrateSource(typed);
    expect(result.text).toBe(`"use typeshade";
function swap(@inout a: f32, @inout b: f32): void { const t = a; a = b; b = t; }
namespace N { export function grow(@inout xs: array<f32, 3>, @out c: vec2): void { c = vec2(xs[0]); } }
function both(@inout a: f32): void { a = 1.; }
`);
    expect(result.skipped).toEqual([]);
    expect(compile(result.text).diagnostics).toEqual([]);
    expect(migrateSource(result.text).changes).toBe(0);
  });

  it('leaves a type form that is no parameter of a module function, and names it', () => {
    const result = migrateSource(`"use typeshade";
type R = inout<f32>;
class C { m(p: inout<f32>): void {} }
export function f(): f32 { let x: out<f32> = 1.; return x; }
`);
    expect(result.changes).toBe(0);
    expect(result.skipped).toEqual([
      'line 2: "inout<f32>" is no parameter\'s type of a module function: write the qualifier before the parameter by hand, "@inout a: T"',
      'line 3: "inout<f32>" is no parameter\'s type of a module function: write the qualifier before the parameter by hand, "@inout a: T"',
      'line 4: "out<f32>" is no parameter\'s type of a module function: write the qualifier before the parameter by hand, "@out a: T"',
    ]);
  });

  it('keeps a class something builds with new, with "!" on its fields', () => {
    const result = migrateSource(`"use typeshade";
class P { @location(0) uv: vec2; }
export function f(): P { return new P(); }
`);
    expect(result.text).toContain('class P { uv!: location<0, vec2>; }');
  });

  it('keeps a class nothing names, so its struct is still emitted and checked', () => {
    // The compiler emits a class as a struct whether or not an entry uses it, and an interface
    // only when something names it. An unused decorated class rewritten as an interface lost
    // its struct and the checks on it (#921): here, the clip_distances type rule.
    const source = `"use typeshade";
class Unused { @builtin("position") p: vec4; @location(0) uv: vec2; }
export const fs = fragment(function fs(): vec4 { return vec4(0.); });
`;
    const result = migrateSource(source);
    expect(result.text).toContain(
      'class Unused { p!: builtin<"position", vec4>; uv!: location<0, vec2>; }',
    );
    // The decorated source's TS8028 warnings, one per decorator, are what the rewrite removes.
    const kept = (r: ReturnType<typeof compile>) =>
      r.diagnostics
        .filter((d) => !(d.code === 'TS8028' && d.category === 'warning'))
        .map((d) => [d.code, d.message]);
    const sig = (r: ReturnType<typeof compile>) => JSON.stringify([r.wgsl, r.glsl, kept(r)]);
    expect(compile(result.text).diagnostics).toEqual([]);
    expect(compile(result.text).wgsl).toContain('struct Unused');
    expect(sig(compile(result.text))).toBe(sig(compile(source)));
    const refused = `"use typeshade";
class Unused { @builtin("position") p: vec4; @builtin("clip_distances") cd: f32; }
export const fs = fragment(function fs(): vec4 { return vec4(0.); });
`;
    const codes = (text: string) => kept(compile(text));
    expect(codes(migrateSource(refused).text)).toEqual(codes(refused));
    expect(codes(refused).some(([code]) => code === 'TS8003')).toBe(true);
  });

  it('gives the fields of a mixin\'s class expression "!"', () => {
    const result = migrateSource(`"use typeshade";
function Tinted<T extends new (...a: any[]) => object>(Base: T) {
  return class extends Base { tint: vec3; };
}
`);
    expect(result.text).toContain('return class extends Base { tint!: vec3; };');
  });

  it('names a form it leaves as written', () => {
    // A filter on a helper was named here until change 0132 made the migration delete it; a
    // decorator the rewrite does not know beside it still leaves the function as written.
    const result = migrateSource(`"use typeshade";
@diagnostic("off", "derivative_uniformity") @bogus
function helper(): f32 { return 1.; }
`);
    expect(result.skipped).toEqual([
      'line 2: "helper" carries a decorator the rewrite does not know',
    ]);
  });

  it('deletes the diagnostic filter wherever it is written (change 0132, item 7)', () => {
    const before = `"use typeshade";
declare const t: texture_2d<f32>;
declare const s: sampler;
@diagnostic("off", "derivative_uniformity")
function helper(uv: vec2): vec4 { return textureSample(t, s, uv); }
export const fs = fragment(function fs(uv: location<0, vec2>): vec4 {
  if (uv.x > 0.5) { return helper(uv); }
  return vec4(0.);
}, { diagnostic: ["off", "derivative_uniformity"] });
export const main = compute(
  [64],
  function main(): void {},
  { diagnostic: ["off", "derivative_uniformity"] },
);
`;
    const after = `"use typeshade";
declare const t: texture_2d<f32>;
declare const s: sampler;
function helper(uv: vec2): vec4 { return textureSample(t, s, uv); }
export const fs = fragment(function fs(uv: location<0, vec2>): vec4 {
  if (uv.x > 0.5) { return helper(uv); }
  return vec4(0.);
});
export const main = compute(
  [64],
  function main(): void {});
`;
    const result = migrateSource(before);
    expect(result).toEqual({ text: after, changes: 3, skipped: [] });
    expect(migrateSource(after)).toEqual({ text: after, changes: 0, skipped: [] });
    // The source the migration leaves compiles: the sample under the branch is rewritten.
    expect(compile(before).diagnostics.map((d) => d.code)).toEqual(['TS8028', 'TS8028', 'TS8028']);
    expect(compile(after).diagnostics).toEqual([]);
    expect(compile(after).wgsl).toContain('textureSampleGrad(');
  });

  it('leaves a stage call whose options hold more than the filter, and names it', () => {
    const source = `"use typeshade";
export const fs = fragment(function fs(): vec4 { return vec4(0.); }, { diagnostic: ["off", "derivative_uniformity"], bogus: 1 });
`;
    expect(migrateSource(source)).toEqual({
      text: source,
      changes: 0,
      skipped: ['line 2: the options of "fragment" hold more than the diagnostic filter'],
    });
  });
});

describe('every registered example, migrated, compiles as it did', () => {
  const dir = join(ROOT, 'examples');
  const files = readdirSync(dir).filter((f) => f.endsWith('.shade.ts'));
  const readDocument = (uri: string): string | undefined => {
    try {
      return readFileSync(new URL(uri), 'utf8');
    } catch {
      return undefined;
    }
  };
  for (const file of files) {
    it(file, () => {
      const path = join(dir, file);
      const source = readFileSync(path, 'utf8');
      const migrated = migrateSource(source, file);
      expect(migrated.skipped).toEqual([]);
      const options = { fileName: pathToFileURL(path).href, readDocument };
      const sig = (r: ReturnType<typeof compile>) =>
        JSON.stringify([r.wgsl, r.glsl, r.diagnostics.map((d) => d.code)]);
      expect(sig(compile(migrated.text, options))).toBe(sig(compile(source, options)));
    });
  }
});

describe('tshc migrate', () => {
  const host = (files: Record<string, string>) => {
    const out: string[] = [];
    const err: string[] = [];
    const h: CliHost = {
      cwd: '/p',
      readFile: (path) => files[path],
      writeFile: (path, text) => void (files[path] = text),
      kind: (path) =>
        files[path] !== undefined
          ? 'file'
          : Object.keys(files).some((f) => f.startsWith(`${path}/`))
            ? 'directory'
            : undefined,
      list: (path) => [
        ...new Set(
          Object.keys(files)
            .filter((f) => f.startsWith(`${path}/`))
            .map((f) => f.slice(path.length + 1).split('/')[0]!),
        ),
      ],
      stdout: (text) => void out.push(text),
      stderr: (text) => void err.push(text),
    };
    return { h, out, err };
  };
  const OLD = `"use typeshade";\n@fragment\nexport function fs(): vec4 { return vec4(1.); }\n`;

  it('--check fails on a decorated file and writes nothing; migrate rewrites it', () => {
    const files: Record<string, string> = { '/p/a.shade.ts': OLD };
    const checked = host(files);
    expect(runCli(['migrate', '--check'], checked.h, { version: '0' })).toBe(1);
    expect(checked.err.join('')).toContain('a.shade.ts is in the decorated form');
    expect(files['/p/a.shade.ts']).toBe(OLD);

    const done = host(files);
    expect(runCli(['migrate'], done.h, { version: '0' })).toBe(0);
    expect(files['/p/a.shade.ts']).toContain('export const fs = fragment(function fs()');
    expect(runCli(['migrate', '--check'], host(files).h, { version: '0' })).toBe(0);
  });
});
