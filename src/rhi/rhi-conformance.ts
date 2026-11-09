// The conformance suite of the render hardware interface (change 0120, milestone M2): the same
// buffers, textures, passes and dispatches recorded on each backend, each read back and held to an
// answer this file computes in plain JavaScript. A backend conforms when it gives every answer.
//
// It runs where a device is: the compile gate runs it on WebGPU and on WebGL2 in headless Chromium
// (`scripts/rhi-conformance-page.ts`), and `rhi-conformance.test.ts` holds the suite itself (that
// it reaches every member of the interface, and that its comparison can fail). The CPU backend of
// milestone M3 joins it.
//
// Each case is written once against the interface. Its programs come in both languages a backend
// takes (`caps.shaderLanguage`): WGSL, and GLSL ES 3.00 in WebGPU's conventions (a position in
// WebGPU's clip space, the bindings by name), which the WebGL2 backend keeps (row 0 at the top,
// depth 0 to 1, `frontFace`). Every value a case draws is exactly representable in an 8-bit unorm
// texel, so each answer is exact.

import { STAGE, type RhiBindLayoutEntry, type RhiDevice, type RhiTexture } from './rhi.js';

/** A case's outcome on one device: the numbers it read back and the answer, or why it did not
 *  run there. */
export interface CaseResult {
  readonly name: string;
  readonly got?: readonly number[];
  readonly want?: readonly number[];
  readonly skipped?: string;
}

/** One case: what it reaches of the interface, and how it runs. `run` resolves to the numbers it
 *  read back and the answer they must equal, or to a reason the device cannot run it. */
export interface ConformanceCase {
  readonly name: string;
  /** The members of `RhiDevice`, `RhiCommandEncoder`, `RhiRenderPass` and `RhiComputePass` the
   *  case calls. */
  readonly covers: readonly string[];
  run(device: RhiDevice): Promise<{ got: number[]; want: number[] } | { skipped: string }>;
}

const FULL_SCREEN_WGSL = `@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FULL_SCREEN_GLSL = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** The programs of a case in each language: one WGSL module, or a GLSL vertex and fragment. */
interface Programs {
  readonly wgsl: string;
  readonly vertex: string;
  readonly fragment: string;
}

/** A render pipeline of `programs` into one `rgba8unorm` target, with `entries` in group 0. */
async function pipelineOf(
  device: RhiDevice,
  programs: Programs,
  entries: readonly RhiBindLayoutEntry[],
  extra: {
    readonly buffers?: Parameters<RhiDevice['createRenderPipeline']>[0]['vertex']['buffers'];
    readonly depth?: boolean;
    readonly blend?: object;
    readonly cullMode?: 'none' | 'front' | 'back';
    /** A stencil test on a `depth24plus-stencil8` attachment, both faces alike, depth always. */
    readonly stencil?: {
      readonly compare: 'always' | 'equal';
      readonly passOp: 'keep' | 'replace';
    };
  } = {},
): Promise<{
  pipeline: Awaited<ReturnType<RhiDevice['createRenderPipeline']>>;
  layout: ReturnType<RhiDevice['createBindGroupLayout']>;
}> {
  const glsl = device.caps.shaderLanguage === 'glsl-es300';
  const layout = device.createBindGroupLayout(entries);
  const module = device.createShaderModule(glsl ? programs.vertex : programs.wgsl);
  const pipeline = await device.createRenderPipeline({
    label: 'a conformance pipeline',
    layouts: [layout],
    module,
    vertex: { entryPoint: 'vs', buffers: extra.buffers ?? [] },
    fragment: {
      entryPoint: 'fs',
      targets: [
        { format: 'rgba8unorm', ...(extra.blend !== undefined ? { blend: extra.blend } : {}) },
      ],
      ...(glsl ? { module: device.createShaderModule(programs.fragment) } : {}),
    },
    primitive: { topology: 'triangle-list', cullMode: extra.cullMode ?? 'none', frontFace: 'ccw' },
    ...(extra.depth === true
      ? {
          depthStencil: {
            format: 'depth24plus',
            compare: 'less',
            write: true,
            bias: { constant: 0, slopeScale: 0, clamp: 0 },
          },
        }
      : {}),
    ...(extra.stencil !== undefined
      ? {
          depthStencil: {
            format: 'depth24plus-stencil8',
            compare: 'always',
            write: false,
            bias: { constant: 0, slopeScale: 0, clamp: 0 },
            stencil: {
              front: { ...extra.stencil, failOp: 'keep', depthFailOp: 'keep' },
              back: { ...extra.stencil, failOp: 'keep', depthFailOp: 'keep' },
              readMask: 0xff,
              writeMask: 0xff,
            },
          },
        }
      : {}),
    multisample: { count: 1, mask: 0xffffffff },
  });
  return { pipeline, layout };
}

/** An `rgba8unorm` target of `w` × `h` that a pass draws into and a read copies back. */
const target = (device: RhiDevice, w: number, h: number): RhiTexture =>
  device.createTexture({
    size: [w, h, 1],
    format: 'rgba8unorm',
    usage: ['render', 'sampled', 'copy-src', 'copy-dst'],
  });

/** A uniform buffer of `floats`. */
function uniform(device: RhiDevice, floats: readonly number[]) {
  const b = device.createBuffer({ size: floats.length * 4, usage: ['uniform', 'copy-dst'] });
  device.writeBuffer(b, 0, new Float32Array(floats));
  return b;
}

/** The bytes of a `w` × `h` image whose texel at `(x, y)`, row 0 the top, is `texel(x, y)`. */
function image(w: number, h: number, texel: (x: number, y: number) => readonly number[]): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(...texel(x, y));
  return out;
}

/** The 8-bit unorm byte of `v`, as WebGPU converts a colour to an `rgba8unorm` texel. */
const unorm8 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);

const UNIFORM_COLOUR: Programs = {
  wgsl: `struct U { c: vec4f }
