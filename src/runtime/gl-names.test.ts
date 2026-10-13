// The WebGL2 host binds what the GLSL program declares (Proposal 0070, C8): an override is pinned
// under its GLSL spelling, a uniform block is looked up by its block type, and a sampler or a data
// texture is located by the name its binding carries in GLSL. A recording context stands in for
// WebGL2, so the names the calls receive are the ones the test checks.
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
import { allKindsModule } from '../core/testing/all-kinds-module.js';
import { GlDrawing, GlRenderPrograms, glslNameOf, pinOverrides } from './gl-draw.js';
import { compile } from '../compiler/ts/compile.js';
import { emitGlslStages } from '../core/backends/glsl.js';
import { reflect } from '../core/reflect.js';

/** A WebGL2 stand-in that keeps each call, with its arguments, and answers the queries the
 *  program and the draw make. Constants are numbers nothing reads. */
function recordingGl(): { gl: WebGL2RenderingContext; calls: [string, unknown[]][] } {
  const calls: [string, unknown[]][] = [];
  const answers: Record<string, (...a: unknown[]) => unknown> = {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 8,
    getError: () => 0,
    getUniformBlockIndex: () => 0,
    getUniformLocation: (_p, name) => ({ at: name }),
    createFramebuffer: () => ({}),
    createSampler: () => ({}),
    createProgram: () => ({}),
    createShader: () => ({}),
    getExtension: () => null,
  };
  const gl = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== 'string') return undefined;
        const answer = answers[key];
        if (answer !== undefined)
          return (...a: unknown[]) => {
            calls.push([key, a]);
            return answer(...a);
          };
        if (/^[A-Z0-9_]+$/.test(key)) return 0x1000 + key.length;
        return (...a: unknown[]) => {
          calls.push([key, a]);
          return undefined;
        };
      },
    },
  ) as WebGL2RenderingContext;
  return { gl, calls };
}

describe('the WebGL2 host pins and binds by the GLSL names (Proposal 0070, C8)', () => {
  it('pins an override under the define the program declares, and keeps the authored name without one', () => {
    const src = '#version 300 es\n#ifndef shared_\n#define shared_ 1.0\n#endif\nvoid main() {}\n';
    const named = pinOverrides(src, { shared: 3 }, { shared: 'shared_' });
    expect(named).toContain('#define shared_ 3.0\n');
    expect(named).not.toMatch(/#define shared 3/u);
    // Without the names, the authored spelling is pinned, as before.
    expect(pinOverrides(src, { shared_: 2 })).toContain('#define shared_ 2.0\n');
  });

  // The factory's fragment reads its uniform and samples its texture (the body is patched below,
  // as the C7 test does), and its override `shared` is spelled `shared_` in GLSL.
  const graphics = (): ModuleDecl => {
    const base = allKindsModule(
      { binding: 'buffer', texture: 'texture', struct: 'half', override: 'shared' },
      'graphics',
    );
    const structT = { kind: 'struct', name: 'half' } as const;
    const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });
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
            {
              op: 'member',
              type: f32T,
              base: { op: 'varref', type: structT, name: 'buffer' },
              field: 'f',
            },
            { op: 'member', type: f32T, base: sample, field: 'x' },
            { op: 'overrideref', type: f32T, name: 'shared' },
            lit(1),
          ],
        },
      },
    ];
    return { ...base, funcs: base.funcs.map((f) => (f.name === 'fe' ? { ...f, body } : f)) };
  };

  it('binds the uniform block, the sampler and the override by the names the GLSL declares', () => {
    const pack = packModule(graphics());
    const draw = pack.gl!.draws!.fe as { fragment: string; blocks: Record<string, string> };
    const texture = pack.bindings.find((b) => b.name === 'texture')!;
    const override = pack.overrides.find((o) => o.name === 'shared')!;
    const block = draw.blocks.buffer!;
    const { gl, calls } = recordingGl();
    const drawing = new GlDrawing(gl);
    new GlRenderPrograms(drawing, pack).render({
      vertex: 'e',
      fragment: 'fe',
      constants: { shared: 3 },
    });

    // The block is looked up by its block type name in the text.
    expect(calls).toContainEqual(['getUniformBlockIndex', [expect.anything(), block]]);
    // The sampler is located by its GLSL name, which is not the authored one.
    const at = glslNameOf(texture);
    expect(at).not.toBe('texture');
    expect(calls).toContainEqual(['getUniformLocation', [expect.anything(), at]]);
    expect(calls).not.toContainEqual(['getUniformLocation', [expect.anything(), 'texture']]);
    // The override is pinned under its GLSL define, with the value the host supplied.
    const spelled = override.emittedGlsl ?? override.emitted;
    expect(spelled).not.toBe('shared');
    const pinned = calls.filter(([n]) => n === 'shaderSource').map(([, a]) => String(a[1]));
    expect(pinned.some((s) => s.includes(`#define ${spelled} 3.0\n`))).toBe(true);
    expect(pinned.every((s) => !s.includes('#define shared 3.0'))).toBe(true);
  });
});

describe('the std140 block lists the struct fields in host order (Proposal 0070, C8)', () => {
  // A uniform struct of three fields, read by a fragment entry. The host reads the bytes at
  // `offset`, so the block must list each field in the order the record gives it.
  const SRC = `"use typeshade";
class Frame { time: f32; count: u32; scale: f32; }
declare const frame: uniform<Frame>;
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(f32(vi), 0., 0., 1.);
}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return vec4(frame.time * frame.scale + f32(frame.count), p.x, 0., 1.);
}
`;

  it('declares the fields in the record order, at the record offsets', () => {
    const r = compile(SRC);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const record = reflect(r.module).uniforms.find((u) => u.name === 'Frame')!;
    const { fragment } = emitGlslStages(r.module);
    const block = /layout\(std140\) uniform \w+ \{([^}]*)\}/u.exec(fragment!)![1]!;
    const declared = [...block.matchAll(/^\s*\w+ (\w+);/gmu)].map((m) => m[1]);
    expect(declared).toEqual(record.fields.map((f) => f.emitted));
    expect(record.fields.map((f) => f.offset)).toEqual([0, 4, 8]);
  });
});
