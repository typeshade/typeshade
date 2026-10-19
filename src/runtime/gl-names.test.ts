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
import { reflect, wgslLayout } from '../core/reflect.js';
import { callDraw, type FragmentEntry } from '../core/host-draw.js';
import { onWebgl2, type KernelGlLoop } from '../core/host-kernel-gl.js';
import { compileTsSource } from '../compiler/ts/source-file.js';
import { emittedStructDecls } from '../compiler/ts/structs.js';
import { emittedName, spellingsOf } from '../core/spelling-plan.js';

/** A stand-in for a WebGL2 constant: a number nothing reads, distinct per name. */
const constant = (name: string): number => 0x1000 + name.length;

/** A WebGL2 stand-in that keeps each call, with its arguments, and answers the queries the
 *  program and the draw make. Constants are numbers nothing reads. */
function recordingGl(): { gl: WebGL2RenderingContext; calls: [string, unknown[]][] } {
  const calls: [string, unknown[]][] = [];
  const answers: Record<string, (...a: unknown[]) => unknown> = {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 8,
    getError: () => constant('NO_ERROR'),
    checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'),
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
        if (/^[A-Z0-9_]+$/.test(key)) return constant(key);
        return (...a: unknown[]) => {
          calls.push([key, a]);
          return undefined;
        };
      },
    },
  ) as WebGL2RenderingContext;
  return { gl, calls };
}