@group(0) @binding(0) var<uniform> u: U;
${FULL_SCREEN_WGSL}
@fragment fn fs() -> @location(0) vec4f { return u.c; }`,
  vertex: FULL_SCREEN_GLSL,
  fragment: `#version 300 es
precision highp float;
layout(std140) uniform U { vec4 c; } u;
layout(location = 0) out vec4 o;
void main() { o = u.c; }
`,
};

const UNIFORM_ENTRY: RhiBindLayoutEntry = {
  binding: 0,
  visibility: STAGE.vertex | STAGE.fragment,
  name: 'U',
  label: 'U',
  buffer: { type: 'uniform' },
};

export const CONFORMANCE: readonly ConformanceCase[] = [
  {
    name: 'a buffer written whole and in part, copied, and read back',
    covers: [
      'createBuffer',
      'writeBuffer',
      'createCommandEncoder',
      'copyBufferToBuffer',
      'submit',
      'readBuffer',
      'destroyBuffer',
    ],
    async run(device) {
      const src = device.createBuffer({ size: 32, usage: ['copy-src', 'copy-dst'] });
      const dst = device.createBuffer({ size: 32, usage: ['map-read', 'copy-dst'] });
      const words = Uint32Array.from({ length: 8 }, (_, i) => 0x01020304 * (i + 1));
      device.writeBuffer(src, 0, words);
      device.writeBuffer(src, 8, new Uint32Array([0xdeadbeef, 0x12345678]));
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(src, 4, dst, 0, 28);
      await device.submit([encoder]);
      const got = [...new Uint32Array(await device.readBuffer(dst))];
      device.destroyBuffer(src);
      device.destroyBuffer(dst);
      const want = [...words];
      want[2] = 0xdeadbeef;
      want[3] = 0x12345678;
      return { got, want: [...want.slice(1), 0] };
    },
  },
  {
    name: 'an rgba8unorm and an r32float texture written and read back, row 0 first',
    covers: ['createTexture', 'writeTexture', 'readTexture', 'destroyTexture'],
    async run(device) {
      const colour = device.createTexture({
        size: [4, 3, 1],
        format: 'rgba8unorm',
        usage: ['sampled', 'copy-src', 'copy-dst'],
      });
      const bytes = image(4, 3, (x, y) => [x * 40, y * 80, (x + y) * 20, 255]);
      device.writeTexture(colour, new Uint8Array(bytes), 16, 4, 3);
      const floats = device.createTexture({
        size: [3, 2, 1],
        format: 'r32float',
        usage: ['render', 'sampled', 'copy-src', 'copy-dst'],
      });
      const values = [0.5, -2, 1024.25, 3e-3, -0, 7];
      device.writeTexture(floats, new Float32Array(values), 12, 3, 2);
      const a = [...(await device.readTexture(colour, 4))];
      const b = [...new Float32Array((await device.readTexture(floats, 4)).buffer)];
      device.destroyTexture(colour);
      device.destroyTexture(floats);
      return { got: [...a, ...b], want: [...bytes, ...Float32Array.from(values)] };
    },
  },
  {
    name: 'a pass that clears its target and draws nothing',
    covers: ['createView', 'beginRenderPass', 'end'],
    async run(device) {
      const t = target(device, 4, 4);
      const encoder = device.createCommandEncoder();
      encoder
        .beginRenderPass({
          colorAttachments: [
            {
              view: device.createView(t),
              loadOp: 'clear',
              storeOp: 'store',
              clearValue: [0.2, 0.4, 0.6, 1],
            },
          ],
        })
        .end();
      await device.submit([encoder]);
      const got = [...(await device.readTexture(t, 4))];
      return { got, want: image(4, 4, () => [51, 102, 153, 255]) };
    },
  },
  {
    name: 'a full-screen triangle that reads a uniform buffer',
    covers: [
      'createBindGroupLayout',
      'createShaderModule',
      'createRenderPipeline',
      'createBindGroup',
      'setPipeline',
      'setBindGroup',
      'draw',
    ],
    async run(device) {
      const t = target(device, 8, 8);
      const { pipeline, layout } = await pipelineOf(device, UNIFORM_COLOUR, [UNIFORM_ENTRY]);
      const colour = [0.2, 0.6, 1, 0.4];
      const u = uniform(device, colour);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: device.createView(t),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 1],
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup(layout, [{ binding: 0, resource: { buffer: u } }]),
      );
      pass.draw(3);
      pass.end();
      await device.submit([encoder]);
      const got = [...(await device.readTexture(t, 4))];
      return { got, want: image(8, 8, () => colour.map(unorm8)) };
    },
  },
  {
    name: 'the framebuffer position: row 0 at the top, as WebGPU draws it',
    covers: ['draw'],
    async run(device) {
      const t = target(device, 6, 5);
      const { pipeline, layout } = await pipelineOf(
        device,
        {
          wgsl: `${FULL_SCREEN_WGSL}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return vec4f(floor(p.x) / 255.0, floor(p.y) / 255.0, 0.0, 1.0);
}`,
          vertex: FULL_SCREEN_GLSL,
          fragment: `#version 300 es
