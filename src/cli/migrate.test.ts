// `tshc migrate` (change 0130, with change 0140): the stage calls of change 0111 rewritten to the
// stage attributes, an `export default` entry to a named one, the decorated form on a parameter or
// a field to the attribute type, and no `!` on a field or a local, keeping every byte it does not
// need to change. The rewrite is held to the compiler: each registered example, migrated, gives
// the WGSL, the GLSL ES 3.00 and the diagnostic codes the example gives as written.
// A parameter qualifier stays written before the parameter, `@inout v: f32`, and the type form of
// change 0111, `v: inout<f32>`, is rewritten back to it (Rule 8.25, change 0137).

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateSource } from './migrate.js';
import { runCli, type CliHost } from './run.js';
import { compile } from '../compiler/ts/compile.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** What a program compiles to: the WGSL, the GLSL ES 3.00 and the codes and texts of its
 *  diagnostics. */
const sig = (r: ReturnType<typeof compile>) =>
  JSON.stringify([r.wgsl, r.glsl, r.diagnostics.map((d) => [d.code, d.category, d.message])]);

describe('migrateSource', () => {
  it('rewrites each stage call to its attribute, and keeps the rest of the text', () => {
    const before = `"use typeshade";
// A comment the rewrite keeps.
class VsOut {
  pos!: builtin<"position", vec4, { invariant: true }>;
  @location(0) uv: vec2;
  c!: location<1, vec4>;
}
declare const out: storage<array<f32>, "read_write">;
function put(@out v: f32): void { v = 2.; }
export const vs = vertex(function vs(i: builtin<"vertex_index", u32>): VsOut {
  let b!: f32;
  put(b);
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(b, 0.), c: vec4(1.) };
});
export const fs = fragment((v: VsOut): location<0, vec4> => v.c * v.uv.x);
namespace N {
  export const main = compute([8, 8], function main(gid: builtin<"global_invocation_id", vec3u>): void {
    out[gid.x] = 1.;
  });
}
export const scale = workgroup_size([128], function (xs: array<f32>) {
  for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * 2.; }
});
`;
    const after = `"use typeshade";
// A comment the rewrite keeps.
class VsOut {
  pos: builtin<"position", vec4, { invariant: true }>;
  uv: location<0, vec2>;
  c: location<1, vec4>;
}
declare const out: storage<array<f32>, "read_write">;
function put(@out v: f32): void { v = 2.; }
@vertex
export function vs(i: builtin<"vertex_index", u32>): VsOut {
  let b: f32;
  put(b);
  return { pos: vec4(0., 0., 0., 1.), uv: vec2(b, 0.), c: vec4(1.) };
}
@fragment
export function fs(v: VsOut): location<0, vec4> { return v.c * v.uv.x; }
namespace N {
  @compute([8, 8])
  export function main(gid: builtin<"global_invocation_id", vec3u>): void {
    out[gid.x] = 1.;
  }
}
@workgroup_size([128])
export function scale(xs: array<f32>) {
  for (let i = 0; i < xs.length; i++) { xs[i] = xs[i] * 2.; }
}
`;
    const result = migrateSource(before);
    expect(result.text).toBe(after);
    expect(result.skipped).toEqual([]);
    // The rewrite is idempotent: a migrated file has nothing left to rewrite.
    expect(migrateSource(after)).toEqual({ text: after, changes: 0, skipped: [] });
    // Both forms compile to the same WGSL, GLSL and diagnostics, but for the decorated field's
    // warning, which the rewrite removes.
    const kept = (r: ReturnType<typeof compile>) =>
      JSON.stringify([
        r.wgsl,
        r.glsl,
        r.diagnostics.filter((d) => !(d.code === 'TS8028' && d.category === 'warning')),
      ]);
    expect(compile(after).diagnostics).toEqual([]);
    expect(kept(compile(after))).toBe(kept(compile(before)));
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

  it('names an entry, "export default" being no name (Rule 8.1)', () => {
    const before = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([8]) export default function k(gid: builtin<"global_invocation_id", vec3u>) { out[gid.x] = 1.; }
`;
    const after = before.replace('export default function', 'export function');
    expect(migrateSource(before)).toEqual({ text: after, changes: 1, skipped: [] });
    expect(migrateSource(after)).toEqual({ text: after, changes: 0, skipped: [] });
    expect(sig(compile(after))).toBe(sig(compile(before)));
  });

  it("keeps a file in the language's form as it is", () => {
    const source = `"use typeshade";
@vertex
export function vs(i: builtin<"vertex_index", u32>): builtin<"position", vec4> { return vec4(f32(i)); }
@fragment export function fs(): location<0, vec4> { return vec4(1.); }
`;
    expect(migrateSource(source)).toEqual({ text: source, changes: 0, skipped: [] });
  });

  it('names a form it leaves as written', () => {
    // A filter on a helper was named here until change 0132 made the migration delete it; a
    // decorator the rewrite does not know beside it still leaves the function as written.
    expect(
      migrateSource(`"use typeshade";
@diagnostic("off", "derivative_uniformity") @bogus
function helper(): f32 { return 1.; }
`).skipped,
    ).toEqual(['line 2: "helper" carries a decorator the rewrite does not know']);
    // A wrapped function with a name of its own: the entry would have two.
    expect(
      migrateSource(`"use typeshade";
export const fs = fragment(function other(): location<0, vec4> { return vec4(1.); });
`).skipped,
    ).toEqual([
      'line 2: the function "other" that "fs" wraps has a name of its own; an entry takes one name',
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
@fragment
export function fs(uv: location<0, vec2>): vec4 {
  if (uv.x > 0.5) { return helper(uv); }
  return vec4(0.);
}
@compute([64])
export function main(): void {}
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
      // The same WGSL, GLSL and diagnostics, but for an entry's span, which starts at its
      // attribute.
      const codes = (r: ReturnType<typeof compile>) =>
        JSON.stringify([r.wgsl, r.glsl, r.diagnostics.map((d) => [d.code, d.category, d.message])]);
      expect(codes(compile(migrated.text, options))).toBe(codes(compile(source, options)));
      // And the rewrite is idempotent.
      expect(migrateSource(migrated.text, file).changes).toBe(0);
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
  const OLD = `"use typeshade";\nexport const fs = fragment(function fs(): vec4 { return vec4(1.); });\n`;

  it('--check fails on a file with a stage call and writes nothing; migrate rewrites it', () => {
    const files: Record<string, string> = { '/p/a.shade.ts': OLD };
    const checked = host(files);
    expect(runCli(['migrate', '--check'], checked.h, { version: '0' })).toBe(1);
    expect(checked.err.join('')).toContain('a.shade.ts writes a form tshc migrate rewrites');
    expect(files['/p/a.shade.ts']).toBe(OLD);

    const done = host(files);
    expect(runCli(['migrate'], done.h, { version: '0' })).toBe(0);
    expect(files['/p/a.shade.ts']).toBe(
      `"use typeshade";\n@fragment\nexport function fs(): vec4 { return vec4(1.); }\n`,
    );
    expect(runCli(['migrate', '--check'], host(files).h, { version: '0' })).toBe(0);
  });
});
