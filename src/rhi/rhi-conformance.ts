import { STAGE, type RhiBindLayoutEntry, type RhiDevice, type RhiTexture } from './rhi.js';

export interface CaseResult {
  readonly name: string;
  readonly got?: readonly number[];
  readonly want?: readonly number[];
  readonly skipped?: string;
}

export interface ConformanceCase {
  readonly name: string;
  readonly covers: readonly string[];
  readonly refusedOnCpu?: string;
  run(device: RhiDevice): Promise<{ got: number[]; want: number[] } | { skipped: string }>;
}

const FULL_SCREEN_WGSL = `@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FULL_SCREEN_SHADE = `@vertex export function vs(i: builtin<"vertex_index">): builtin<"position"> {
  const p = vec2(f32((i << u32(1)) & u32(2)), f32(i & u32(2)));
  return vec4(p * 2. - vec2(1., 1.), 0., 1.);
}`;

const FULL_SCREEN_GLSL = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

interface Programs {
  readonly wgsl: string;
  readonly vertex: string;
  readonly fragment: string;
  readonly shade: string;
}

const programOf = (device: RhiDevice, programs: Programs): string =>
  device.caps.shaderLanguage === 'glsl-es300'
    ? programs.vertex
    : device.caps.shaderLanguage === 'cpu'
      ? programs.shade
      : programs.wgsl;

async function pipelineOf(
  device: RhiDevice,
  programs: Programs,
  entries: readonly RhiBindLayoutEntry[],
  extra: {
    readonly buffers?: Parameters<RhiDevice['createRenderPipeline']>[0]['vertex']['buffers'];
    readonly depth?: boolean;
    readonly blend?: object;
    readonly cullMode?: 'none' | 'front' | 'back';
    readonly topology?: string;
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
  const module = device.createShaderModule(programOf(device, programs));
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
    primitive: {
      topology: extra.topology ?? 'triangle-list',
      cullMode: extra.cullMode ?? 'none',
      frontFace: 'ccw',
    },
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

const target = (device: RhiDevice, w: number, h: number): RhiTexture =>
  device.createTexture({
    size: [w, h, 1],
    format: 'rgba8unorm',
    usage: ['render', 'sampled', 'copy-src', 'copy-dst'],
  });

function uniform(device: RhiDevice, floats: readonly number[]) {
  const b = device.createBuffer({ size: floats.length * 4, usage: ['uniform', 'copy-dst'] });
  device.writeBuffer(b, 0, new Float32Array(floats));
  return b;
}

function image(w: number, h: number, texel: (x: number, y: number) => readonly number[]): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(...texel(x, y));
  return out;
}

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
  shade: `"use typeshade";