// The factory's fragment reads its uniform and samples its texture (the body is patched below,
// as the C7 test does), and its override `shared` is spelled `shared_` in GLSL.
const graphicsWithBinding = (binding: string): ModuleDecl => {
  const base = allKindsModule(
    { binding, texture: 'texture', struct: 'half', override: 'shared' },
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
            base: { op: 'varref', type: structT, name: binding },
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

describe('the WebGL2 host pins and binds by the GLSL names (Proposal 0070, C8)', () => {
  it('pins an override under the define the program declares, and keeps the authored name without one', () => {
    const src = '#version 300 es\n#ifndef shared_\n#define shared_ 1.0\n#endif\nvoid main() {}\n';
    const named = pinOverrides(src, { shared: 3 }, { shared: 'shared_' });
    expect(named).toContain('#define shared_ 3.0\n');
    expect(named).not.toMatch(/#define shared 3/u);
    // Without the names, the authored spelling is pinned, as before.
    expect(pinOverrides(src, { shared_: 2 })).toContain('#define shared_ 2.0\n');
  });

  const graphics = (): ModuleDecl => graphicsWithBinding('buffer');

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

describe('the generated fragment host locates its sampler by the GLSL name (Proposal 0070, C8)', () => {
  // The generated host calls `callDraw` with its entry record; the WebGL2 tier compiles the
  // record's program and locates each sampler by its binding's `glsl`, not the authored name.
  class OffscreenStub {
    width = 2;
    height = 2;
    constructor(private readonly gl: WebGL2RenderingContext) {}
    getContext(kind: string): unknown {
      return kind === 'webgl2' ? this.gl : null;
    }
  }
  class ImageStub {
    width = 2;
    height = 2;
  }
  const FRAG = `#version 300 es
precision highp float;
uniform sampler2D texture_;
out vec4 color;
void main() { color = texture(texture_, vec2(0.5)); }
`;

  it('locates the sampler by its binding glsl, and draws the image through that location', async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = { OffscreenCanvas: g.OffscreenCanvas, ImageBitmap: g.ImageBitmap };
    g.OffscreenCanvas = OffscreenStub;
    g.ImageBitmap = ImageStub;
    try {
      const { gl, calls } = recordingGl();
      const canvas = new OffscreenStub(gl);
      const entry: FragmentEntry = {
        name: 'fe',
        fn: 'fe',
        wgsl: '',
        params: ['position'],
        out: null,
        bindings: [
          {
            name: 'texture',
            group: 0,
            binding: 1,
            space: 'texture',
            s: 'texture_2d<f32>',
            glsl: 'texture_',
          },
        ],
        gl: { frag: FRAG, blocks: {}, samplers: { texture: null } },
      };
      await callDraw({} as never, entry, 2, canvas, { texture: new ImageStub() });
      expect(calls).toContainEqual(['getUniformLocation', [expect.anything(), 'texture_']]);
      expect(calls).not.toContainEqual(['getUniformLocation', [expect.anything(), 'texture']]);
      // The unit the sampler reads is the one the location was given.
      expect(calls).toContainEqual(['uniform1i', [{ at: 'texture_' }, 0]]);
    } finally {
      // The files of a worker share globals (`isolate: false`): a name that was absent is absent again.
      for (const k of ['OffscreenCanvas', 'ImageBitmap'] as const) {
        if (saved[k] === undefined) delete g[k];
        else g[k] = saved[k];
      }
    }
  });
});

describe('the kernel loop on WebGL2 locates respelled reads and uniforms (Proposal 0070, C8)', () => {
  it('passes the GLSL names of a reserved array parameter and a scalar uniform to the program', () => {
    const f32Array = {
      k: 'a',
      n: null,
      st: 4,
      e: { k: 's', t: 'f32' },
    } as const;
    const loop: KernelGlLoop = {
      glsl: '#version 300 es\nprecision highp float;\nout vec4 c;\nvoid main() { c = vec4(0.0); }\n',
      out: 'out',
      outScalar: 'f32',
      reads: [{ param: 'half', name: 'half', glsl: 'half_', layout: f32Array }],
      uniforms: [{ name: 'shared', glsl: 'shared_', scalar: 'f32', n: 1 }],
    };
    const { gl, calls } = recordingGl();
    const arrays = new Map<string, unknown>([
      ['half', new Float32Array([1, 2, 3])],
      ['out', new Float32Array(3)],
    ]);
    onWebgl2(gl, loop, arrays, new Map([['shared', 2.5]]), 0, 1, 3);

    // The array is located by its GLSL name, on the unit the program reads it from.
    expect(calls).toContainEqual(['getUniformLocation', [expect.anything(), 'half_']]);
    expect(calls).not.toContainEqual(['getUniformLocation', [expect.anything(), 'half']]);
    expect(calls).toContainEqual(['uniform1i', [{ at: 'half_' }, 0]]);
    // The scalar is located by its GLSL name and receives the host's value.
    expect(calls).toContainEqual(['uniform1fv', [{ at: 'shared_' }, [2.5]]]);
    expect(calls).not.toContainEqual(['getUniformLocation', [expect.anything(), 'shared']]);
  });
});

describe('the std140 block of a nested struct with respelled fields follows reflection (Proposal 0070, C8)', () => {
  const SRC = `"use typeshade";
class Inner { half: f32; texture: u32; }
class Frame { inner: Inner; time: f32; }
declare const frame: uniform<Frame>;
@vertex
export function vs(@builtin("vertex_index") vi: u32): vec4 {
  return vec4(f32(vi), 0., 0., 1.);
}
@fragment
export function fs(@builtin("position") p: vec4): vec4 {
  return vec4(frame.inner.half, f32(frame.inner.texture), frame.time, p.x);
}
`;

  it('declares the block and the nested struct fields in the reflected order, at the reflected offsets', () => {
    // Reserved names (`half`, `texture`) compile since change 0070; this test reads the record
    // and the GLSL text.
    const r = compileTsSource(SRC);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    // The module `compile()` assembles from the same result.
    const m: ModuleDecl = {
      consts: [...r.consts],
      structs: emittedStructDecls(r.structs),
      bindings: [...r.bindings],
      funcs: [...r.funcs],
      overrides: [...r.overrides],
      vars: [...r.vars],
      enables: [...r.enables],
    };
    const reflection = reflect(m);
    const frame = reflection.uniforms.find((u) => u.name === 'Frame')!;
    const spell = spellingsOf(m).glsl;
    const { fragment } = emitGlslStages(m);

    // The block: the top-level fields, in record order, at the record offsets.
    const block = /layout\(std140\) uniform \w+ \{([^}]*)\}/u.exec(fragment!)![1]!;
    const declared = [...block.matchAll(/^\s*\w+ (\w+);/gmu)].map((x) => x[1]);
    expect(declared).toEqual(frame.fields.map((f) => f.emitted));
    expect(frame.fields.map((f) => f.offset)).toEqual([0, 16]);

    // The nested struct: its GLSL fields in declaration order, at the offsets of a standalone
    // std140 layout of the same struct.
    const structs = new Map(m.structs.map((s) => [s.name, s]));
    const inner = wgslLayout(structs.get('Inner')!, 'std140', structs);
    const innerName = emittedName(spell.structs, 'Inner');
    const body = new RegExp(`struct ${innerName} \\{([^}]*)\\}`, 'u').exec(fragment!)![1]!;
    const innerDeclared = [...body.matchAll(/^\s*\w+ (\w+);/gmu)].map((x) => x[1]);
    expect(innerDeclared).toEqual(inner.fields.map((f) => emittedName(spell.members, f.name)));
    expect(inner.fields.map((f) => f.offset)).toEqual([0, 4]);
    // The respelled fields are not the authored ones.
    expect(innerDeclared).not.toContain('half');
    expect(innerDeclared).not.toContain('texture');
  });
});

describe('a binding whose GLSL and WGSL spellings agree binds by the GLSL name (Proposal 0070, C8)', () => {
  // `class` is respelled `class_` on both targets, so the pack record has no `emittedGlsl`. The
  // host must still look the uniform up by `class_`, not by the authored `class`.
  it('locates the uniform block by the spelling both targets share', () => {
    const pack = packModule(graphicsWithBinding('class'));
    const record = pack.bindings.find((b) => b.name === 'class')!;
    expect(record.emittedGlsl).toBeUndefined();
    expect(glslNameOf(record)).toBe(record.emitted);
    expect(glslNameOf(record)).not.toBe('class');
    const { gl, calls } = recordingGl();
    new GlRenderPrograms(new GlDrawing(gl), pack).render({
      vertex: 'e',
      fragment: 'fe',
      constants: { shared: 3 },
    });
    const draw = pack.gl!.draws!.fe as { blocks: Record<string, string> };
    expect(draw.blocks.class).toBeDefined();
    expect(calls).toContainEqual(['getUniformBlockIndex', [expect.anything(), draw.blocks.class]]);
  });
});