precision highp float;
layout(location = 0) out vec4 o;
void main() { o = vec4(floor(gl_FragCoord.x) / 255.0, floor(gl_FragCoord.y) / 255.0, 0.0, 1.0); }
`,
        },
        [],
      );
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: device.createView(t),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 0],
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, device.createBindGroup(layout, []));
      pass.draw(3);
      pass.end();
      await device.submit([encoder]);
      const got = [...(await device.readTexture(t, 4))];
      return { got, want: image(6, 5, (x, y) => [x, y, 0, 255]) };
    },
  },
  {
    name: 'an indexed, instanced quad from a vertex buffer, coloured from a storage buffer',
    covers: ['setVertexBuffer', 'setIndexBuffer', 'drawIndexed'],
    async run(device) {
      const t = target(device, 8, 4);
      const { pipeline, layout } = await pipelineOf(
        device,
        {
          wgsl: `@group(0) @binding(0) var<storage, read> colours: array<vec4f>;
struct Out { @builtin(position) p: vec4f, @location(0) @interpolate(flat) c: vec4f }
@vertex fn vs(@location(0) q: vec2f, @builtin(instance_index) k: u32) -> Out {
  return Out(vec4f(q.x + f32(k), q.y, 0.0, 1.0), colours[k]);
}
@fragment fn fs(@location(0) @interpolate(flat) c: vec4f) -> @location(0) vec4f { return c; }`,
          vertex: `#version 300 es
