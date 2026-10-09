// The WebGL2 pass program of change 0054 (`buildGlCompute`), as data. The program itself is run
// on WebGL2 by the GPU differential's compute arm (`scripts/gl-compute-arm.ts`), which holds what
// it leaves to the CPU model of the executor; here, what the executor reads from the program.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { buildGlCompute } from './gl-compute.js';
import { PROGRAMS } from '../testing/compute-programs.js';
import { stageOf } from '../ir/index.js';
import { dispatchCompute } from '../debug/dispatch.js';
import { runGlModel } from '../testing/gl-model.js';

describe('buildGlCompute (change 0054)', () => {
  it('gives an entry memory and uniforms only for what it and its callees name', () => {
    // Two entries of one module, each with a storage array and a uniform of its own: the host
    // binds what an entry reaches, so a root or a uniform of the other entry has no value.
    const m = compile(`"use typeshade";
declare const a: storage<array<f32>, "read_write">;
declare const b: storage<array<f32>, "read_write">;
declare const ka: uniform<f32>;
declare const kb: uniform<f32>;
let scratch: workgroup<array<f32, 64>>;
function put(i: u32) { b[i] = kb + scratch[63 - i]; }
@compute([64])
export function first(@builtin("global_invocation_id") gid: vec3u) { a[gid.x] = ka; }
@compute([64])
export function second(@builtin("local_invocation_index") i: u32) {
  scratch[i] = 1.;
  workgroupBarrier();
  put(i);
}
`).module;
    const first = buildGlCompute(m, 'first');
    expect(first.roots.map((r) => r.name)).toEqual(['a']);
    expect(first.uniforms.map((u) => u.name)).toEqual(['ka']);
    const second = buildGlCompute(m, 'second');
    expect(second.roots.map((r) => [r.name, r.space])).toEqual([
      ['b', 'storage'],
      ['scratch', 'workgroup'],
    ]);
    expect(second.uniforms.map((u) => u.name)).toEqual(['kb']);
  });

  it('lays a record out with what the host reads first, and captures it in one draw', () => {
    const p = PROGRAMS['atomicAdd with its value, in one workgroup']!;
    const g = buildGlCompute(compile(p.src).module, p.entry);
    expect([g.pcWord, g.countWord, g.requestAt, g.keysAt]).toEqual([0, 1, 2, 5]);
    expect(g.valuesAt).toBeGreaterThanOrEqual(g.keysAt + 16);
    expect(g.recordTexels).toBe(Math.ceil((g.valuesAt + 16) / 4));
    expect([g.slices, g.sliceTexels]).toEqual([1, g.recordTexels]);
    expect(g.varyings).toHaveLength(g.recordTexels);
    expect(Object.values(g.cuts)).toEqual(['atomic', 'atomic']);
    expect(Object.values(g.requests).map((r) => [r.fn, r.elem, r.result !== undefined])).toEqual([
      ['atomicAdd', 'u32', true],
      ['atomicAdd', 'u32', true],
    ]);
    expect(g.vertex).toContain('flat out uvec4 _phx_o0;');
    expect(g.vertex).toContain('void main()');
    expect(g.vertex).toContain('gl_VertexID');
  });

  it('reads memory, records and controls from 2D array textures, in the layout it is given', () => {
    const p = PROGRAMS['a write at gid.x']!;
    const m = compile(p.src).module;
    const g = buildGlCompute(m, p.entry);
    expect(g.layout).toEqual({ width: 2048, layerRows: 2048 });
    for (const t of ['_phx_mem0', '_phx_rec', '_phx_inv'])
      expect(g.vertex).toContain(`uniform usampler2DArray ${t};`);
    expect(g.vertex).toContain('% 2048u');
    const small = buildGlCompute(m, p.entry, { width: 16, layerRows: 2 });
    expect(small.layout).toEqual({ width: 16, layerRows: 2 });
    expect(small.vertex).toContain('% 2u');
  });

  it("keeps an author local apart from the pass program's own names", () => {
    // `const w` in this example was hoisted to the name of the pass loop's counter, and the
    // pass program assigned a struct to an int.
    const src = readFileSync(
      fileURLToPath(new URL('../../../examples/array-length.shade.ts', import.meta.url)),
      'utf8',
    );
    const g = buildGlCompute(compile(src).module, 'scale_all');
    expect(g.vertex).toMatch(/_phv\d+_w = Weights\(/);
    expect(g.vertex).not.toMatch(/__/);
  });

  it('wraps a uniform that is not a struct in a block, and names it', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../examples/particle-step.shade.ts', import.meta.url)),
      'utf8',
    );
    const g = buildGlCompute(compile(src).module, 'k');
    expect(g.uniforms.map((u) => [u.name, u.block])).toEqual([['delta', '_PhU_delta']]);
    expect(g.vertex).toContain('uniform _PhU_delta');
  });

  it('binds a 2D texture by its own name, with the sampler its calls pass it, through a helper and a barrier', () => {
    const m = compile(`"use typeshade";
declare const photo: texture_2d<f32>;
declare const ids: texture_2d<u32>;
declare const smp: sampler;
declare const out: storage<array<f32>, "read_write">;
let row: workgroup<array<f32, 8>>;
// A helper may take the texture; one that takes a sampler is the GLSL writer's to refuse, on
// a draw as here (GLSL ES 3.00 fuses the two into one object).
function texel(t: texture_2d<f32>, i: u32): f32 {
  return textureLoad(t, vec2i(i32(i), 0), 0).y;
}
@compute([8])
export function main(@builtin("local_invocation_index") li: u32) {
  row[li] = texel(photo, li) + f32(textureLoad(ids, vec2i(0), 0).x);
  workgroupBarrier();
  out[li] = row[(li + 1) % 8] + textureSampleLevel(photo, smp, vec2f(0.5), 0.).x;
}
`).module;
    const g = buildGlCompute(m, 'main');
    expect(g.textures).toEqual([
      { name: 'photo', sampler: 'smp', sample: 'float' },
      { name: 'ids', sampler: null, sample: 'uint' },
    ]);
    expect(g.uniforms).toEqual([]);
    expect(g.vertex).toMatch(/uniform (?:\w+ )*sampler2D photo;/);
    expect(g.vertex).toMatch(/uniform (?:\w+ )*usampler2D ids;/);
    // An entry that reads no texture carries no list.
    expect(buildGlCompute(compile(PROGRAMS['a write at gid.x']!.src).module, 'main').textures).toBe(
      undefined,
    );
  });

  it('refuses a texture sampled with two samplers, and a handle it cannot bind, naming it and why', () => {
    const twice = compile(`"use typeshade";
declare const photo: texture_2d<f32>;
declare const a: sampler;
declare const b: sampler;
declare const out: storage<array<f32>, "read_write">;
@compute([1])
export function main() {
  out[0] = textureSampleLevel(photo, a, vec2f(0.), 0.).x + textureSampleLevel(photo, b, vec2f(0.), 0.).x;
}
`).module;
    expect(() => buildGlCompute(twice, 'main')).toThrow(
      'it samples "photo" with "a" and "b", and GLSL ES 3.00 fuses a texture with one sampler',
    );
    for (const [decl, use, type, why] of [
      [
        'declare const img: texture_storage_2d<"rgba8snorm", "write">;',
        'textureStore(img, vec2i(0), vec4f(1.));',
        'texture_storage_2d<rgba8snorm, write>',
        'whose format WebGL2 cannot render to',
      ],
      [
        'declare const img: texture_1d<f32>;',
        'out[0] = textureLoad(img, 0, 0).x;',
        'texture_1d<f32>',
        'which GLSL ES 3.00 has no sampler for (Rule 10.5 defers its lowering)',
      ],
      [
        'declare const img: texture_cube_array<f32>;\ndeclare const smp: sampler;',
        'out[0] = textureSampleLevel(img, smp, vec3f(1.), 0, 0.).x;',
        'texture_cube_array<f32>',
        'which GLSL ES 3.00 has no sampler for (Rule 10.5 defers its lowering)',
      ],
      [
        'declare const img: texture_multisampled_2d<f32>;',
        'out[0] = textureLoad(img, vec2i(0), 0).x;',
        'texture_multisampled_2d<f32>',
        'which GLSL ES 3.00 has no sampler for (Rule 10.5 defers its lowering)',
      ],
    ] as const) {
      const m = compile(`"use typeshade";
${decl}
declare const out: storage<array<f32>, "read_write">;
@compute([1])
export function main() {
  ${use}
}
`);
      expect(m.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
      expect(() => buildGlCompute(m.module, 'main')).toThrow(
        `it reaches the ${type} "img", ${why}`,
      );
    }
  });

  it('binds an array, a 3D, a cube and a depth texture as the sampler GLSL ES 3.00 reads each with', () => {
    const m = compile(`"use typeshade";
declare const layers: texture_2d_array<f32>;
declare const vol: texture_3d<u32>;
declare const env: texture_cube<f32>;
declare const shadow: texture_depth_2d;
declare const cascades: texture_depth_2d_array;
declare const point: texture_depth_cube;
declare const smp: sampler;
declare const cmp: sampler_comparison;
declare const out: storage<array<f32>, "read_write">;
@compute([4])
export function main(@builtin("local_invocation_index") li: u32) {
  const a = textureLoad(layers, vec2i(i32(li), 0), 1, 0).x;
  const b = f32(textureLoad(vol, vec3i(i32(li), 0, 0), 0).x);
  const c = textureSampleLevel(env, smp, vec3f(1., 0., 0.), 0.).y;
  const d = textureSampleCompareLevel(shadow, cmp, vec2f(0.5), 0.5);
  const e = textureSampleCompareLevel(cascades, cmp, vec2f(0.5), 1, 0.5);
  const f = textureSampleCompareLevel(point, cmp, vec3f(0., 1., 0.), 0.5);
  out[li] = a + b + c + d + e + f + f32(textureDimensions(vol).z);
}
`);
    expect(m.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const g = buildGlCompute(m.module, 'main');
    expect(g.textures).toEqual([
      { name: 'layers', sampler: null, sample: 'float', dim: '2d-array' },
      { name: 'vol', sampler: null, sample: 'uint', dim: '3d' },
      { name: 'env', sampler: 'smp', sample: 'float', dim: 'cube' },
      { name: 'shadow', sampler: 'cmp', sample: 'depth' },
      { name: 'cascades', sampler: 'cmp', sample: 'depth', dim: '2d-array' },
      { name: 'point', sampler: 'cmp', sample: 'depth', dim: 'cube' },
    ]);
    for (const [name, type] of [
      ['layers', 'sampler2DArray'],
      ['vol', 'usampler3D'],
      ['env', 'samplerCube'],
      ['shadow', 'sampler2DShadow'],
      ['cascades', 'sampler2DArrayShadow'],
      ['point', 'samplerCubeShadow'],
    ])
      expect(g.vertex).toMatch(new RegExp(`uniform (?:\\w+ )*${type} ${name};`));
    // The comparison is the shadow sampler's: level 0, in a vertex stage.
    expect(g.vertex).toContain('textureLod(shadow, vec3(');
  });

  it('holds a storage texture as a memory root of four words a texel, behind its size', () => {
    const m = compile(`"use typeshade";
declare const acc: texture_storage_2d<"r32float", "read_write">;
declare const img: texture_storage_2d<"rgba8unorm", "write">;
declare const lay: texture_storage_2d_array<"rgba32uint", "write">;
declare const src: texture_storage_2d<"rgba8snorm", "read">;
@compute([4, 4])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  const at = vec2i(gid.xy);
  const seen = textureLoad(acc, at).x + textureLoad(src, at).y;
  textureStore(acc, at, vec4f(seen + f32(textureDimensions(acc).x), 0., 0., 0.));
  textureStore(img, vec2u(gid.xy), vec4f(seen, 0.5, 0.25, 1.));
  textureStore(lay, at, 1, vec4u(gid.x, gid.y, textureNumLayers(lay), u32(7)));
}
`);
    expect(m.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const g = buildGlCompute(m.module, 'main');
    // A read-only rgba8snorm texture is only read in, which WebGL2 does; it is never drawn into.
    expect(g.storageTextures).toEqual([
      { name: 'acc', format: 'r32float', access: 'read_write', texel: 'float', size: '_phx_size0' },
      { name: 'img', format: 'rgba8unorm', access: 'write', texel: 'float', size: '_phx_size1' },
      {
        name: 'lay',
        format: 'rgba32uint',
        access: 'write',
        dim: '2d-array',
        texel: 'uint',
        size: '_phx_size2',
      },
      { name: 'src', format: 'rgba8snorm', access: 'read', texel: 'float', size: '_phx_size3' },
    ]);
    for (const name of ['acc', 'img', 'lay', 'src'])
      expect(g.roots.find((r) => r.name === name)).toMatchObject({
        space: 'storage',
        fixed: 0,
        stride: 4,
      });
    expect(g.uniforms.map((u) => [u.name, u.block])).toEqual([
      ['_phx_size0', '_PhSize0'],
      ['_phx_size1', '_PhSize1'],
      ['_phx_size2', '_PhSize2'],
      ['_phx_size3', '_PhSize3'],
    ]);
    // No image load or store reaches GLSL ES 3.00; the size is the uniform's.
    expect(g.vertex).not.toMatch(/image2D|imageStore|imageLoad/);
    expect(g.vertex).toContain('_phx_size2.s.z');
    // A store is guarded to the texture, a load clamped into it.
    expect(g.vertex).toMatch(/_phx_size1\.s\.x\)\)\)/);
    expect(g.vertex).toContain('clamp(');
  });

  it('refuses a storage texture passed to a function, naming the function', () => {
    const m = compile(`"use typeshade";
declare const img: texture_storage_2d<"r32float", "write">;
function put(t: texture_storage_2d<"r32float", "write">, i: i32) {
  textureStore(t, vec2i(i, 0), vec4f(1.));
}
@compute([1])
export function main() {
  put(img, 0);
}
`);
    if (m.diagnostics.some((d) => d.category === 'error')) return; // the front end refuses it first
    expect(() => buildGlCompute(m.module, 'main')).toThrow(
      /passes the texture_storage_2d<r32float, write> "t" to the function "put"/,
    );
  });

  it('builds every compute entry of the examples, the storage texture one included', () => {
    const dir = fileURLToPath(new URL('../../../examples/', import.meta.url));
    const built: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.shade.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      if (!src.includes('@compute')) continue;
      const r = compile(src);
      if (r.diagnostics.some((d) => d.category === 'error')) continue;
      for (const e of r.module.funcs.filter((x) => stageOf(x) === 'compute')) {
        buildGlCompute(r.module, e.name);
        built.push(`${f}:${e.name}`);
      }
    }
    expect(built.length).toBeGreaterThanOrEqual(9);
    expect(built).toContain('storage-texture.shade.ts:paint');
  });
});

