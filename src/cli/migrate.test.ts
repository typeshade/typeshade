// `tshc migrate` (change 0111, milestone 2, amendment 2): the decorated form rewritten to the
// stage calls and attribute types, keeping every byte it does not need to change. The rewrite
// is held to the compiler: each registered example, migrated, gives the WGSL, the GLSL ES 3.00
// and the diagnostic codes the decorated example gives.

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
function put(v: out<f32>): void { v = 2.; }
export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): VsOut {
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(0., 0.), id: i };
});
export const fs = fragment(function fs(v: VsOut): vec4 {
  let b!: f32;
  put(b);
  return vec4(v.uv, b, 1.);
}, { diagnostic: ["off", "derivative_uniformity"] });
export const main = compute([8, 8], function main(gid: builtin<"global_invocation_id", vec3u>): void {});
`;
    const result = migrateSource(before);
    expect(result.text).toBe(after);
    expect(result.skipped).toEqual([]);
    // The rewrite is idempotent: a migrated file has nothing left to rewrite.
    expect(migrateSource(after)).toEqual({ text: after, changes: 0, skipped: [] });
  });

  it('keeps a class something builds with new, with "!" on its fields', () => {
    const result = migrateSource(`"use typeshade";
class P { @location(0) uv: vec2; }
export function f(): P { return new P(); }
`);
    expect(result.text).toContain('class P { uv!: location<0, vec2>; }');
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
    const result = migrateSource(`"use typeshade";
@diagnostic("off", "derivative_uniformity")
function helper(): f32 { return 1.; }
`);
    expect(result.skipped).toEqual(['line 2: @diagnostic on "helper", which is no entry']);
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