uniform highp sampler2D colours;
layout(location = 0) in vec2 q;
flat out vec4 c;
float word(int i) { return texelFetch(colours, ivec2(i % 2048, i / 2048), 0).r; }
void main() {
  int k = gl_InstanceID;
  gl_Position = vec4(q.x + float(k), q.y, 0.0, 1.0);
  c = vec4(word(4 * k), word(4 * k + 1), word(4 * k + 2), word(4 * k + 3));
}
`,
          fragment: `#version 300 es
precision highp float;
flat in vec4 c;
layout(location = 0) out vec4 o;
void main() { o = c; }
`,
        },
        [
          {
            binding: 0,
            visibility: STAGE.vertex,
            name: 'colours',
            label: 'colours',
            buffer: { type: 'read-only-storage' },
          },
        ],
        {
          buffers: [
            { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          ],
        },
      );
      const colours = [0.2, 0.4, 0.6, 1, 1, 0.8, 0, 0.2];
      const storage = device.createBuffer({
        size: 32,
        usage: ['storage', 'copy-dst'],
        elem: 'f32',
      });
      device.writeBuffer(storage, 0, new Float32Array(colours));
      // The quad covers x from -1 to 0 and the top half of clip space, y from 0 to 1, which is
      // framebuffer rows 0 and 1; the second instance moves it to x from 0 to 1.
      const vertices = device.createBuffer({ size: 32, usage: ['vertex', 'copy-dst'] });
      device.writeBuffer(vertices, 0, new Float32Array([-1, 0, 0, 0, 0, 1, -1, 1]));
      const indices = device.createBuffer({ size: 12, usage: ['index', 'copy-dst'] });
      device.writeBuffer(indices, 0, new Uint16Array([0, 1, 2, 0, 2, 3]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: device.createView(t),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 0],
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup(layout, [{ binding: 0, resource: { buffer: storage } }]),
      );
      pass.setVertexBuffer(0, vertices);
      pass.setIndexBuffer(indices, 'uint16');
      pass.drawIndexed(6, 2);
      pass.end();
      await device.submit([encoder]);
      const got = [...(await device.readTexture(t, 4))];
      const want = image(8, 4, (x, y) =>
        y >= 2 ? [0, 0, 0, 0] : (x < 4 ? colours.slice(0, 4) : colours.slice(4)).map(unorm8),
      );
      return { got, want };
    },
  },
  {
    name: 'a texture sampled nearest, its row 0 at the top',
    covers: ['createSampler'],
    async run(device) {
      const texels = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255];
      const tex = device.createTexture({
        size: [2, 2, 1],
        format: 'rgba8unorm',
        usage: ['sampled', 'copy-dst'],
      });
      device.writeTexture(tex, new Uint8Array(texels), 8, 2, 2);
      const sampler = device.createSampler({
        magFilter: 'nearest',
        minFilter: 'nearest',
        mipmapFilter: 'nearest',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
      });
      const t = target(device, 4, 4);
      const { pipeline, layout } = await pipelineOf(
        device,
        {
          wgsl: `@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
${FULL_SCREEN_WGSL}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return textureSample(tex, smp, p.xy / 4.0);
}`,
          vertex: FULL_SCREEN_GLSL,
          fragment: `#version 300 es
