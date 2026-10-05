// Change 0046 (#484, part 2): a storage struct array with a `u32` or `i32` field is an R32UI data
// texture on GLSL ES 3.00, and `reflect()` names the format a host allocates. Both halves read
// the same function (`glslDataTextureOf`), and these tests read both: the sampler the GLSL
// declares and the `glslDataTexture` reflect reports, on the same source.

import { describe, expect, it } from 'vitest';
import { compile } from '../compiler/ts/compile.js';
import { reflect } from './reflect.js';

/** A fragment entry that reads one field (or element) of `words`, so the read survives DCE. */
const program = (decl: string, read: string): string => `'use typeshade';
class Ints { a: u32; b: f32; c: i32; d: vec2; }
class Floats { a: f32; b: f32; d: vec2; }
${decl}
class VsOut { @builtin("position") pos: vec4; }
class Color { @location(0) color: vec4; }
@vertex
export function vs(@builtin("vertex_index") vi: u32): VsOut {
  const o = new VsOut();
  o.pos = vec4(0., 0., 0., 1.);
  return o;
}
@fragment
export function fs(v: VsOut): Color {
  const i = u32(v.pos.x);
  const c = new Color();
  c.color = vec4(${read}, 0., 0., 1.);
  return c;
}
`;

const glslAndFormat = (decl: string, read: string): { fs: string; format: unknown } => {
  const r = compile(program(decl, read), { fileName: 'x.shade.ts' });
  expect(r.diagnostics).toEqual([]);
  const entry = reflect(r.module!)
    .bindGroups.flatMap((g) => g.entries)
    .find((e) => e.name === 'words');
  return { fs: r.glsl!.fragment, format: entry?.glslDataTexture };
};

describe('change 0046 — the GLSL data texture of a storage binding', () => {
  it('reads a struct with a u32 or i32 field from R32UI, each lane as its own type', () => {
    const { fs, format } = glslAndFormat(
      'declare const words: storage<array<Ints>>;',
      'f32(words[i].a) + words[i].b + f32(words[i].c) + words[i].d.y',
    );
    expect(format).toBe('r32ui');
    expect(fs).toContain('uniform usampler2D words;');
    expect(fs).not.toContain('uniform sampler2D words;');
    // a u32 lane as it is, an i32 lane through int(), a float lane through uintBitsToFloat
    expect(fs).toMatch(/float\(_sfetchU\(words, /);
    expect(fs).toMatch(/int\(_sfetchU\(words, /);
    expect(fs).toMatch(/uintBitsToFloat\(_sfetchU\(words, /);
    // and never the R32F route a driver may flush a small integer on (GLSL ES 3.00 §2.1.1)
    expect(fs).not.toContain('floatBitsToUint');
  });

  it('keeps a struct of float fields on R32F, as before', () => {
    const { fs, format } = glslAndFormat(
      'declare const words: storage<array<Floats>>;',
      'words[i].a + words[i].d.y',
    );
    expect(format).toBe('r32f');
    expect(fs).toContain('uniform sampler2D words;');
    expect(fs).not.toContain('usampler2D');
    expect(fs).not.toContain('uintBitsToFloat');
  });

  it.each([
    ['storage<array<f32>>', 'words[i]', 'r32f'],
    ['storage<array<u32>>', 'f32(words[i])', 'r32ui'],
    ['storage<array<i32>>', 'f32(words[i])', 'r32i'],
    ['storage<array<vec4>>', 'words[i].x', 'r32f'],
    ['storage<array<vec4u>>', 'f32(words[i].x)', 'r32ui'],
    ['storage<array<vec2i>>', 'f32(words[i].x)', 'r32i'],
  ] as const)('reports %s as %s', (type, read, expected) => {
    const { fs, format } = glslAndFormat(`declare const words: ${type};`, read);
    expect(format).toBe(expected);
    const sampler = { r32f: 'sampler2D', r32ui: 'usampler2D', r32i: 'isampler2D' }[expected];
    expect(fs).toContain(`uniform ${sampler} words;`);
  });

  it('reports no format on an entry that is not a storage binding', () => {
    const r = compile(program('declare const words: uniform<Floats>;', 'words.a'), {
      fileName: 'x.shade.ts',
    });
    expect(r.diagnostics).toEqual([]);
    const entry = reflect(r.module!)
      .bindGroups.flatMap((g) => g.entries)
      .find((e) => e.name === 'words');
    expect(entry).toBeDefined();
    expect(entry!.glslDataTexture).toBeUndefined();
  });
});
