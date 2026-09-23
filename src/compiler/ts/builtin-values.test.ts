// The extension-gated built-in values and the `"enable ..."` directive (§50, #146).
//
// WGSL puts some built-in values behind an `enable` extension: `@builtin(clip_distances)` is
// a shader-creation error without `enable clip_distances;`, measured on Tint as `use of
// '@builtin(clip_distances)' requires enabling extension 'clip_distances'`. So the directive
// is DERIVED from the use here, not declared — writing the id is the whole declaration — and
// what is pinned below is that derivation, the stage and type rules each id carries, the
// author spelling for an extension no use in the file derives, and the `requires` axis.
//
// `examples/clip-planes.shade.ts` carries the clip_distances emit through the compile gate on
// real Tint; `primitive_index` has no example, because the gate's adapter does not have that
// feature, so its emit is pinned below.
//
// Two rows of #146 are deliberately NOT here, with the measurement that closed them:
// `@builtin(global_invocation_index)` and `@builtin(workgroup_index)` are in the WGSL text
// and in NEITHER the Tint the compile gate runs (`expected builtin value name`, whose own
// "possible values" list omits both), and `@builtin(frag_depth, less)` is refused by the same
// Tint at the comma (`expected ')' for builtin attribute`). Admitting either would move the
// failure further from the author, not closer.
//
// Verifies: Rule 6.6, Rule 10.1 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { compileTsSources } from './module.js';
import { arrayT, f32T, fn, module } from '../../core/ir/index.js';
import { builtin } from '../../core/sot.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { TS_CODES } from './codes.js';
import { reflect } from '../../core/reflect.js';
import { hostFeaturesFor } from '../../core/backend.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wgslBackend } from '../../core/backends/wgsl.js';
import { emitGlslModule } from '../../core/backends/glsl.js';

function compiled(source: string) {
  const c = compile(`"use typeshade"\n${source}`);
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c;
}

function diagnose(source: string): { code?: string; message: string } {
  const r = compileTsSource(`"use typeshade"\n${source}`);
  const first = r.diagnostics[0];
  expect(first, 'expected a diagnostic, got none').toBeDefined();
  return { code: first!.code, message: first!.message };
}

const VS_CLIP = `class VsOut {
  @builtin("position") pos: vec4
  @builtin("clip_distances") cd: array<f32, 4>
}
@vertex
export function vs(@builtin("vertex_index") i: u32): VsOut {
  let o = new VsOut()
  o.pos = vec4(f32(i), 0., 0., 1.)
  o.cd[0] = 1.
  return o
}`;

const FS_PRIM = `@fragment
export function fs(@builtin("primitive_index") pi: u32): vec4 {
  return vec4(f32(pi), 0., 0., 1.)
}`;

const FS_SUBGROUP = `@fragment
export function fs(@builtin("subgroup_invocation_id") s: u32): vec4 {
  return vec4(f32(s), 0., 0., 1.)
}`;

describe('an extension-gated built-in value derives its enable, its host feature and its refusals', () => {
  it.each([
    ['clip_distances', VS_CLIP, 'clipDistances', 'enable clip_distances;', 'clip-distances'],
    ['primitive_index', FS_PRIM, 'primitiveIndex', 'enable primitive_index;', 'primitive-index'],
    ['subgroup_invocation_id', FS_SUBGROUP, 'subgroups', 'enable subgroups;', 'subgroups'],
  ])(
    'derives the enable, the host feature, and refuses the wrong stage or type: %s',
    (_name, source, cap, directive, hostFeature) => {
      const c = compiled(source);
      expect(c.wgsl).toContain(directive);
      // Ahead of the declarations, which is the slot WGSL fixes for a directive.
      expect(c.wgsl!.indexOf(directive)).toBeLessThan(c.wgsl!.indexOf('fn '));
      const r = reflect(c.module);
      expect(r.requiredFeatures).toContain(cap);
      expect(hostFeaturesFor(wgslBackend, r.requiredFeatures)).toContain(hostFeature);
      // GLSL ES 3.00 has no row for any of the three, so the module fails CLOSED there
      // rather than emitting a varying the driver would silently reinterpret.
      expect(() => emitGlslModule(c.module, 'fragment')).toThrow(new RegExp(cap));
    },
  );

  it.each([
    [
      'clip_distances on a fragment input',
      `class FsIn { @builtin("position") p: vec4; @builtin("clip_distances") cd: array<f32, 4> }
@fragment export function fs(v: FsIn): vec4 { return vec4(v.cd[0]) }`,
      TS_CODES.BUILTIN_STAGE,
      'is not a valid fragment input; it is a vertex output',
    ],
    [
      'primitive_index on a vertex input',
      `@vertex export function vs(@builtin("primitive_index") pi: u32): vec4 { return vec4(f32(pi)) }`,
      TS_CODES.BUILTIN_STAGE,
      'is not a valid vertex input; it is a fragment input',
    ],
  ])('refuses %s', (_what, source, code, text) => {
    const d = diagnose(source);
    expect(d.code).toBe(code);
    expect(d.message).toContain(text);
  });

  it('clip_distances refuses N > 8', () => {
    const d = diagnose(
      `class VsOut { @builtin("position") p: vec4; @builtin("clip_distances") cd: array<f32, 9> }
@vertex export function vs(): VsOut { let o = new VsOut(); o.p = vec4(0.); return o }`,
    );
    expect(d.code).toBe(TS_CODES.TYPE_MISMATCH);
    expect(d.message).toBe(
      'Builtin "clip_distances" is "array<f32,9>"; WGSL gives it array<f32, N> with N from 1 to 8.',
    );
  });

  it('clip_distances refuses a type that is not an f32 array', () => {
    const d = diagnose(
      `class VsOut { @builtin("position") p: vec4; @builtin("clip_distances") cd: vec4 }
@vertex export function vs(): VsOut { let o = new VsOut(); o.p = vec4(0.); return o }`,
    );
    expect(d.code).toBe(TS_CODES.TYPE_MISMATCH);
    expect(d.message).toContain('is "vec4<f32>"');
  });

  it('accepts the subgroup pair on a fragment entry, not compute alone', () => {
    // WGSL's built-in value table gives both ids a fragment row; the front end had compute
    // only, which refused a legal program.
    expect(compiled(FS_SUBGROUP).wgsl).toContain('@builtin(subgroup_invocation_id)');
  });
});

