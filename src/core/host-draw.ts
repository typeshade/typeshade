// ═══ A fragment entry drawn from host code (Rule 8.24, surface §67) ═══
//
// `entry(target, bindings)` on a `@fragment` entry a host file imported (change 0016). The entry
// reads no builtin but its pixel's `position` and `front_facing`, and writes one `@location(0)`
// colour, so one full-screen triangle the runtime supplies draws it over the whole canvas. The
// Vite plugin writes everything the draw needs into the generated module at build time, as a
// `FragmentEntry` literal: the module's WGSL, the GLSL ES 3.00 fragment program where the WebGL2
// tier can draw it, and each binding the entry reaches, with its layout.
//
// Three tiers, and a canvas keeps the first one that draws into it, since a canvas keeps the
// first kind of context it hands out:
//
//   1. WebGPU, with the canvas's `webgpu` context.
//   2. WebGL2, with the entry's GLSL fragment program and the runtime's full-screen vertex
//      program. GLSL's `gl_FragCoord` counts rows from the bottom and WGSL's `position` from the
//      top, so the frame is drawn into a framebuffer and copied to the canvas upside down: the
//      first row the program draws is the canvas's top row, as it is on WebGPU.
//   3. The CPU tier: the generated code (Rule 11.7), pixel by pixel, into an `ImageData` put on
//      the canvas's `2d` context.
//
// The frame is opaque on every tier: the colour's alpha is written but not composited, so the
// three tiers show the same pixels. A draw reads nothing back (`docs/dx.md` principle 4): the
// promise resolves when the frame is submitted, and a frame loop may drop it.

import type { CpuValue } from './cpu-runtime.js';
import {
  checkBindings,
  describe,
  gpuDevice,
  gpuHandle,
  isBuffer,
  packed,
  toCpu,
  type Checked,
  type DrawBinding,
  type GeneratedCpu,
  type GpuDevice,
} from './host-entry.js';

// ─── what the generated module carries ───────────────────────────────────────────────────────

/** A full-screen `@fragment` entry a host can draw, as the generated module writes it. */
export interface FragmentEntry {
  readonly name: string;
  readonly fn: string;
  readonly wgsl: string;
  /** Each parameter's builtin, in order: `position` or `front_facing`. */
  readonly params: readonly string[];
  /** The struct field that holds the `@location(0)` colour, or null for a bare `vec4`. */
  readonly out: string | null;
  readonly bindings: readonly DrawBinding[];
  /** What the WebGL2 tier draws with; absent when it cannot draw the entry. */
  readonly gl?: {
    /** The GLSL ES 3.00 fragment program. */
    readonly frag: string;
    /** Each uniform binding's block name. */
    readonly blocks: Readonly<Record<string, string>>;
    /** Each texture binding's sampler binding, or null when it is only loaded. */
    readonly samplers: Readonly<Record<string, string | null>>;
  };
  /** Why the WebGL2 tier cannot draw the entry, when it cannot. */
  readonly noGl?: string;
  /** Why the CPU tier cannot draw the entry, when it cannot. */
  readonly noCpu?: string;
}

// ─── checking the arguments ──────────────────────────────────────────────────────────────────

/** One draw's arguments, checked and copied at the call, so a value the host changes before the
 *  queued draw runs does not change the frame. */
interface Frame extends Checked {
  /** Each buffer binding's packed bytes. */
  readonly bytes: Map<string, ArrayBuffer>;
  /** Each buffer binding's CPU-tier value, when the entry has a CPU tier. */
  readonly cpu: Map<string, CpuValue>;
}

function frameOf(e: FragmentEntry, v: unknown): Frame {
  const checked = checkBindings(e, v);
  const frame: Frame = { ...checked, bytes: new Map(), cpu: new Map() };
  for (const b of e.bindings) {
    if (!isBuffer(b)) continue;
    frame.bytes.set(b.name, packed(b, checked.values[b.name]));
    if (e.noCpu === undefined)
      frame.cpu.set(b.name, toCpu(b.layout, checked.values[b.name], false));
  }
  return frame;
}

// ─── the canvas ──────────────────────────────────────────────────────────────────────────────

/** The part of `HTMLCanvasElement` and `OffscreenCanvas` a draw uses. */
interface Canvas {
  width: number;
  height: number;
  getContext(kind: string, options?: object): unknown;
}

function isCanvas(v: unknown): v is Canvas {
  const g = globalThis as unknown as Record<string, (abstract new () => unknown) | undefined>;
  return ['HTMLCanvasElement', 'OffscreenCanvas'].some(
    (k) => g[k] !== undefined && v instanceof g[k],
  );
}

