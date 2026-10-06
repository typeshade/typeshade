// Which sampler a texture is read with, and so the `sampleType` a layout takes for it (change
// 0028, Rule 11.10). WebGPU refuses a texture laid out 'unfilterable-float' that any call
// pairs with a `filtering` sampler, and every `sampler` binding is laid out that way, so a texture
// a call samples must be 'float' whichever way the call is written: a `textureSample*` or a
// `textureGather`, through a helper's parameters, through a `const`. Each of those was measured on
// Dawn (Chromium 153, SwiftShader) to be refused; the journey `journeys/textures` holds them on a
// real device, and this file holds the analysis that decides them, on the IR.
//
// Verifies: Rule 11.10.

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { buildManifest } from '../manifest.js';
import type { ModuleDecl } from '../ir/nodes.js';
import { stageOf } from '../ir/nodes.js';
import { f32T, vec4fT } from '../ir/types.js';
import { reflect } from '../reflect.js';
import { reachFrom } from './stage-bindings.js';
import { sampledTextures, texturePairs } from './texture-pairs.js';

const PRELUDE = `"use typeshade";
class Color { @location(0) c: vec4; }
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(f32(vi), 0., 0., 1.);
}
declare const photo: texture_2d<f32>;
declare const other: texture_2d<f32>;
declare const smp: sampler;
`;

/** A fragment entry `fs` with `body`, and whatever else the module declares before it. */
const program = (body: string, before = ''): string => `${PRELUDE}${before}
@fragment
export function fs(@builtin("position") p: vec4): Color {
${body}
}
`;

const moduleOf = (src: string): ModuleDecl => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module!;
};

/** Every texture binding's `sampleType`, by name. */
const sampleTypes = (m: ModuleDecl): Record<string, string | undefined> =>
  Object.fromEntries(
    reflect(m)
      .bindGroups.flatMap((g) => g.entries)
      .filter((e) => e.resourceKind === 'texture')
      .map((e) => [e.name, e.sampleType]),
  );

/** The sampler bindings each texture is paired with, over what the entries reach. */
const pairsOf = (m: ModuleDecl): Record<string, string[]> => {
  const byName = new Map(m.funcs.map((f) => [f.name, f]));
  const entries = m.funcs.filter((f) => stageOf(f) !== undefined);
  const pairs = texturePairs(
    reachFrom(m, entries).fns,
    byName,
    new Set(byName.keys()),
    new Set(m.bindings.map((b) => b.name)),
  );
  return Object.fromEntries([...pairs].map(([t, s]) => [t, [...s].sort()]));
};

const FLOAT = 'float';
const UNFILTERABLE = 'unfilterable-float';

describe('a texture only loaded, measured or counted is laid out unfilterable-float', () => {
  it('loads, sizes and layer counts pair nothing, whatever sampler sits beside the texture', () => {
    const m = moduleOf(`${PRELUDE}
declare const layers: texture_2d_array<f32>;
@fragment
export function fs(@builtin("position") p: vec4): Color {
  const texel = textureLoad(photo, vec2i(p.xy), 0);
  const size = textureDimensions(photo);
  const count = f32(textureNumLayers(layers));
  return { c: texel * count + f32(size.x) };
}
`);
    expect(pairsOf(m)).toEqual({});
    // `smp` is declared and unused, which WebGPU allows beside an unfilterable texture.
    expect(sampleTypes(m)).toEqual({
      photo: UNFILTERABLE,
      other: UNFILTERABLE,
      layers: UNFILTERABLE,
    });
  });

  it('a texture no entry reaches, and one no function reads, is laid out the same way', () => {
    const m = moduleOf(program(`  return { c: vec4(0.) };`));
    expect(sampleTypes(m)).toEqual({ photo: UNFILTERABLE, other: UNFILTERABLE });
  });

  it('a multisampled f32 texture is, which no sampler reads (#414)', () => {
    const m = moduleOf(`${PRELUDE}
declare const msaa: texture_multisampled_2d<f32>;
@fragment
export function fs(@builtin("position") p: vec4): Color {
  return { c: textureLoad(msaa, vec2i(p.xy), 1) };
}
`);
    expect(sampleTypes(m).msaa).toBe(UNFILTERABLE);
  });
});