precision highp float;
uniform highp sampler2D tex;
layout(location = 0) out vec4 o;
void main() { o = texture(tex, gl_FragCoord.xy / 4.0); }
`,
        },
        [
          {
            binding: 0,
            visibility: STAGE.fragment,
            name: 'tex',
            label: 'tex',
            samplerBinding: 1,
            texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
          },
          { binding: 1, visibility: STAGE.fragment, label: 'smp', sampler: { type: 'filtering' } },
        ],
      );
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: device.createView(t),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 0],
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup(layout, [
          { binding: 0, resource: { view: device.createView(tex) } },
          { binding: 1, resource: { sampler } },
        ]),
      );
      pass.draw(3);
      pass.end();
      await device.submit([encoder]);
      const got = [...(await device.readTexture(t, 4))];
      const want = image(4, 4, (x, y) => {
        const i = ((y >> 1) * 2 + (x >> 1)) * 4;
        return texels.slice(i, i + 4);
      });
      return { got, want };
    },
  },
  {
    name: 'a depth test: depth 0 to 1, less, written; the nearest of three triangles stays',
    covers: ['beginRenderPass'],
    async run(device) {
      const t = target(device, 4, 4);
      const depth = device.createTexture({
        size: [4, 4, 1],
        format: 'depth24plus',
        usage: ['render'],
      });
      const { pipeline, layout } = await pipelineOf(
        device,
        {
          wgsl: `struct U { c: vec4f, z: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, u.z.x, 1.0);
}
@fragment fn fs() -> @location(0) vec4f { return u.c; }`,
          vertex: `#version 300 es
layout(std140) uniform U { vec4 c; vec4 z; } u;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, u.z.x, 1.0);
}
`,
          fragment: `#version 300 es