/** How one canvas draws, decided at its first draw. `prepare` builds what an entry needs on
 *  the tier (a pipeline, a program) once; `paint` draws and submits one frame synchronously, so
 *  the frame is submitted in the task that settles the draw's promise. */
interface Painter {
  prepare(e: FragmentEntry): Promise<void>;
  paint(e: FragmentEntry, cpu: GeneratedCpu, f: Frame): void;
}

interface CanvasState {
  /** Each draw runs after the one before it, so draws made before the device exists run in
   *  order once it does. */
  chain: Promise<unknown>;
  painter?: Promise<Painter>;
}

const canvases = new WeakMap<object, CanvasState>();

/**
 * Draw one frame of a full-screen `@fragment` entry into `target` (Rule 8.24): on WebGPU where
 * there is one, then WebGL2, then the CPU tier. The first draw into a canvas decides its tier.
 *
 * The promise resolves when the frame is submitted; nothing is read back.
 *
 * @throws `TypeError` naming the entry and the binding for a value that does not fit, and for an
 *   entry no tier can draw into this canvas.
 */
export function callDraw(
  cpu: GeneratedCpu,
  e: FragmentEntry,
  argc: number,
  target: unknown,
  bindings: unknown,
): Promise<void> {
  try {
    if (argc !== 2)
      throw new TypeError(`${e.name}() takes 2 arguments, (target, bindings); got ${argc}.`);
    if (!isCanvas(target))
      throw new TypeError(
        `${e.name}(): "target" is an HTMLCanvasElement or an OffscreenCanvas; got ${describe(target)}.`,
      );
    const frame = frameOf(e, bindings);
    let state = canvases.get(target);
    if (state === undefined) canvases.set(target, (state = { chain: Promise.resolve() }));
    const s = state;
    const run = s.chain.then(async () => {
      s.painter ??= painterFor(target, e);
      const painter = await s.painter;
      await painter.prepare(e);
      painter.paint(e, cpu, frame);
    });
    // A failed draw does not stop the draws after it.
    s.chain = run.catch(() => undefined);
    return run;
  } catch (err) {
    return Promise.reject(err);
  }
}

/** The canvas's tier: the first of WebGPU, WebGL2 and the CPU that can draw `first`, the entry
 *  that draws into the canvas first. */
async function painterFor(canvas: Canvas, first: FragmentEntry): Promise<Painter> {
  const d = await gpuDevice();
  if (d !== null) {
    const ctx = canvas.getContext('webgpu') as GpuCanvasContext | null;
    if (ctx !== null) return webgpuPainter(d as unknown as RenderDevice, ctx);
  }
  if (first.gl !== undefined) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    }) as Gl | null;
    if (gl !== null) return webgl2Painter(gl, canvas);
  }
  if (first.noCpu === undefined) {
    const c2d = canvas.getContext('2d', { alpha: false }) as Ctx2d | null;
    if (c2d !== null) return cpuPainter(c2d, canvas);
  }
  const why = [
    d === null ? 'there is no WebGPU' : 'the canvas hands out no webgpu context',
    first.gl === undefined ? `no WebGL2 tier (${first.noGl ?? 'unknown'})` : 'no webgl2 context',
    first.noCpu === undefined ? 'no 2d context' : `no CPU tier (${first.noCpu})`,
  ];
  throw new TypeError(`${first.name}(): nothing can draw it into this canvas: ${why.join('; ')}.`);
}

/** Why `e` cannot draw on a tier, as a `TypeError` naming the tiers it has. */
function noTier(e: FragmentEntry, tier: string, why: string | undefined): TypeError {
  return new TypeError(
    `${e.name}(): this canvas draws on ${tier}, and ${e.name} has no ${tier} tier: ${why ?? 'unknown'}.`,
  );
}

// ─── WebGPU, structurally ────────────────────────────────────────────────────────────────────

interface GpuTexture {
  createView(): unknown;
  destroy(): void;
}
interface GpuCanvasContext {
  configure(c: { device: unknown; format: string; alphaMode: 'opaque' }): void;
  getCurrentTexture(): GpuTexture;
}
interface RenderPipeline {
  getBindGroupLayout(index: number): unknown;
}
interface RenderDevice extends GpuDevice {
  createRenderPipeline(d: object): RenderPipeline;
  createTexture(d: object): GpuTexture;
  createSampler(d: object): unknown;
  createCommandEncoder(): ReturnType<GpuDevice['createCommandEncoder']> & {
    beginRenderPass(d: object): {
      setPipeline(p: RenderPipeline): void;
      setBindGroup(i: number, g: unknown): void;
      draw(n: number): void;
      end(): void;
    };
  };
  readonly queue: GpuDevice['queue'] & {
    writeTexture(dst: object, data: ArrayBufferView, layout: object, size: object): void;
    copyExternalImageToTexture(src: object, dst: object, size: object): void;
  };
}