describe('a texture a call pairs with a sampler is laid out float', () => {
  // Each form reads `photo` through `smp` and only loads `other`: the two sit in one module, so
  // a module-wide answer would give both the same word.
  const FORMS: readonly [string, string][] = [
    ['textureSample', 'textureSample(photo, smp, p.xy)'],
    ['textureSampleLevel', 'textureSampleLevel(photo, smp, p.xy, 0.)'],
    ['textureSampleBias', 'textureSampleBias(photo, smp, p.xy, 1.)'],
    ['textureSampleGrad', 'textureSampleGrad(photo, smp, p.xy, vec2(0.01, 0.), vec2(0., 0.01))'],
    // The component comes first, so the texture is the second argument.
    ['textureGather', 'textureGather(0, photo, smp, p.xy)'],
  ];
  for (const [name, call] of FORMS)
    it(name, () => {
      const m = moduleOf(program(`  return { c: ${call} + textureLoad(other, vec2i(p.xy), 0) };`));
      expect(pairsOf(m)).toEqual({ photo: ['smp'] });
      expect(sampleTypes(m)).toEqual({ photo: FLOAT, other: UNFILTERABLE });
    });

  it('a texture both loaded and sampled is float, since the layout serves the sampler', () => {
    const m = moduleOf(
      program(
        `  return { c: textureLoad(photo, vec2i(p.xy), 0) + textureSample(photo, smp, p.xy) };`,
      ),
    );
    expect(sampleTypes(m).photo).toBe(FLOAT);
  });

  it('a texture one entry samples and another loads is float for the module', () => {
    const m = moduleOf(`${program(`  return { c: textureSample(photo, smp, p.xy) };`)}
@fragment
export function fsLoad(@builtin("position") p: vec4): Color {
  return { c: textureLoad(photo, vec2i(p.xy), 0) };
}
`);
    expect(sampleTypes(m).photo).toBe(FLOAT);
  });
});

describe('the pair is read where the handles flow', () => {
  it('through a const of the texture and of the sampler', () => {
    const m = moduleOf(
      program(`  const t = photo;
  const s = smp;
  return { c: textureSample(t, s, p.xy) + textureLoad(other, vec2i(p.xy), 0) };`),
    );
    // The names the bindings have, not the ones the consts give them.
    expect(pairsOf(m)).toEqual({ photo: ['smp'] });
    expect(sampleTypes(m)).toEqual({ photo: FLOAT, other: UNFILTERABLE });
  });

  it("through a helper's parameters, and only for the texture it is called with", () => {
    const m = moduleOf(
      program(
        `  return { c: look(photo, smp, p.xy) + fetch(other, vec2i(p.xy)) };`,
        `function look(t: texture_2d<f32>, s: sampler, uv: vec2): vec4 {
  return textureSample(t, s, uv);
}
function fetch(t: texture_2d<f32>, at: vec2i): vec4 {
  return textureLoad(t, at, 0);
}`,
      ),
    );
    expect(pairsOf(m)).toEqual({ photo: ['smp'] });
    expect(sampleTypes(m)).toEqual({ photo: FLOAT, other: UNFILTERABLE });
  });

  it('through helpers that call helpers, gather included', () => {
    const m = moduleOf(
      program(
        `  return { c: outer(photo, smp, p.xy) + textureLoad(other, vec2i(p.xy), 0) };`,
        `function inner(t: texture_2d<f32>, s: sampler, uv: vec2): vec4 {
  return textureGather(2, t, s, uv);
}
function middle(t: texture_2d<f32>, s: sampler, uv: vec2): vec4 {
  return inner(t, s, uv);
}
function outer(t: texture_2d<f32>, s: sampler, uv: vec2): vec4 {
  return middle(t, s, uv);
}`,
      ),
    );
    expect(pairsOf(m)).toEqual({ photo: ['smp'] });
    expect(sampleTypes(m)).toEqual({ photo: FLOAT, other: UNFILTERABLE });
  });

  it('through a helper that names one of the two bindings itself', () => {
    const m = moduleOf(
      program(
        `  return { c: withSampler(photo, p.xy) + withTexture(smp, p.xy) };`,
        `function withSampler(t: texture_2d<f32>, uv: vec2): vec4 {
  return textureSample(t, smp, uv);
}
function withTexture(s: sampler, uv: vec2): vec4 {
  return textureSample(other, s, uv);
}`,
      ),
    );
    expect(pairsOf(m)).toEqual({ photo: ['smp'], other: ['smp'] });
    expect(sampleTypes(m)).toEqual({ photo: FLOAT, other: FLOAT });
  });

  it('a helper no entry calls pairs nothing, which WebGPU does not check either', () => {
    const m = moduleOf(
      program(
        `  return { c: textureLoad(other, vec2i(p.xy), 0) };`,
        `export function unused(uv: vec2): vec4 {
  return textureSample(other, smp, uv);
}`,
      ),
    );
    // The helper is in the module, so the answer is the entries' and not the file's.
    expect(m.funcs.map((f) => f.name)).toContain('unused');
    expect(sampleTypes(m).other).toBe(UNFILTERABLE);
  });

  it('a comparison sampler pairs with a depth texture, which is depth whatever meets it', () => {
    const m = moduleOf(`${PRELUDE}
declare const shadow: texture_depth_2d;
declare const cmp: sampler_comparison;
@fragment
export function fs(@builtin("position") p: vec4): Color {
  return { c: vec4(textureSampleCompare(shadow, cmp, p.xy, 0.5)) };
}
`);
    expect(pairsOf(m)).toEqual({});
    expect(sampleTypes(m).shadow).toBe('depth');
  });
});