precision highp float;
layout(std140) uniform U { vec4 c; vec4 z; } u;
layout(location = 0) out vec4 o;
void main() { o = u.c; }
`,
        },
        [UNIFORM_ENTRY],
        { depth: true },
      );
      const draws = [
        [1, 0, 0, 1, 0.75],
        [0, 1, 0, 1, 0.25],
        [0, 0, 1, 1, 0.5],
      ];
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: device.createView(t),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 1],
          },
        ],
        depthStencilAttachment: {
          view: device.createView(depth),
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
          depthClearValue: 1,
        },
      });
      pass.setPipeline(pipeline);
      for (const [r, g, b, a, z] of draws) {
        const u = uniform(device, [r!, g!, b!, a!, z!, 0, 0, 0]);
        pass.setBindGroup(
          0,
          device.createBindGroup(layout, [{ binding: 0, resource: { buffer: u } }]),
        );
        pass.draw(3);
      }
      pass.end();
      await device.submit([encoder]);
      const got = [...(await device.readTexture(t, 4))];
      return { got, want: image(4, 4, () => [0, 255, 0, 255]) };
    },
  },
  {
    name: 'a viewport and a scissor, in framebuffer coordinates with y down',
    covers: ['setViewport', 'setScissorRect'],
    async run(device) {
      const t = target(device, 8, 8);
      const { pipeline, layout } = await pipelineOf(device, UNIFORM_COLOUR, [UNIFORM_ENTRY]);
      const u = uniform(device, [1, 1, 1, 1]);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: device.createView(t),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 1],
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup(layout, [{ binding: 0, resource: { buffer: u } }]),
      );
      // The viewport is the top-left quadrant, the scissor its left half and two rows below it.
      pass.setViewport(0, 0, 4, 4, 0, 1);
      pass.setScissorRect(0, 1, 2, 7);
      pass.draw(3);
      pass.end();
      await device.submit([encoder]);
      const got = [...(await device.readTexture(t, 4))];
      const want = image(8, 8, (x, y) =>
        x < 2 && y >= 1 && y < 4 ? [255, 255, 255, 255] : [0, 0, 0, 255],
      );
      return { got, want };
    },
  },
  {
    name: 'the blend constant: a target blended as the constant alone',
    covers: ['setBlendConstant'],
    async run(device) {
      const t = target(device, 4, 4);
      const { pipeline, layout } = await pipelineOf(device, UNIFORM_COLOUR, [UNIFORM_ENTRY], {
        blend: {
          color: { srcFactor: 'constant', dstFactor: 'zero', operation: 'add' },
          alpha: { srcFactor: 'constant', dstFactor: 'zero', operation: 'add' },
        },
      });
      const u = uniform(device, [1, 1, 1, 1]);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: device.createView(t),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 0],
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup(layout, [{ binding: 0, resource: { buffer: u } }]),
      );
      pass.setBlendConstant([0.2, 0.4, 0.6, 0.8]);
      pass.draw(3);
      pass.end();
      await device.submit([encoder]);
      const got = [...(await device.readTexture(t, 4))];
      return { got, want: image(4, 4, () => [51, 102, 153, 204]) };
    },
  },
  {
    name: 'culling: frontFace ccw in WebGPU clip space, the back face culled',
    covers: ['createRenderPipeline'],
    async run(device) {
      const t = target(device, 4, 4);
      // Two triangles, one in each half: the left counter-clockwise (front), the right clockwise.
      const { pipeline, layout } = await pipelineOf(
        device,
        {
          wgsl: `struct U { c: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@location(0) q: vec2f) -> @builtin(position) vec4f { return vec4f(q, 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return u.c; }`,
          vertex: `#version 300 es
layout(location = 0) in vec2 q;
void main() { gl_Position = vec4(q, 0.0, 1.0); }
`,
          fragment: UNIFORM_COLOUR.fragment,
        },
        [UNIFORM_ENTRY],
        {
          buffers: [
            { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          ],
          cullMode: 'back',
        },
      );
      const u = uniform(device, [1, 1, 1, 1]);
      const vertices = device.createBuffer({ size: 48, usage: ['vertex', 'copy-dst'] });
      device.writeBuffer(vertices, 0, new Float32Array([-1, -1, 0, -1, -1, 1, 0, -1, 0, 1, 1, -1]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: device.createView(t),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 1],
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup(layout, [{ binding: 0, resource: { buffer: u } }]),
      );
      pass.setVertexBuffer(0, vertices);
      pass.draw(6);
      pass.end();
      await device.submit([encoder]);
      const got = [...(await device.readTexture(t, 4))];
      // The left triangle covers the pixel centres below its edge from (0, -1) to (-1, 1): in
      // framebuffer coordinates, y > 2x.
      const want = image(4, 4, (x, y) =>
        y + 0.5 > 2 * (x + 0.5) ? [255, 255, 255, 255] : [0, 0, 0, 255],
      );
      return { got, want };
    },
  },
  {
    name: 'a stencil reference: written where a draw passes, then tested equal',
    covers: ['setStencilReference'],
    async run(device) {
      const t = target(device, 4, 4);
      const ds = device.createTexture({
        size: [4, 4, 1],
        format: 'depth24plus-stencil8',
        usage: ['render'],
      });
      const write = await pipelineOf(device, UNIFORM_COLOUR, [UNIFORM_ENTRY], {
        stencil: { compare: 'always', passOp: 'replace' },
      });
      const test = await pipelineOf(device, UNIFORM_COLOUR, [UNIFORM_ENTRY], {
        stencil: { compare: 'equal', passOp: 'keep' },
      });
      const black = uniform(device, [0, 0, 0, 1]);
      const white = uniform(device, [1, 1, 1, 1]);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: device.createView(t),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: [0, 0, 0, 1],
          },
        ],
        depthStencilAttachment: {
          view: device.createView(ds),
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
          depthClearValue: 1,
          stencilLoadOp: 'clear',
          stencilStoreOp: 'store',
          stencilClearValue: 0,
        },
      });
      // 5 into the stencil of the top row, then white where the stencil equals 5.
      pass.setPipeline(write.pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup(write.layout, [{ binding: 0, resource: { buffer: black } }]),
      );
      pass.setStencilReference(5);
      pass.setScissorRect(0, 0, 4, 1);
      pass.draw(3);
      pass.setScissorRect(0, 0, 4, 4);
      pass.setPipeline(test.pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup(test.layout, [{ binding: 0, resource: { buffer: white } }]),
      );
      pass.draw(3);
      pass.end();
      await device.submit([encoder]);
      const got = [...(await device.readTexture(t, 4))];
      return {
        got,
        want: image(4, 4, (_x, y) => (y === 0 ? [255, 255, 255, 255] : [0, 0, 0, 255])),
      };
    },
  },
  {
    name: "a texture's native object taken back with fromNative reads as the texture",
    covers: ['toNative', 'fromNative'],
    async run(device) {
      const tex = device.createTexture({
        size: [2, 1, 1],
        format: 'rgba8unorm',
        usage: ['sampled', 'copy-src', 'copy-dst'],
      });
      const bytes = [1, 2, 3, 4, 250, 251, 252, 253];
      device.writeTexture(tex, new Uint8Array(bytes), 8, 2, 1);
      const again = device.fromNative('texture', device.toNative(tex));
      if (again === undefined) return { got: [], want: bytes };
      return { got: [...(await device.readTexture(again, 4))], want: bytes };
    },
  },
  {
    name: 'a validation scope around the suite so far reports no error',
    covers: ['pushValidationScope', 'popValidationScope'],
    async run(device) {
      device.pushValidationScope();
      const b = device.createBuffer({ size: 16, usage: ['uniform', 'copy-dst'] });
      device.writeBuffer(b, 0, new Float32Array(4));
      device.destroyBuffer(b);
      const error = await device.popValidationScope();
      return { got: [error === null ? 0 : 1], want: [0] };
    },
  },
  {
    name: 'a compute dispatch that doubles a storage buffer',
    covers: ['createComputePipeline', 'beginComputePass', 'dispatchWorkgroups'],
    async run(device) {
      if (device.caps.compute !== 'native')
        return {
          skipped:
            'the backend runs a dispatch as a fragment pass of its own (change 0054), not as a compute pass',
        };
      const layout = device.createBindGroupLayout([
        { binding: 0, visibility: STAGE.compute, buffer: { type: 'storage' } },
      ]);
      const pipeline = await device.createComputePipeline({
        layouts: [layout],
        module:
          device.createShaderModule(`@group(0) @binding(0) var<storage, read_write> d: array<u32>;
@compute @workgroup_size(4) fn main(@builtin(global_invocation_id) g: vec3u) { d[g.x] = d[g.x] * 2u + 1u; }`),
        entryPoint: 'main',
      });
      const data = device.createBuffer({ size: 32, usage: ['storage', 'copy-src', 'copy-dst'] });
      const values = [1, 2, 3, 5, 8, 13, 21, 34];
      device.writeBuffer(data, 0, new Uint32Array(values));
      const read = device.createBuffer({ size: 32, usage: ['map-read', 'copy-dst'] });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup(layout, [{ binding: 0, resource: { buffer: data } }]),
      );
      pass.dispatchWorkgroups(2);
      pass.end();
      encoder.copyBufferToBuffer(data, 0, read, 0, 32);
      await device.submit([encoder]);
      const got = [...new Uint32Array(await device.readBuffer(read))];
      return { got, want: values.map((v) => v * 2 + 1) };
    },
  },
];

/** The members of the interface no case calls, each with where it is held instead. */
export const NOT_REACHED: Readonly<Record<string, string>> = {
  currentTexture:
    "a canvas is the host's: the compile gate draws the program runtime into a WebGPU and a WebGL2 canvas",
  destroy: 'it ends the device the suite runs on; createRuntime() and rt.destroy() hold it',
};

/** Every case of the suite on `device`, in order. A case that throws is a result whose `got` is
 *  absent and whose `skipped` is undefined: a failure, with the error as its name's suffix. */
export async function runConformance(device: RhiDevice): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  for (const c of CONFORMANCE) {
    try {
      const r = await c.run(device);
      out.push({ name: c.name, ...r });
    } catch (err) {
      out.push({ name: `${c.name}: threw ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return out;
}

/** The differences of one result: none for a skipped case or an exact answer. */
export function differences(r: CaseResult): string[] {
  if (r.skipped !== undefined) return [];
  if (r.got === undefined || r.want === undefined) return [`${r.name}: no answer`];
  if (r.got.length !== r.want.length)
    return [`${r.name}: ${r.got.length} numbers read back, ${r.want.length} expected`];
  const out: string[] = [];
  for (let i = 0; i < r.got.length; i++)
    if (!Object.is(r.got[i], r.want[i]) && r.got[i] !== r.want[i])
      out.push(`${r.name}: number ${i} is ${r.got[i]}, expected ${r.want[i]}`);
  return out;
}