class U {
  c: vec4;
}
declare const u: uniform<U>;
${FULL_SCREEN_SHADE}
@fragment export function fs(): vec4 {
  return u.c;
}
`,
};

const UNIFORM_ENTRY: RhiBindLayoutEntry = {
  binding: 0,
  visibility: STAGE.vertex | STAGE.fragment,
  name: 'U',
  label: 'U',
  buffer: { type: 'uniform' },
};

const VERTEX_Q: Programs = {
  wgsl: `struct U { c: vec4f }
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@location(0) q: vec2f) -> @builtin(position) vec4f { return vec4f(q, 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return u.c; }`,
  vertex: `#version 300 es
layout(location = 0) in vec2 q;
void main() { gl_Position = vec4(q, 0.0, 1.0); }
`,
  fragment: UNIFORM_COLOUR.fragment,
  shade: `"use typeshade";
class U {
  c: vec4;
}
declare const u: uniform<U>;
@vertex export function vs(q: location<0, vec2>): builtin<"position"> {
  return vec4(q, 0., 1.);
}
@fragment export function fs(): vec4 {
  return u.c;
}
`,
};

const INTERPOLATED: Programs = {
  wgsl: `struct V {
  @builtin(position) p: vec4f,
  @location(0) a: f32,
  @location(1) @interpolate(linear) b: f32,
  @location(2) @interpolate(flat) f: f32,
}
@vertex fn vs(@location(0) p: vec4f, @location(1) v: vec3f) -> V { return V(p, v.x, v.y, v.z); }
@fragment fn fs(i: V) -> @location(0) vec4f { return vec4f(i.a, i.b, i.f, 1.0); }`,
  vertex: `#version 300 es
layout(location = 0) in vec4 p;
layout(location = 1) in vec3 v;
out float a;
out float bq;
out float bw;
flat out float f;
void main() { gl_Position = p; a = v.x; bq = v.y * p.w; bw = p.w; f = v.z; }
`,
  fragment: `#version 300 es
precision highp float;
in float a;
in float bq;
in float bw;
flat in float f;
layout(location = 0) out vec4 o;
void main() { o = vec4(a, bq / bw, f, 1.0); }
`,
  shade: `"use typeshade";
interface V {
  p: builtin<"position">;
  a: location<0, f32>;
  b: location<1, f32, { interpolate: "linear" }>;
  f: location<2, f32, { interpolate: "flat" }>;
}
@vertex export function vs(p: location<0, vec4>, v: location<1, vec3>): V {
  return { p: p, a: v.x, b: v.y, f: v.z };
}
@fragment export function fs(i: V): vec4 {
  return vec4(i.a, i.b, i.f, 1.);
}
`,
};

const NUMBERS = [0.8671875, 0.42578125, 0.01953125] as const;
const FLAT = [0.6, 0.2, 1] as const;
const SAME = [0.6, 0.6, 0.6] as const;

async function interpolatedFrame(
  device: RhiDevice,
  w: readonly [number, number, number],
  z: (y: number) => number,
  flat: readonly [number, number, number] = SAME,
): Promise<number[]> {
  const ndc = [
    [-1, -1],
    [3, -1],
    [-1, 3],
  ] as const;
  const t = target(device, 8, 8);
  const { pipeline, layout } = await pipelineOf(device, INTERPOLATED, [], {
    buffers: [
      {
        arrayStride: 28,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x4' },
          { shaderLocation: 1, offset: 16, format: 'float32x3' },
        ],
      },
    ],
  });
  const data = ndc.flatMap(([x, y], i) => [
    x * w[i]!,
    y * w[i]!,
    z(y) * w[i]!,
    w[i]!,
    NUMBERS[i]!,
    NUMBERS[i]!,
    flat[i]!,
  ]);
  const vertices = device.createBuffer({ size: 84, usage: ['vertex', 'copy-dst'] });
  device.writeBuffer(vertices, 0, new Float32Array(data));
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: device.createView(t), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, device.createBindGroup(layout, []));
  pass.setVertexBuffer(0, vertices);
  pass.draw(3);
  pass.end();
  await device.submit([encoder]);
  return [...(await device.readTexture(t, 4))];
}

function interpolatedTexel(w: readonly number[], x: number, y: number): number[] {
  const nx = (x + 0.5) / 4 - 1;
  const ny = 1 - (y + 0.5) / 4;
  const l = [0, (nx + 1) / 4, (ny + 1) / 4];
  l[0] = 1 - l[1]! - l[2]!;
  const perspective =
    l.reduce((s, li, i) => s + (li * NUMBERS[i]!) / w[i]!, 0) /
    l.reduce((s, li, i) => s + li / w[i]!, 0);
  const linear = l.reduce((s, li, i) => s + li * NUMBERS[i]!, 0);
  return [unorm8(perspective), unorm8(linear), unorm8(SAME[0]), 255];
}

const QUAD_FLAT = [0.6, 0.2, 1, 0.4] as const;

async function flatQuadFrame(device: RhiDevice, indices?: readonly number[]): Promise<number[]> {
  const ndc = [
    [-1, -1],
    [1.125, -1],
    [-1, 1.125],
    [1.125, 1.125],
  ] as const;
  const t = target(device, 8, 8);
  const { pipeline, layout } = await pipelineOf(device, INTERPOLATED, [], {
    buffers: [
      {
        arrayStride: 28,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x4' },
          { shaderLocation: 1, offset: 16, format: 'float32x3' },
        ],
      },
    ],
    ...(indices === undefined ? { topology: 'triangle-strip' } : {}),
  });
  const data = ndc.flatMap(([x, y], i) => [x, y, 0.25, 1, NUMBERS[0], NUMBERS[1], QUAD_FLAT[i]!]);
  const vertices = device.createBuffer({ size: 112, usage: ['vertex', 'copy-dst'] });
  device.writeBuffer(vertices, 0, new Float32Array(data));
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      { view: device.createView(t), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, device.createBindGroup(layout, []));
  pass.setVertexBuffer(0, vertices);
  if (indices === undefined) pass.draw(4);
  else {
    const buffer = device.createBuffer({ size: indices.length * 2, usage: ['index', 'copy-dst'] });
    device.writeBuffer(buffer, 0, new Uint16Array(indices));
    pass.setIndexBuffer(buffer, 'uint16');
    pass.drawIndexed(indices.length);
  }
  pass.end();
  await device.submit([encoder]);
  return [...(await device.readTexture(t, 4))];
}

const flatQuadImage = (below: number, above: number): number[] =>
  image(8, 8, (x, y) => [
    unorm8(NUMBERS[0]),
    unorm8(NUMBERS[1]),
    unorm8(x - y < 0.5 ? below : above),
    255,
  ]);

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
          shade: `"use typeshade";
${FULL_SCREEN_SHADE}
@fragment export function fs(p: builtin<"position">): vec4 {
  return vec4(floor(p.x) / 255., floor(p.y) / 255., 0., 1.);
}
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
          shade: `"use typeshade";
declare const colours: storage<array<vec4>>;
interface Out {
  p: builtin<"position">;
  c: location<0, vec4, { interpolate: "flat" }>;
}
@vertex export function vs(q: location<0, vec2>, k: builtin<"instance_index">): Out {
  return { p: vec4(q.x + f32(k), q.y, 0., 1.), c: colours[k] };
}
@fragment export function fs(c: location<0, vec4, { interpolate: "flat" }>): vec4 {
  return c;
}
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
    refusedOnCpu: 'which the CPU tier does not support yet (Rule 8.24, Rule 11.7)',
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
          shade: `"use typeshade";
declare const tex: texture_2d<f32>;
declare const smp: sampler;
${FULL_SCREEN_SHADE}
@fragment export function fs(p: builtin<"position">): vec4 {
  return textureSample(tex, smp, p.xy / 4.);
}
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
    refusedOnCpu: 'a depth or stencil test',
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
          shade: `"use typeshade";
class U {
  c: vec4;
  z: vec4;
}
declare const u: uniform<U>;
@vertex export function vs(i: builtin<"vertex_index">): builtin<"position"> {
  const p = vec2(f32((i << u32(1)) & u32(2)), f32(i & u32(2)));
  return vec4(p * 2. - vec2(1., 1.), u.z.x, 1.);
}
@fragment export function fs(): vec4 {
  return u.c;
}
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
    refusedOnCpu: 'blending',
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
      const { pipeline, layout } = await pipelineOf(
        device,
        {
          wgsl: VERTEX_Q.wgsl,
          vertex: VERTEX_Q.vertex,
          fragment: UNIFORM_COLOUR.fragment,
          shade: VERTEX_Q.shade,
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
      const want = image(4, 4, (x, y) =>
        y + 0.5 > 2 * (x + 0.5) ? [255, 255, 255, 255] : [0, 0, 0, 255],
      );
      return { got, want };
    },
  },
  {
    name: 'a stencil reference: written where a draw passes, then tested equal',
    covers: ['setStencilReference'],
    refusedOnCpu: 'a depth or stencil test',
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
        module: device.createShaderModule(
          device.caps.shaderLanguage === 'cpu'
            ? `"use typeshade";
declare const d: storage<array<u32>, "read_write">;
@compute([4, 1, 1]) export function main(g: builtin<"global_invocation_id">): void {
  d[g.x] = d[g.x] * u32(2) + u32(1);
}
`
            : `@group(0) @binding(0) var<storage, read_write> d: array<u32>;
@compute @workgroup_size(4) fn main(@builtin(global_invocation_id) g: vec3u) { d[g.x] = d[g.x] * 2u + 1u; }`,
        ),
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
  {
    name: 'an indirect compute dispatch, its counts read from a buffer at an offset',
    covers: ['beginComputePass', 'dispatchWorkgroupsIndirect'],
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
        module: device.createShaderModule(
          device.caps.shaderLanguage === 'cpu'
            ? `"use typeshade";
declare const d: storage<array<u32>, "read_write">;
@compute([2, 1, 1]) export function main(g: builtin<"global_invocation_id">): void {
  d[g.x] = d[g.x] + u32(100);
}
`
            : `@group(0) @binding(0) var<storage, read_write> d: array<u32>;
@compute @workgroup_size(2) fn main(@builtin(global_invocation_id) g: vec3u) { d[g.x] = d[g.x] + 100u; }`,
        ),
        entryPoint: 'main',
      });
      const data = device.createBuffer({ size: 32, usage: ['storage', 'copy-src', 'copy-dst'] });
      const values = [1, 2, 3, 5, 8, 13, 21, 34];
      device.writeBuffer(data, 0, new Uint32Array(values));
      const counts = device.createBuffer({ size: 16, usage: ['indirect', 'copy-dst'] });
      device.writeBuffer(counts, 0, new Uint32Array([7, 3, 1, 1]));
      const read = device.createBuffer({ size: 32, usage: ['map-read', 'copy-dst'] });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        device.createBindGroup(layout, [{ binding: 0, resource: { buffer: data } }]),
      );
      pass.dispatchWorkgroupsIndirect(counts, 4);
      pass.end();
      encoder.copyBufferToBuffer(data, 0, read, 0, 32);
      await device.submit([encoder]);
      const got = [...new Uint32Array(await device.readBuffer(read))];
      return { got, want: values.map((v, i) => (i < 6 ? v + 100 : v)) };
    },
  },
  {
    name: 'interpolation: perspective-correct, and linear in screen space',
    covers: ['draw'],
    async run(device) {
      const w = [1, 2, 4] as const;
      const got = await interpolatedFrame(device, w, () => 0.25);
      return { got, want: image(8, 8, (x, y) => interpolatedTexel(w, x, y)) };
    },
  },
  {
    name: "interpolation: flat, from the first vertex of the triangle (WebGPU's provoking vertex)",
    covers: ['draw'],
    async run(device) {
      const w = [1, 2, 4] as const;
      const got = await interpolatedFrame(device, w, () => 0.25, FLAT);
      return { got, want: image(8, 8, (x, y) => interpolatedTexel(w, x, y)) };
    },
  },
  {
    name: 'interpolation: flat on an indexed list, from the first index of each triangle',
    covers: ['drawIndexed'],
    async run(device) {
      const got = await flatQuadFrame(device, [0, 1, 2, 2, 1, 3]);
      return { got, want: flatQuadImage(QUAD_FLAT[0], QUAD_FLAT[2]) };
    },
  },
  {
    name: 'interpolation: flat on a triangle strip, from the first vertex of each triangle',
    covers: ['draw'],
    refusedOnCpu: 'topology',
    async run(device) {
      const got = await flatQuadFrame(device);
      return { got, want: flatQuadImage(QUAD_FLAT[0], QUAD_FLAT[1]) };
    },
  },
  {
    name: 'clipping: a triangle cut by the near and the far plane keeps the values between them',
    covers: ['draw'],
    async run(device) {
      const w = [1, 2, 1] as const;
      const got = await interpolatedFrame(device, w, (y) => 0.5 - y);
      const want = image(8, 8, (x, y) =>
        y >= 2 && y < 6 ? interpolatedTexel(w, x, y) : [0, 0, 0, 255],
      );
      return { got, want };
    },
  },
  {
    name: 'the fill rule: two triangles that share an edge through pixel centres cover each once',
    covers: ['draw'],
    async run(device) {
      const t = target(device, 4, 4);
      const { pipeline, layout } = await pipelineOf(device, VERTEX_Q, [UNIFORM_ENTRY], {
        buffers: [
          { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
        ],
      });
      const fb = [0.5, 0.5, 2.5, 0.5, 0.5, 2.5, 2.5, 0.5, 2.5, 2.5, 0.5, 2.5];
      const ndc = fb.map((v, i) => (i % 2 === 0 ? v / 2 - 1 : 1 - v / 2));
      const vertices = device.createBuffer({ size: 48, usage: ['vertex', 'copy-dst'] });
      device.writeBuffer(vertices, 0, new Float32Array(ndc));
      const red = uniform(device, [1, 0, 0, 1]);
      const green = uniform(device, [0, 1, 0, 1]);
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
      pass.setVertexBuffer(0, vertices);
      pass.setBindGroup(
        0,
        device.createBindGroup(layout, [{ binding: 0, resource: { buffer: red } }]),
      );
      pass.draw(3);
      pass.end();
      const second = device.createBuffer({ size: 24, usage: ['vertex', 'copy-dst'] });
      device.writeBuffer(second, 0, new Float32Array(ndc.slice(6)));
      const pass2 = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: device.createView(t),
            loadOp: 'load',
            storeOp: 'store',
            clearValue: [0, 0, 0, 0],
          },
        ],
      });
      pass2.setPipeline(pipeline);
      pass2.setVertexBuffer(0, second);
      pass2.setBindGroup(
        0,
        device.createBindGroup(layout, [{ binding: 0, resource: { buffer: green } }]),
      );
      pass2.draw(3);
      pass2.end();
      await device.submit([encoder]);
      const got = [...(await device.readTexture(t, 4))];
      const reds = new Set(['0,0', '1,0', '0,1']);
      const want = image(4, 4, (x, y) =>
        reds.has(`${x},${y}`)
          ? [255, 0, 0, 255]
          : x === 1 && y === 1
            ? [0, 255, 0, 255]
            : [0, 0, 0, 255],
      );
      return { got, want };
    },
  },
  {
    name: 'front_facing: true for a counter-clockwise triangle in clip space, false for a clockwise one',
    covers: ['draw'],
    async run(device) {
      const t = target(device, 4, 4);
      const { pipeline, layout } = await pipelineOf(
        device,
        {
          wgsl: `@vertex fn vs(@location(0) q: vec2f) -> @builtin(position) vec4f { return vec4f(q, 0.0, 1.0); }
@fragment fn fs(@builtin(front_facing) f: bool) -> @location(0) vec4f {
  return select(vec4f(0.4, 0.4, 0.4, 1.0), vec4f(1.0, 1.0, 1.0, 1.0), f);
}`,
          vertex: VERTEX_Q.vertex,
          fragment: `#version 300 es
precision highp float;
layout(location = 0) out vec4 o;
void main() { o = gl_FrontFacing ? vec4(1.0) : vec4(0.4, 0.4, 0.4, 1.0); }
`,
          shade: `"use typeshade";
@vertex export function vs(q: location<0, vec2>): builtin<"position"> {
  return vec4(q, 0., 1.);
}
@fragment export function fs(f: builtin<"front_facing">): vec4 {
  if (f) {
    return vec4(1., 1., 1., 1.);
  }
  return vec4(0.4, 0.4, 0.4, 1.);
}
`,
        },
        [],
        {
          buffers: [
            { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          ],
        },
      );
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
      pass.setBindGroup(0, device.createBindGroup(layout, []));
      pass.setVertexBuffer(0, vertices);
      pass.draw(6);
      pass.end();
      await device.submit([encoder]);
      const got = [...(await device.readTexture(t, 4))];
      const want = image(4, 4, (x, y) => {
        const cx = x + 0.5;
        const cy = y + 0.5;
        if (cy > 2 * cx) return [255, 255, 255, 255];
        if (cx > 2 && cx < 2 + cy / 2) return [102, 102, 102, 255];
        return [0, 0, 0, 255];
      });
      return { got, want };
    },
  },
];

export const NOT_REACHED: Readonly<Record<string, string>> = {
  currentTexture:
    "a canvas is the host's: the compile gate draws the program runtime into a WebGPU and a WebGL2 canvas",
  destroy: 'it ends the device the suite runs on; createRuntime() and rt.destroy() hold it',
};

export async function runConformance(device: RhiDevice): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  const cpu = device.caps.shaderLanguage === 'cpu';
  for (const c of CONFORMANCE) {
    const refused = cpu ? c.refusedOnCpu : undefined;
    try {
      const r = await c.run(device);
      out.push(
        refused === undefined
          ? { name: c.name, ...r }
          : { name: `${c.name}: ran, and the CPU backend refuses it ("${refused}")` },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.push(
        refused !== undefined && message.includes(refused)
          ? { name: c.name, skipped: `refused: ${message}` }
          : { name: `${c.name}: threw ${message}` },
      );
    }
  }
  return out;
}

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