describe('a module with no entry is read whole, since a host writes the entries over it', () => {
  const library = (body: string): string => `"use typeshade";
declare const photo: texture_2d<f32>;
declare const other: texture_2d<f32>;
declare const smp: sampler;
export function shade(uv: vec2): vec4 {
${body}
}
`;
  it('a texture a function samples is float', () => {
    const m = moduleOf(library(`  return textureSample(photo, smp, uv);`));
    expect(m.funcs.some((f) => stageOf(f) !== undefined)).toBe(false);
    expect(sampleTypes(m)).toEqual({ photo: FLOAT, other: UNFILTERABLE });
  });
  it('and one it only loads is not', () => {
    const m = moduleOf(library(`  return textureLoad(photo, vec2i(uv), 0);`));
    expect(sampleTypes(m)).toEqual({ photo: UNFILTERABLE, other: UNFILTERABLE });
  });
});

describe('the element decides an integer texture and a depth texture is depth', () => {
  it('reads each sample type off the declaration, for a load of any of them', () => {
    const m = moduleOf(`${PRELUDE}
declare const ids: texture_2d<u32>;
declare const deltas: texture_2d<i32>;
declare const shadow: texture_depth_2d;
declare const cmp: sampler_comparison;
declare const depthMs: texture_depth_multisampled_2d;
declare const store: texture_storage_2d<"r32float", "write">;
@fragment
export function fs(@builtin("position") p: vec4): Color {
  const at = vec2i(p.xy);
  textureStore(store, at, vec4(1.));
  const held = f32(textureLoad(ids, at, 0).x) + f32(textureLoad(deltas, at, 0).x);
  return { c: vec4(held + textureLoad(depthMs, at, 0) + textureSampleCompare(shadow, cmp, p.xy, 0.5)) };
}
`);
    expect(sampleTypes(m)).toEqual({
      photo: UNFILTERABLE,
      other: UNFILTERABLE,
      ids: 'uint',
      deltas: 'sint',
      shadow: 'depth',
      depthMs: 'depth',
    });
    // A storage texture has no sample type: it is its own kind of layout entry.
    const store = reflect(m)
      .bindGroups.flatMap((g) => g.entries)
      .find((e) => e.name === 'store');
    expect(store?.resourceKind).toBe('storage-texture');
    expect(store).not.toHaveProperty('sampleType');
  });
});

describe('what it cannot read, it takes the safe way', () => {
  const tex = { kind: 'texture', dim: '2d', elem: 'f32' } as const;
  const ms = { kind: 'texture', dim: '2d-ms', elem: 'f32' } as const;
  const samplerT = { kind: 'sampler' } as const;
  const uv = { op: 'lit', type: f32T, value: 0 } as const;
  const bindings = [
    { group: 0, binding: 0, name: 'photo', space: 'uniform', type: tex },
    { group: 0, binding: 1, name: 'other', space: 'uniform', type: tex },
    { group: 0, binding: 2, name: 'smp', space: 'uniform', type: samplerT },
    { group: 0, binding: 3, name: 'msaa', space: 'uniform', type: ms },
  ] as const;
  const fragment = (body: ModuleDecl['funcs'][number]['body']): ModuleDecl => ({
    consts: [],
    structs: [],
    bindings: [...bindings],
    funcs: [{ name: 'fs', stage: 'fragment', params: [], ret: { kind: 'void' }, body }],
  });
  const sample = (texture: string) =>
    ({
      s: 'call',
      expr: {
        op: 'call',
        type: vec4fT,
        fn: 'textureSample',
        args: [
          { op: 'varref', type: tex, name: texture },
          { op: 'varref', type: samplerT, name: 'smp' },
          uv,
        ],
      },
    }) as const;

  it('a raw statement is text no analysis reads, so every f32 texture is float but a multisampled one', () => {
    const m = fragment([{ s: 'raw', wgsl: 'let c = textureSample(other, smp, vec2f(0));' }]);
    expect(sampledTextures(m)).toBeUndefined();
    expect(sampleTypes(m)).toEqual({ photo: FLOAT, other: FLOAT, msaa: UNFILTERABLE });
  });

  it('a local that hides a binding of the same name is both, since it is not tracked by scope', () => {
    // `photo` here is the local, a `let` of `other`; a use after its block would be the binding.
    const m = fragment([
      { s: 'let', name: 'photo', expr: { op: 'varref', type: tex, name: 'other' } },
      sample('photo'),
    ]);
    expect([...sampledTextures(m)!].sort()).toEqual(['other', 'photo']);
    expect(sampleTypes(m)).toEqual({ photo: FLOAT, other: FLOAT, msaa: UNFILTERABLE });
  });
});

describe('the WebGL2 tier fuses the sampler this reads (Rule 11.10)', () => {
  it('a texture read through a const of it is fused with the sampler, not left with none', () => {
    const src = `${PRELUDE}
@fragment
export function fs(@builtin("position") p: vec4): Color {
  const t = photo;
  const s = smp;
  return { c: textureSample(t, s, p.xy) };
}
`;
    const draw = buildManifest(moduleOf(src)).gl?.draws?.fs;
    expect(draw).toBeDefined();
    expect(draw).toHaveProperty('samplers', { photo: 'smp' });
  });
});