/** `GPUBufferUsage`, whose values the WebGPU specification fixes. */
const BUFFER = { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 } as const;

/** The full-screen triangle: three vertices, counter-clockwise, covering clip space. */
const FULLSCREEN_WGSL = `@vertex fn v(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const renderPipelines = new WeakMap<object, Map<FragmentEntry, Promise<RenderPipeline>>>();

async function renderPipelineFor(
  d: RenderDevice,
  e: FragmentEntry,
  format: string,
): Promise<RenderPipeline> {
  let per = renderPipelines.get(d);
  if (per === undefined) renderPipelines.set(d, (per = new Map()));
  let p = per.get(e);
  if (p === undefined) {
    p = (async () => {
      const module = d.createShaderModule({ code: e.wgsl });
      const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === 'error');
      if (errors.length > 0)
        throw new Error(
          `${e.name}: WebGPU refused the module's WGSL: ${errors.map((m) => `line ${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`,
        );
      return d.createRenderPipeline({
        layout: 'auto',
        vertex: { module: d.createShaderModule({ code: FULLSCREEN_WGSL }), entryPoint: 'v' },
        fragment: { module, entryPoint: e.fn, targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
    })();
    per.set(e, p);
  }
  return p;
}

function webgpuPainter(d: RenderDevice, ctx: GpuCanvasContext): Painter {
  const nav = (globalThis as { navigator?: { gpu?: { getPreferredCanvasFormat(): string } } })
    .navigator;
  const format = nav?.gpu?.getPreferredCanvasFormat() ?? 'bgra8unorm';
  ctx.configure({ device: d, format, alphaMode: 'opaque' });
  const ready = new Map<FragmentEntry, RenderPipeline>();
  const prepare = async (e: FragmentEntry): Promise<void> => {
    if (!ready.has(e)) ready.set(e, await renderPipelineFor(d, e, format));
  };
  const paint: Painter['paint'] = (e, _cpu, f) => {
    const pipeline = ready.get(e)!;
    const resources = new Map<string, unknown>();
    const owned: { destroy(): void }[] = [];
    for (const b of e.bindings) {
      if (isBuffer(b)) {
        const bytes = f.bytes.get(b.name)!;
        const buffer = d.createBuffer({
          size: bytes.byteLength,
          usage: (b.space === 'uniform' ? BUFFER.UNIFORM : BUFFER.STORAGE) | BUFFER.COPY_DST,
        });
        d.queue.writeBuffer(buffer, 0, bytes);
        owned.push(buffer);
        resources.set(b.name, { buffer });
      } else {
        resources.set(b.name, gpuHandle(d, b, f, owned));
      }
    }
    const encoder = d.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    for (const g of [...new Set(e.bindings.map((b) => b.group))].sort((a, b) => a - b))
      pass.setBindGroup(
        g,
        d.createBindGroup({
          layout: pipeline.getBindGroupLayout(g),
          entries: e.bindings
            .filter((b) => b.group === g)
            .map((b) => ({ binding: b.binding, resource: resources.get(b.name) as never })),
        }),
      );
    pass.draw(3);
    pass.end();
    d.queue.submit([encoder.finish()]);
    for (const o of owned) o.destroy();
  };
  return { prepare, paint };
}

// ─── WebGL2, structurally ────────────────────────────────────────────────────────────────────

