// The WebGL2 maps of the manifest carry the GLSL names (Proposal 0070, C7): the uniform block of
// a binding is the block type the fragment program declares, and a sampled texture's name is the
// name the program declares. The maps stay keyed by the authored name the host binds by, so a
// binding the GLSL respells is still bound by what the author wrote.
//
// Verifies: Rule 11.10 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { packModule } from '../compiler/ts/pack.js';
import {
  f32T,
  samplerT,
  texture2dfT,
  vec3fT,
  vec4fT,
  type Expr,
  type ModuleDecl,
  type Stmt,
} from '../core/ir/index.js';
import { allKindsModule } from './testing/all-kinds-module.js';

// `buffer` is a uniform binding the GLSL writer reserves, `half` a struct ES 3.00 reserves, and
// `texture` a texture the writer reserves too. The graphics factory's fragment entry reads none of
// them once its dead lets are removed, so this fixture gives it a body that reads the uniform's
// field and samples the texture with its fused sampler `textureSampler`.
const pack = () => {
  const base = allKindsModule(
    { binding: 'buffer', texture: 'texture', struct: 'half' },
    'graphics',
  );
  const structT = { kind: 'struct', name: 'half' } as const;
  const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
  const uniform: Expr = { op: 'varref', type: structT, name: 'buffer' };
  const sample: Expr = {
    op: 'call',
    type: vec4fT,
    fn: 'textureSample',
    args: [
      { op: 'varref', type: texture2dfT, name: 'texture' },
      { op: 'varref', type: samplerT, name: 'textureSampler' },
      { op: 'construct', type: vec3fT, args: [lit(0), lit(0), lit(0)] },
    ],
  };
  const body: Stmt[] = [
    {
      s: 'return',
      expr: {
        op: 'construct',
        type: vec4fT,
        args: [
          { op: 'member', type: f32T, base: uniform, field: 'f' },
          { op: 'member', type: f32T, base: sample, field: 'x' },
          lit(0),
          lit(1),
        ],
      },
    },
  ];
  const m: ModuleDecl = {
    ...base,
    funcs: base.funcs.map((f) => (f.name === 'fe' ? { ...f, body } : f)),
  };
  return packModule(m);
};

/** The GLSL spelling of a binding, as the manifest records it (`emittedGlsl`, else `emitted`). */
const glslNameOf = (p: ReturnType<typeof pack>, name: string): string => {
  const b = p.bindings.find((x) => x.name === name);
  if (b === undefined) throw new Error(`no binding "${name}"`);
  return b.emittedGlsl ?? b.emitted;
};

describe('the manifest records GLSL names of the WebGL2 maps (Proposal 0070, C7)', () => {
  const p = pack();
  const draw = p.gl!.draws!.fe as {
    fragment: string;
    blocks: Record<string, string>;
    samplers: Record<string, string | null>;
  };

  it('keys each map by the authored name and values it by the GLSL spelling', () => {
    expect(glslNameOf(p, 'buffer')).not.toBe('buffer');
    expect(Object.keys(draw.blocks)).toEqual(['buffer']);
    expect(Object.keys(draw.samplers)).toEqual(['texture']);
  });

  it('names a block by the block type the fragment program declares, not the authored struct', () => {
    const block = draw.blocks.buffer!;
    expect(block).not.toBe('half');
    expect(block).not.toMatch(/__|^gl_/u);
    expect(draw.fragment).toMatch(new RegExp(`layout\\(std140\\) uniform ${block} \\{`, 'u'));
  });

  it('declares each sampled texture under its GLSL name, and no other sampler', () => {
    const name = glslNameOf(p, 'texture');
    expect(name).not.toBe('texture');
    expect(draw.fragment).toMatch(new RegExp(`uniform sampler2D ${name};`, 'u'));
    // The fused sampler is no uniform of its own in GLSL ES 3.00.
    expect(draw.fragment).not.toMatch(/textureSampler/u);
    expect(draw.samplers.texture).toBe('textureSampler');
  });

  it('reports no refusal and names no identifier with two underscores', () => {
    expect(draw).not.toHaveProperty('none');
    expect(draw.fragment).not.toMatch(/__/u);
    expect(draw.fragment).not.toMatch(/\bhalf\b/u);
  });
});