describe('surface §50 names only the extension no use can derive', () => {
  // §50 called subgroups one of "the two extensions no use can derive", while its own table
  // (and the compiler) derive `enable subgroups;` from `@builtin("subgroup_invocation_id")`.
  const SURFACE = fileURLToPath(new URL('../../../docs/use-typeshade-surface.md', import.meta.url));
  const text = readFileSync(SURFACE, 'utf8');
  const s50 = text.slice(text.indexOf('\n## 50.'), text.indexOf('\n## 51.'));

  it('names one underivable extension, and no row of its table derives it', () => {
    const named = /`(\w+)` is\s+the\s+one\s+no\s+use\s+can\s+derive/.exec(s50);
    expect(named, '§50 names the extension no use can derive').not.toBeNull();
    const derived = [...s50.matchAll(/· `enable (\w+);` ·/g)].map((m) => m[1]);
    expect(derived).toContain('subgroups');
    expect(derived).not.toContain(named![1]);
    expect(s50).not.toMatch(/two\s+extensions\s+no\s+use\s+can\s+derive/);
  });

  it('derives the subgroups enable from a subgroup built-in, as the table says', () => {
    expect(compiled(FS_SUBGROUP).wgsl).toContain('enable subgroups;');
  });
});

describe('the "enable ..." file directive', () => {
  it('turns on an extension no use in the file derives, and emits the WGSL directive', () => {
    const c = compiled(`"enable subgroups"
@fragment export function fs(): vec4 { return vec4(0.) }`);
    expect(c.wgsl).toContain('enable subgroups;');
    expect(reflect(c.module).requiredFeatures).toContain('subgroups');
  });

  it('is not reported as a stray top-level expression', () => {
    const r = compileTsSource(`"use typeshade"\n"enable f16"\n@fragment
export function fs(): vec4 { return vec4(0.) }`);
    expect(r.diagnostics.filter((d) => d.code === TS_CODES.TOP_LEVEL)).toEqual([]);
  });

  it('names the vocabulary when the extension is misspelled, and enables nothing', () => {
    const r = compileTsSource(`"use typeshade"\n"enable subgrops"\n@fragment
export function fs(): vec4 { return vec4(0.) }`);
    const d = r.diagnostics.find((x) => x.code === TS_CODES.ENABLE_NAME);
    expect(d?.message).toBe(
      'Unknown WGSL extension "subgrops". "enable ..." takes one of: ' +
        'clip_distances, dual_source_blending, f16, primitive_index, subgroups.',
    );
    expect(r.enables).toEqual([]);
  });

  it('emits no directive for a file that needs none', () => {
    // Pinned whole, not probed for an absent prefix: the preamble reads `requiredCaps(m)`
    // now rather than `m.enables`, and a derived resource cap acquiring a directive row
    // would put a line here that no author asked for. The only way to see that is to hold
    // the entire text.
    const plain = compiled(`@fragment export function fs(): vec4 { return vec4(0.) }`);
    expect(plain.wgsl).toBe(
      '@fragment\nfn fs() -> @location(0) vec4<f32> {\n' +
        '  return vec4<f32>(0.0, 0.0, 0.0, 0.0);\n}\n',
    );
  });
});