/** The part of `WebGL2RenderingContext` a draw uses; the constants are the specification's. */
interface Gl {
  createShader(t: number): object | null;
  shaderSource(s: object, src: string): void;
  compileShader(s: object): void;
  getShaderParameter(s: object, p: number): unknown;
  getShaderInfoLog(s: object): string | null;
  createProgram(): object | null;
  attachShader(p: object, s: object): void;
  linkProgram(p: object): void;
  getProgramParameter(p: object, n: number): unknown;
  getProgramInfoLog(p: object): string | null;
  useProgram(p: object | null): void;
  getUniformBlockIndex(p: object, name: string): number;
  uniformBlockBinding(p: object, index: number, binding: number): void;
  getUniformLocation(p: object, name: string): object | null;
  uniform1i(l: object | null, v: number): void;
  createBuffer(): object | null;
  bindBuffer(t: number, b: object | null): void;
  bufferData(t: number, data: ArrayBuffer, usage: number): void;
  bindBufferBase(t: number, i: number, b: object | null): void;
  createTexture(): object | null;
  activeTexture(unit: number): void;
  bindTexture(t: number, tex: object | null): void;
  texImage2D(
    t: number,
    level: number,
    internal: number,
    format: number,
    type: number,
    source: object,
  ): void;
  texParameteri(t: number, p: number, v: number): void;
  pixelStorei(p: number, v: number | boolean): void;
  createFramebuffer(): object | null;
  bindFramebuffer(t: number, f: object | null): void;
  framebufferTexture2D(t: number, a: number, tt: number, tex: object | null, level: number): void;
  texStorage2D(t: number, levels: number, internal: number, w: number, h: number): void;
  deleteTexture(t: object | null): void;
  deleteBuffer(b: object | null): void;
  createVertexArray(): object | null;
  bindVertexArray(v: object | null): void;
  viewport(x: number, y: number, w: number, h: number): void;
  clearColor(r: number, g: number, b: number, a: number): void;
  clear(mask: number): void;
  drawArrays(mode: number, first: number, count: number): void;
  blitFramebuffer(
    sx0: number,
    sy0: number,
    sx1: number,
    sy1: number,
    dx0: number,
    dy0: number,
    dx1: number,
    dy1: number,
    mask: number,
    filter: number,
  ): void;
}

const GL = {
  FRAGMENT_SHADER: 0x8b30,
  VERTEX_SHADER: 0x8b31,
  COMPILE_STATUS: 0x8b81,
  LINK_STATUS: 0x8b82,
  UNIFORM_BUFFER: 0x8a11,
  STREAM_DRAW: 0x88e0,
  TEXTURE_2D: 0x0de1,
  TEXTURE0: 0x84c0,
  RGBA: 0x1908,
  RGBA8: 0x8058,
  UNSIGNED_BYTE: 0x1401,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  NEAREST: 0x2600,
  LINEAR: 0x2601,
  CLAMP_TO_EDGE: 0x812f,
  REPEAT: 0x2901,
  MIRRORED_REPEAT: 0x8370,
  UNPACK_FLIP_Y_WEBGL: 0x9240,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
  FRAMEBUFFER: 0x8d40,
  READ_FRAMEBUFFER: 0x8ca8,
  DRAW_FRAMEBUFFER: 0x8ca9,
  COLOR_ATTACHMENT0: 0x8ce0,
  COLOR_BUFFER_BIT: 0x4000,
  TRIANGLES: 0x0004,
} as const;

/** The full-screen triangle's vertex program. Its depth is the near plane, so `gl_FragCoord.z`
 *  is 0, as WGSL's `position.z` is for the WebGPU tier's triangle. */