describe("a function the module declares under a builtin's name, in the pass program (Rule 9.5)", () => {
  // The pass program is GLSL ES 3.00, which does not let a program redeclare one of its built-in
  // functions, and the executor's own helpers (`_phLoad`, `_phStore`, `_phx_*`) are written beside
  // the author's. The GLSL writer renames the declarations, the calls through them with them, and
  // nothing the executor wrote.
  const SRC = `"use typeshade";
declare const out: storage<array<f32>, "read_write">;
let scratch: workgroup<array<f32, 4>>;
function fract(x: f32): f32 { return x - floor(x) + 0.5; }
function clamp(x: f32, lo: f32, hi: f32): f32 { return x + lo + hi; }
@compute([4])
export function main(@builtin("local_invocation_index") i: u32) {
  scratch[i] = fract(out[i]) + random(out[i]) * 0.;
  workgroupBarrier();
  out[i] = clamp(scratch[3 - i], 1., 2.);
}
`;

  it('emits each declaration under a name GLSL ES 3.00 does not have, across a barrier', () => {
    const r = compile(SRC);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const g = buildGlCompute(r.module, 'main');
    expect(g.vertex).toContain('float fract_(float x) {');
    expect(g.vertex).toContain('float clamp_(float x, float lo, float hi) {');
    expect(g.vertex).not.toMatch(/float (fract|clamp)\(/);
    expect(g.vertex).toMatch(/fract_\(uintBitsToFloat\(_phLoad\(/);
    expect(g.vertex).toMatch(/clamp_\(uintBitsToFloat\(_phLoad\(/);
    // random's expansion is the compiler's call of the builtin, and keeps its name.
    expect(g.vertex).toMatch(/[^_]fract\(\(sin\(/);
    // The executor's helpers and the pass entry keep theirs.
    expect(g.vertex).toContain('_phLoad(');
    expect(g.vertex).not.toMatch(/_ph\w*_\(/);
    expect(g.vertex).toContain('void main()');
    expect(Object.values(g.cuts)).toContain('barrier');
  });

  it("leaves the CPU model of the executor the oracle's memory, which is the declaration's", () => {
    const m = compile(SRC).module;
    const make = () => ({ out: [0.25, 1.5, 2.75, 3] });
    const oracle = make();
    dispatchCompute(m, 'main', 1, oracle, { precision: 'f32' });
    const model = make();
    runGlModel(m, 'main', 1, model);
    expect(model).toEqual(oracle);
    // fract(x) = x - floor(x) + 0.5, then clamp(x, 1, 2) = x + 3, read across the barrier.
    expect(oracle.out).toEqual([3.5, 4.25, 4, 3.75]);
  });
});