describe('a multi-file program keeps the directives it derives', () => {
  it('emits the enable header for a program whose only notable feature is the builtin', () => {
    // The multi-file path took a bare `emitFuncs` fallback when it had no const, struct,
    // binding, override or declared enable to carry — and `emitFuncs` writes no preamble and
    // runs neither `assertCaps` nor `assertBuiltins`. A two-file program using
    // `@builtin(primitive_index)` therefore emitted with zero diagnostics and no `enable`
    // line, which Tint refuses (`use of '@builtin(primitive_index)' requires enabling
    // extension 'primitive_index'`). What a module REQUIRES, not what it declares, decides.
    const r = compileTsSources([
      {
        fileName: 'a.ts',
        source: `"use typeshade"\nimport { tint } from "./b"\n@fragment
export function fs(@builtin("primitive_index") pi: u32): vec4 { return tint(f32(pi)) }`,
      },
      {
        fileName: 'b.ts',
        source: `"use typeshade"\nexport function tint(x: f32): vec4 { return vec4(x, 0., 0., 1.) }`,
      },
    ]);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('enable primitive_index;');
  });

  it('merges the "enable ..." directives of every file and reports them', () => {
    const r = compileTsSources([
      {
        fileName: 'a.ts',
        source: `"use typeshade"\n"enable subgroups"\nimport { tint } from "./b"\n@fragment
export function fs(): vec4 { return tint(1.) }`,
      },
      {
        fileName: 'b.ts',
        source: `"use typeshade"\n"enable subgroups"\n"enable f16"
export function tint(x: f32): vec4 { return vec4(x, 0., 0., 1.) }`,
      },
    ]);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    // One module, so one set: two files naming `subgroups` is one enable, not a duplicate.
    expect([...r.enables].sort()).toEqual(['f16', 'subgroups']);
    expect(r.wgsl).toContain('enable f16;');
    expect(r.wgsl).toContain('enable subgroups;');
  });
});

describe('the clip_distances type rule holds on every authoring surface', () => {
  it('refuses a struct that only declares the builtin and is never entry IO', () => {
    // The capability is derived from `m.structs` whatever the struct is used for, so a
    // declaration alone emitted `enable clip_distances;` over an `array<f32, 9>`. The front
    // end checked the two sites an entry reaches; this one it did not.
    const d = diagnose(
      `class Unused { @builtin("position") p: vec4; @builtin("clip_distances") cd: f32 }
@fragment export function fs(): vec4 { return vec4(0.) }`,
    );
    expect(d.code).toBe(TS_CODES.TYPE_MISMATCH);
    expect(d.message).toContain('WGSL gives it array<f32, N> with N from 1 to 8');
  });

  it('refuses the EDSL retAttr-authored return the front end never produces', () => {
    // `fn(..., { retAttr: builtin('clip_distances', arrayT(f32T, 9)) })` keeps the id as
    // `retBuiltin`, which `requiredCaps` reads — so the directive was derived from a return
    // type nothing validated. The rule lives in the shared lint pass for exactly that reason.
    const vs = fn('vs', {}, arrayT(f32T, 9), () => 0 as never, {
      stage: 'vertex',
      retAttr: builtin('clip_distances', arrayT(f32T, 9)) as never,
    });
    expect(() => emitModule(module({ funcs: [vs] }))).toThrow(/array<f32, N> with N from 1 to 8/);
  });
});

describe('the requires axis: WGSL language features', () => {
  const RW = `declare const acc: texture_storage_2d<"r32float", "read_write">
@compute
export function cs(@builtin("global_invocation_id") g: vec3u): void {
  const p = vec2i(i32(g.x), i32(g.y))
  textureStore(acc, p, vec4(textureLoad(acc, p).x + 1.))
}`;

  it('lists required language features and emits the requires directive', () => {
    const c = compiled(RW);
    expect(reflect(c.module).requiredLanguageFeatures).toEqual([
      'readonly_and_readwrite_storage_textures',
    ]);
    expect(c.wgsl).toContain('requires readonly_and_readwrite_storage_textures;');
  });

  it('reports none for a write-only storage texture', () => {
    const c = compiled(`declare const dst: texture_storage_2d<"rgba8unorm", "write">
@compute
export function cs(@builtin("global_invocation_id") g: vec3u): void {
  textureStore(dst, vec2i(i32(g.x), i32(g.y)), vec4(1.))
}`);
    expect(reflect(c.module).requiredLanguageFeatures).toEqual([]);
    expect(c.wgsl).not.toContain('requires ');
  });
});