const FULLSCREEN_GLSL = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, -1.0, 1.0);
}`;

interface GlProgram {
  readonly program: object;
  readonly blocks: readonly { name: string; index: number }[];
  readonly textures: readonly { name: string; location: object | null }[];
}

function compileGl(gl: Gl, e: FragmentEntry): GlProgram {
  const shader = (type: number, src: string): object => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (gl.getShaderParameter(s, GL.COMPILE_STATUS) !== true)
      throw new Error(`${e.name}: WebGL2 refused the GLSL: ${gl.getShaderInfoLog(s) ?? ''}`);
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(GL.VERTEX_SHADER, FULLSCREEN_GLSL));
  gl.attachShader(program, shader(GL.FRAGMENT_SHADER, e.gl!.frag));
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, GL.LINK_STATUS) !== true)
    throw new Error(`${e.name}: WebGL2 refused the GLSL: ${gl.getProgramInfoLog(program) ?? ''}`);
  const blocks = Object.entries(e.gl!.blocks).map(([name, block], i) => {
    const index = gl.getUniformBlockIndex(program, block);
    gl.uniformBlockBinding(program, index, i);
    return { name, index };
  });
  const textures = Object.keys(e.gl!.samplers).map((name) => ({
    name,
    location: gl.getUniformLocation(program, name),
  }));
  return { program, blocks, textures };
}

const GL_WRAP = { clamp: GL.CLAMP_TO_EDGE, repeat: GL.REPEAT, mirror: GL.MIRRORED_REPEAT } as const;

function webgl2Painter(gl: Gl, canvas: Canvas): Painter {
  const programs = new Map<FragmentEntry, GlProgram>();
  const vao = gl.createVertexArray();
  let target: { fbo: object | null; tex: object | null; w: number; h: number } | undefined;
  const prepare = (e: FragmentEntry): Promise<void> => {
    if (e.gl === undefined) return Promise.reject(noTier(e, 'WebGL2', e.noGl));
    if (!programs.has(e)) programs.set(e, compileGl(gl, e));
    return Promise.resolve();
  };
  const paint: Painter['paint'] = (e, _cpu, f) => {
    const p = programs.get(e)!;
    const { width: w, height: h } = canvas;
    if (target === undefined || target.w !== w || target.h !== h) {
      if (target !== undefined) gl.deleteTexture(target.tex);
      const tex = gl.createTexture();
      gl.bindTexture(GL.TEXTURE_2D, tex);
      gl.texStorage2D(GL.TEXTURE_2D, 1, GL.RGBA8, w, h);
      const fbo = target?.fbo ?? gl.createFramebuffer();
      gl.bindFramebuffer(GL.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, tex, 0);
      target = { fbo, tex, w, h };
    }
    gl.bindFramebuffer(GL.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(GL.COLOR_BUFFER_BIT);
    gl.useProgram(p.program);
    const owned: object[] = [];
    p.blocks.forEach(({ name }, i) => {
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(GL.UNIFORM_BUFFER, buffer);
      gl.bufferData(GL.UNIFORM_BUFFER, f.bytes.get(name)!, GL.STREAM_DRAW);
      gl.bindBufferBase(GL.UNIFORM_BUFFER, i, buffer);
      owned.push(buffer);
    });
    const textures: object[] = [];
    p.textures.forEach(({ name, location }, unit) => {
      const img = f.images.get(name)!;
      const smp = e.gl!.samplers[name];
      const s = (smp !== null && smp !== undefined ? f.samplers.get(smp) : undefined) ?? {
        filter: 'nearest',
        address: 'clamp',
      };
      const tex = gl.createTexture()!;
      gl.activeTexture(GL.TEXTURE0 + unit);
      gl.bindTexture(GL.TEXTURE_2D, tex);
      // The first row of the image is texture coordinate 0, as it is on WebGPU.
      gl.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, img.source);
      const filter = s.filter === 'nearest' ? GL.NEAREST : GL.LINEAR;
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, GL_WRAP[s.address]);
      gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, GL_WRAP[s.address]);
      gl.uniform1i(location, unit);
      textures.push(tex);
    });
    gl.bindVertexArray(vao);
    gl.drawArrays(GL.TRIANGLES, 0, 3);
    // `gl_FragCoord` counts rows from the bottom: copy the frame upside down, so the program's
    // first row is the canvas's top row, as WGSL's `position` has it.
    gl.bindFramebuffer(GL.READ_FRAMEBUFFER, target.fbo);
    gl.bindFramebuffer(GL.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, w, h, 0, h, w, 0, GL.COLOR_BUFFER_BIT, GL.NEAREST);
    for (const b of owned) gl.deleteBuffer(b);
    for (const t of textures) gl.deleteTexture(t);
  };
  return { prepare, paint };
}

// ─── the CPU tier ────────────────────────────────────────────────────────────────────────────

interface Ctx2d {
  createImageData(w: number, h: number): { data: Uint8ClampedArray };
  putImageData(img: object, x: number, y: number): void;
}

function cpuPainter(c2d: Ctx2d, canvas: Canvas): Painter {
  const prepare = (e: FragmentEntry): Promise<void> =>
    e.noCpu !== undefined ? Promise.reject(noTier(e, 'the CPU', e.noCpu)) : Promise.resolve();
  const paint: Painter['paint'] = (e, cpu, f) => {
    const { width: w, height: h } = canvas;
    for (const [name, v] of f.cpu) cpu.$.bindings[name] = v;
    const fn = cpu.F[e.fn]!;
    const init = cpu.F['$initPrivates'];
    const img = c2d.createImageData(w, h);
    const px = img.data;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const args = e.params.map(
          (p): CpuValue =>
            (p === 'position' ? [x + 0.5, y + 0.5, 0, 1] : true) as unknown as CpuValue,
        );
        init?.();
        const r = fn(...args) as unknown;
        const at = 4 * (y * w + x);
        // A discarded pixel keeps the clear colour, opaque black.
        const c =
          r === undefined
            ? undefined
            : ((e.out === null ? r : (r as Record<string, unknown>)[e.out]) as number[]);
        for (let i = 0; i < 3; i++)
          px[at + i] = c === undefined ? 0 : Math.round(clamp01(c[i]!) * 255);
        px[at + 3] = 255;
      }
    c2d.putImageData(img, 0, 0);
  };
  return { prepare, paint };
}

const clamp01 = (x: number): number => (x > 1 ? 1 : x > 0 ? x : 0);
