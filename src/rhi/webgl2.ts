// Why: the position is flipped in y and its depth moved from 0..w to -w..w so that a texture's rows,
// a fragment's `position` and a stored depth are WebGPU's; only the compile gate holds this on a real context.
//
// Buffers. A storage buffer is a data texture the draw programs read (change 0046), as X-GIS's
// `storage-data-texture.ts` makes one, with the element type the buffer carries
// (`elem`). Each buffer keeps its bytes on the host.
//
// Immediate. WebGL2 has no command buffer, so the encoder runs each command when it is recorded
// (`caps.immediate`), as X-GIS's WebGL2 encoder does. A pass is begun, drawn and ended at its
// record, and `submit` has nothing left to run. A read of a texture waits on a fence.
//
// Flat values. WebGPU takes a `flat` interstage value from the first vertex of a primitive, and
// GLSL ES 3.00 from the last. A pipeline whose vertex program declares a `flat out` draws with the
// first vertex: with `WEBGL_provoking_vertex` where the context has it, set for the pass and given
// back at its end, and otherwise through an element buffer of its own that names each triangle's
// first vertex last (`firstVertexLast`), which draws the same triangles. A line has no such form,
// since a line turned round covers other pixels at its ends, so without the extension a line
// pipeline with a flat value is refused.
//
// Binding by name. A program reads a uniform block, a texture or a data texture by the name it
// declares, which a bind group layout entry carries (`name`), and GLSL ES 3.00 fuses a texture with
// one sampler (`samplerBinding`). The pipeline gives each binding its block binding point or texture unit
// once, when it is linked; a draw binds the bind groups set on the pass to those units.

import { compile, gpuDone } from '../core/gl-compute.js';
import { glUniformBytes } from '../core/gl-uniform-bytes.js';
import type {
  RhiBindEntry,
  RhiBindGroup,
  RhiBindGroupLayout,
  RhiBindLayoutEntry,
  RhiBuffer,
  RhiBufferDesc,
  RhiBufferUsage,
  RhiCanvas,
  RhiCaps,
  RhiColorAttachment,
  RhiCommandEncoder,
  RhiComputePass,
  RhiComputePipeline,
  RhiDepthStencilAttachment,
  RhiDevice,
  RhiNativeKinds,
  RhiRenderPass,
  RhiRenderPassDesc,
  RhiRenderPipeline,
  RhiRenderPipelineDesc,
  RhiSampler,
  RhiSamplerDesc,
  RhiShaderModule,
  RhiTexture,
  RhiTextureDesc,
  RhiTextureView,
  RhiVertexBufferLayout,
} from './rhi.js';
import type { GL, GlTextureKind } from './webgl2/types.js';
import { formatOf, type GlFormat } from './webgl2/format.js';
import { GlState } from './webgl2/state.js';
import { compareOf, drawStateOf, setState, type DrawState } from './webgl2/draw-state.js';
import { dataTexture } from './webgl2/data-texture.js';
export { DATA_WIDTH } from './webgl2/data-texture.js';
export { GL_TOPOLOGY, GL_BLEND_FACTOR, GL_BLEND_OPERATION } from './webgl2/draw-state.js';
export { textureKindOf } from './webgl2/format.js';
export type { GlTextureKind } from './webgl2/types.js';

class GlBuffer implements RhiBuffer {
  readonly __rhi = 'buffer' as const;
  staleBuffer = true;
  staleTexture = true;
  padded = -1;
  texture: WebGLTexture | undefined;
  first: { readonly native: WebGLBuffer; key: string; count: number } | undefined;

  constructor(
    readonly size: number,
    readonly usage: ReadonlySet<RhiBufferUsage>,
    readonly elem: 'f32' | 'i32' | 'u32',
    readonly bytes: Uint8Array | undefined,
    readonly native: WebGLBuffer | undefined,
    readonly owned: boolean,
  ) {}
}

class GlTexture implements RhiTexture {
  readonly __rhi = 'texture' as const;
  constructor(
    readonly native: WebGLTexture | undefined,
    readonly width: number,
    readonly height: number,
    readonly format: string,
    readonly fmt: GlFormat | undefined,
    readonly screen = false,
  ) {}
}

class GlView implements RhiTextureView {
  readonly __rhi = 'view' as const;
  constructor(readonly texture: GlTexture) {}
}

class GlSampler implements RhiSampler {
  readonly __rhi = 'sampler' as const;
  constructor(readonly native: WebGLSampler) {}
}

class GlModule implements RhiShaderModule {
  readonly __rhi = 'module' as const;
  constructor(readonly code: string) {}
}

class GlLayout implements RhiBindGroupLayout {
  readonly __rhi = 'bindlayout' as const;
  constructor(readonly entries: readonly RhiBindLayoutEntry[]) {}
}

class GlGroup implements RhiBindGroup {
  readonly __rhi = 'bindgroup' as const;
  constructor(readonly entries: ReadonlyMap<number, RhiBindEntry['resource']>) {}
}

class GlCanvas implements RhiCanvas {
  readonly __rhi = 'canvas' as const;
}

interface Slot {
  readonly binding: number;
  readonly kind: 'block' | 'texture' | 'data';
  readonly unit: number;
  readonly minimum?: number;
  readonly sampler?: number;
}

class GlPipeline implements RhiRenderPipeline {
  readonly __rhi = 'pipeline' as const;
  constructor(
    readonly program: WebGLProgram,
    readonly slots: readonly (readonly Slot[])[],
    readonly state: DrawState,
    readonly vao: WebGLVertexArrayObject,
    readonly buffers: readonly RhiVertexBufferLayout[],
    readonly flat: boolean,
  ) {}
}

export function firstVertexLast(
  count: number,
  strip: boolean,
  source?: ArrayLike<number>,
  restart = -1,
): Uint32Array {
  const out = new Uint32Array(strip ? Math.max(0, count - 2) * 3 : count - (count % 3));
  let n = 0;
  let k = 0;
  let a = 0;
  let b = 0;
  for (let i = 0; i < count; i++) {
    const v = source === undefined ? i : source[i]!;
    if (v === restart) {
      k = 0;
      continue;
    }
    k += 1;
    if (strip ? k >= 3 : k % 3 === 0) {
      const odd = strip && k % 2 === 0;
      out[n++] = odd ? v : b;
      out[n++] = odd ? b : v;
      out[n++] = a;
    }
    a = b;
    b = v;
  }
  return out.subarray(0, n);
}

export function glReadBindings(pipeline: RhiRenderPipeline): readonly (readonly number[])[] {
  return (pipeline as GlPipeline).slots.map((group) => group.map((s) => s.binding));
}

const NO_COLOUR = `#version 300 es
precision highp float;
void main() {}
`;

function toGlClip(vertex: string): string {
  const renamed = vertex.replace(/\bvoid main\(\)/, 'void _ts_main()');
  return `${renamed}
void main() {
  _ts_main();
  gl_Position.y = -gl_Position.y;
  gl_Position.z = 2.0 * gl_Position.z - gl_Position.w;
}
`;
}

function bindTexture(gl: GL, unit: number, tex: WebGLTexture, sampler: WebGLSampler): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindSampler(unit, sampler);
}

const BLIT_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const DEPTH_FS = `#version 300 es
precision highp float;
uniform highp sampler2D d;
layout(location = 0) out vec4 o;
void main() {
  o = vec4(texelFetch(d, ivec2(gl_FragCoord.xy), 0).r, 0.0, 0.0, 1.0);
}
`;

function depthToColour(s: GlState, tex: WebGLTexture, w: number, h: number): WebGLTexture {
  const gl = s.gl;
  const out = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, out);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, w, h);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const program = compile(gl, BLIT_VS, DEPTH_FS, 'the depth read-back');
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, s.blitFbo);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, null, 0);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  gl.viewport(0, 0, w, h);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.SCISSOR_TEST);
  gl.colorMask(true, true, true, true);
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindSampler(0, s.nearest);
  gl.uniform1i(gl.getUniformLocation(program, 'd'), 0);
  gl.bindVertexArray(null);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  return out;
}

async function readTexels(
  s: GlState,
  tex: WebGLTexture,
  format: string,
  fmt: GlFormat,
  w: number,
  h: number,
  bytes: number,
): Promise<Uint8Array> {
  const gl = s.gl;
  let source = tex;
  let scratch: WebGLTexture | undefined;
  if (fmt.kind === 'depth') {
    // Why: WebGL2 reads no depth back, so a pass copies it into an r32float texture first.
    scratch = depthToColour(s, tex, w, h);
    source = scratch;
  }
  const cls: 'bytes' | 'float' | 'uint' | 'sint' | 'packed' =
    fmt.kind === 'depth'
      ? 'float'
      : fmt.kind === 'uint'
        ? 'uint'
        : fmt.kind === 'sint'
          ? 'sint'
          : format === 'rgb10a2unorm'
            ? 'packed'
            : fmt.type === gl.UNSIGNED_BYTE
              ? 'bytes'
              : 'float';
  const texels = w * h;
  const lanes = cls === 'packed' ? 1 : 4;
  const size = texels * lanes * (cls === 'bytes' ? 1 : 4);
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, s.blitFbo);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, source, 0);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  const [f, t] =
    cls === 'bytes'
      ? [gl.RGBA, gl.UNSIGNED_BYTE]
      : cls === 'float'
        ? [gl.RGBA, gl.FLOAT]
        : cls === 'uint'
          ? [gl.RGBA_INTEGER, gl.UNSIGNED_INT]
          : cls === 'sint'
            ? [gl.RGBA_INTEGER, gl.INT]
            : [gl.RGBA, gl.UNSIGNED_INT_2_10_10_10_REV];
  gl.readPixels(0, 0, w, h, f, t, 0);
  gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  if (scratch !== undefined) gl.deleteTexture(scratch);
  await gpuDone(gl);
  const raw = new ArrayBuffer(size);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, new Uint8Array(raw));
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  gl.deleteBuffer(buffer);
  return texelBytes(raw, cls, format, fmt, texels, bytes);
}

function texelBytes(
  raw: ArrayBuffer,
  cls: 'bytes' | 'float' | 'uint' | 'sint' | 'packed',
  format: string,
  fmt: GlFormat,
  texels: number,
  bytes: number,
): Uint8Array {
  const out = new Uint8Array(texels * bytes);
  if (cls === 'packed') {
    out.set(new Uint8Array(raw));
    return out;
  }
  const c = fmt.channels;
  const order = fmt.bgra === true ? [2, 1, 0, 3] : [0, 1, 2, 3];
  if (cls === 'bytes') {
    const src = new Uint8Array(raw);
    for (let i = 0; i < texels; i++)
      for (let k = 0; k < c; k++) out[i * c + k] = src[i * 4 + order[k]!]!;
    return out;
  }
  if (format === 'rgb10a2uint') {
    const src = new Uint32Array(raw);
    const words = new Uint32Array(out.buffer);
    for (let i = 0; i < texels; i++)
      words[i] =
        (src[i * 4]! |
          (src[i * 4 + 1]! << 10) |
          (src[i * 4 + 2]! << 20) |
          (src[i * 4 + 3]! << 30)) >>>
        0;
    return out;
  }
  if (format === 'rg11b10ufloat') {
    const src = new Float32Array(raw);
    const words = new Uint32Array(out.buffer);
    for (let i = 0; i < texels; i++)
      words[i] =
        (smallBits(src[i * 4]!, 6) |
          (smallBits(src[i * 4 + 1]!, 6) << 11) |
          (smallBits(src[i * 4 + 2]!, 5) << 22)) >>>
        0;
    return out;
  }
  const per = bytes / c;
  const view = new DataView(out.buffer);
  const src =
    cls === 'float'
      ? new Float32Array(raw)
      : cls === 'uint'
        ? new Uint32Array(raw)
        : new Int32Array(raw);
  for (let i = 0; i < texels; i++)
    for (let k = 0; k < c; k++) {
      const v = src[i * 4 + order[k]!]!;
      const at = (i * c + k) * per;
      if (cls === 'float') {
        if (per === 4) view.setFloat32(at, v, true);
        else view.setUint16(at, halfBits(v), true);
      } else if (per === 4) view.setUint32(at, v >>> 0, true);
      else if (per === 2) view.setUint16(at, v & 0xffff, true);
      else view.setUint8(at, v & 0xff);
    }
  return out;
}

function halfBits(v: number): number {
  const sign = Object.is(v, -0) || v < 0 ? 0x8000 : 0;
  return sign | smallBits(Math.abs(v), 10);
}

function smallBits(v: number, m: number): number {
  if (Number.isNaN(v)) return (31 << m) | 1;
  if (v === Infinity) return 31 << m;
  if (v <= 0) return 0;
  let e = Math.floor(Math.log2(v));
  if (e < -14) return Math.round(v / 2 ** (-14 - m));
  let f = Math.round((v / 2 ** e - 1) * 2 ** m);
  if (f === 2 ** m) {
    f = 0;
    e++;
  }
  return ((e + 15) << m) | f;
}

function texelView(gl: GL, type: number, data: ArrayBufferView): ArrayBufferView {
  const at = [data.buffer, data.byteOffset] as const;
  const n = (size: number): number => Math.floor(data.byteLength / size);
  switch (type) {
    case gl.FLOAT:
      return new Float32Array(...at, n(4));
    case gl.HALF_FLOAT:
    case gl.UNSIGNED_SHORT:
      return new Uint16Array(...at, n(2));
    case gl.SHORT:
      return new Int16Array(...at, n(2));
    case gl.UNSIGNED_INT:
    case gl.UNSIGNED_INT_2_10_10_10_REV:
    case gl.UNSIGNED_INT_10F_11F_11F_REV:
    case gl.UNSIGNED_INT_24_8:
      return new Uint32Array(...at, n(4));
    case gl.INT:
      return new Int32Array(...at, n(4));
    case gl.BYTE:
      return new Int8Array(...at, data.byteLength);
    default:
      return new Uint8Array(...at, data.byteLength);
  }
}

const pad = (v: readonly number[]): number[] => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0];

interface Attachment {
  readonly tex: WebGLTexture | 'screen';
  readonly kind: GlTextureKind;
  readonly a: RhiColorAttachment;
}

function blitScreen(s: GlState, attachment: number, way: 'in' | 'out'): void {
  const gl = s.gl;
  const { w, h } = s.screen();
  const fbo = s.fbo;
  if (way === 'out') {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
  } else {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
    gl.readBuffer(gl.BACK);
    const only = Array.from({ length: attachment + 1 }, (_, k) =>
      k === attachment ? gl.COLOR_ATTACHMENT0 + attachment : gl.NONE,
    );
    gl.drawBuffers(only);
  }
  gl.blitFramebuffer(0, 0, w, h, 0, h, w, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
}

class GlRenderPass implements RhiRenderPass {
  readonly #gl: GL;
  readonly #colour: Attachment[];
  readonly #depth: RhiDepthStencilAttachment | undefined;
  readonly #stencil: boolean;
  readonly #host: { viewport: number[]; range: number[]; blend: number[] };
  #pipeline: GlPipeline | undefined;
  readonly #groups: (GlGroup | undefined)[] = [];
  readonly #vertices: (GlBuffer | undefined)[] = [];
  #index: { buffer: GlBuffer; type: number } | undefined;
  #reference = 0;
  #provoking: number | undefined;

  constructor(
    private readonly device: GlDevice,
    private readonly s: GlState,
    desc: RhiRenderPassDesc,
  ) {
    const gl = (this.#gl = s.gl);
    this.#colour = desc.colorAttachments.map((a) => {
      const t = (a.view as GlView).texture;
      return { tex: t.screen ? 'screen' : t.native!, kind: t.fmt?.kind ?? 'float', a };
    });
    const d = (this.#depth = desc.depthStencilAttachment);
    this.#stencil =
      d !== undefined && (d.stencilReadOnly === true || d.stencilLoadOp !== undefined);
    const depthTex = d === undefined ? undefined : (d.view as GlView).texture;
    const first = this.#colour[0];
    const [w, h] =
      first?.tex === 'screen'
        ? [gl.drawingBufferWidth, gl.drawingBufferHeight]
        : first !== undefined
          ? [
              (desc.colorAttachments[0]!.view as GlView).texture.width,
              (desc.colorAttachments[0]!.view as GlView).texture.height,
            ]
          : [depthTex?.width ?? 0, depthTex?.height ?? 0];
    const screen = this.#colour.some((c) => c.tex === 'screen') ? s.screen() : undefined;
    gl.bindFramebuffer(gl.FRAMEBUFFER, s.fbo);
    const buffers: number[] = [];
    this.#colour.forEach((c, i) => {
      const tex = c.tex === 'screen' ? screen!.tex : c.tex;
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
      buffers.push(gl.COLOR_ATTACHMENT0 + i);
    });
    for (let i = this.#colour.length; i < s.maxColorAttachments; i++)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, null, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, null, 0);
    if (depthTex !== undefined)
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        this.#stencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT,
        gl.TEXTURE_2D,
        depthTex.native!,
        0,
      );
    gl.disable(gl.SCISSOR_TEST);
    this.#colour.forEach((c, i) => {
      if (c.tex === 'screen' && c.a.loadOp === 'load') blitScreen(s, i, 'in');
    });
    this.#host = {
      viewport: Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array),
      range: Array.from(gl.getParameter(gl.DEPTH_RANGE) as Float32Array),
      blend: Array.from(gl.getParameter(gl.BLEND_COLOR) as Float32Array),
    };
    gl.viewport(0, 0, w, h);
    gl.depthRange(0, 1);
    gl.blendColor(0, 0, 0, 0);
    gl.drawBuffers(buffers.length > 0 ? buffers : [gl.NONE]);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.stencilMask(0xffffffff);
    this.#colour.forEach((c, i) => {
      if (c.a.loadOp !== 'clear') return;
      const v = pad(c.a.clearValue);
      if (c.kind === 'uint') gl.clearBufferuiv(gl.COLOR, i, new Uint32Array(v));
      else if (c.kind === 'sint') gl.clearBufferiv(gl.COLOR, i, new Int32Array(v));
      else gl.clearBufferfv(gl.COLOR, i, new Float32Array(v));
    });
    if (d?.depthLoadOp === 'clear')
      gl.clearBufferfv(gl.DEPTH, 0, new Float32Array([d.depthClearValue ?? 1]));
    if (this.#stencil && d?.stencilLoadOp === 'clear')
      gl.clearBufferiv(gl.STENCIL, 0, new Int32Array([d.stencilClearValue ?? 0]));
  }

  setPipeline(pipeline: RhiRenderPipeline): void {
    this.#pipeline = pipeline as GlPipeline;
    this.#gl.useProgram(this.#pipeline.program);
  }

  setBindGroup(index: number, group: RhiBindGroup): void {
    this.#groups[index] = group as GlGroup;
  }

  setVertexBuffer(slot: number, buffer: RhiBuffer): void {
    this.#vertices[slot] = buffer as GlBuffer;
  }

  setIndexBuffer(buffer: RhiBuffer, format: 'uint16' | 'uint32'): void {
    const gl = this.#gl;
    this.#index = {
      buffer: buffer as GlBuffer,
      type: format === 'uint32' ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
    };
  }

  draw(vertexCount: number, instanceCount = 1): void {
    this.#draw(vertexCount, instanceCount, false);
  }

  drawIndexed(indexCount: number, instanceCount = 1): void {
    this.#draw(indexCount, instanceCount, true);
  }

  #draw(count: number, instances: number, indexed: boolean): void {
    const gl = this.#gl;
    const p = this.#pipeline;
    if (p === undefined) throw new Error('webgl2: a draw before setPipeline()');
    p.slots.forEach((slots, g) => this.#bind(slots, this.#groups[g]));
    const index = indexed ? this.#index : undefined;
    if (indexed && index === undefined)
      throw new Error('webgl2: drawIndexed() with no index buffer');
    for (const b of this.#vertices) if (b !== undefined) this.device.upload(b, gl.ARRAY_BUFFER);
    if (index !== undefined) this.device.upload(index.buffer, gl.ELEMENT_ARRAY_BUFFER);
    gl.bindVertexArray(p.vao);
    p.buffers.forEach((layout, slot) => {
      const b = this.#vertices[slot];
      if (b === undefined) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.native!);
      for (const a of layout.attributes) {
        const [kind, n] = a.format.split('x') as [string, string?];
        const size = Number(n ?? 1);
        gl.enableVertexAttribArray(a.shaderLocation);
        if (kind === 'float32')
          gl.vertexAttribPointer(
            a.shaderLocation,
            size,
            gl.FLOAT,
            false,
            layout.arrayStride,
            a.offset,
          );
        else
          gl.vertexAttribIPointer(
            a.shaderLocation,
            size,
            kind === 'uint32' ? gl.UNSIGNED_INT : gl.INT,
            layout.arrayStride,
            a.offset,
          );
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    });
    if (index !== undefined) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index.buffer.native!);
    setState(gl, p.state, this.#reference, this.s.polygonOffsetClamp);
    // Why: WebGPU takes a flat value from the first vertex of a primitive and GLSL ES 3.00 from the last.
    const ext = this.s.provokingVertex;
    const mode = p.state.mode;
    if (p.flat && ext !== null && this.#provoking === undefined) {
      this.#provoking = gl.getParameter(ext.PROVOKING_VERTEX_WEBGL) as number;
      ext.provokingVertexWEBGL(ext.FIRST_VERTEX_CONVENTION_WEBGL);
    }
    if (p.flat && ext === null && (mode === gl.TRIANGLES || mode === gl.TRIANGLE_STRIP)) {
      const first = this.device.firstVertexLast(mode === gl.TRIANGLE_STRIP, count, index);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, first.native);
      gl.drawElementsInstanced(gl.TRIANGLES, first.count, gl.UNSIGNED_INT, 0, instances);
    } else if (index === undefined) gl.drawArraysInstanced(mode, 0, count, instances);
    else gl.drawElementsInstanced(mode, count, index.type, 0, instances);
    gl.bindVertexArray(null);
  }

  #bind(slots: readonly Slot[], group: GlGroup | undefined): void {
    const gl = this.#gl;
    for (const slot of slots) {
      const r = group?.entries.get(slot.binding);
      if (r === undefined) throw new Error(`webgl2: binding ${slot.binding} is not bound`);
      if (slot.kind === 'texture') {
        const tex =
          'view' in r ? (r.view as GlView).texture.native! : (r as { native: object }).native;
        const sr = slot.sampler === undefined ? undefined : group!.entries.get(slot.sampler);
        const sampler =
          sr === undefined
            ? this.s.nearest
            : 'sampler' in sr
              ? (sr.sampler as GlSampler).native
              : ((sr as { native: object }).native as WebGLSampler);
        bindTexture(gl, slot.unit, tex as WebGLTexture, sampler);
        continue;
      }
      const b = (r as { buffer: RhiBuffer }).buffer as GlBuffer;
      if (slot.kind === 'block') {
        if (b.bytes !== undefined && (b.staleBuffer || b.padded !== slot.minimum)) {
          gl.bindBuffer(gl.UNIFORM_BUFFER, b.native!);
          gl.bufferData(gl.UNIFORM_BUFFER, glUniformBytes(b.bytes, slot.minimum!), gl.STREAM_DRAW);
          gl.bindBuffer(gl.UNIFORM_BUFFER, null);
          b.staleBuffer = false;
          b.padded = slot.minimum!;
        }
        gl.bindBufferBase(gl.UNIFORM_BUFFER, slot.unit, b.native!);
        continue;
      }
      bindTexture(gl, slot.unit, this.device.dataTextureOf(b), this.s.nearest);
    }
  }

  setViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth: number,
    maxDepth: number,
  ): void {
    this.#gl.viewport(x, y, width, height);
    this.#gl.depthRange(minDepth, maxDepth);
  }

  setScissorRect(x: number, y: number, width: number, height: number): void {
    this.#gl.enable(this.#gl.SCISSOR_TEST);
    this.#gl.scissor(x, y, width, height);
  }

  setBlendConstant(color: readonly [number, number, number, number]): void {
    this.#gl.blendColor(color[0], color[1], color[2], color[3]);
  }

  setStencilReference(reference: number): void {
    this.#reference = reference;
  }

  end(): void {
    const gl = this.#gl;
    const s = this.s;
    const d = this.#depth;
    gl.useProgram(null);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.stencilMask(0xffffffff);
    this.#colour.forEach((c, i) => {
      if (c.a.storeOp !== 'discard') return;
      if (c.kind === 'uint') gl.clearBufferuiv(gl.COLOR, i, new Uint32Array(4));
      else if (c.kind === 'sint') gl.clearBufferiv(gl.COLOR, i, new Int32Array(4));
      else gl.clearBufferfv(gl.COLOR, i, new Float32Array(4));
    });
    if (d?.depthStoreOp === 'discard') gl.clearBufferfv(gl.DEPTH, 0, new Float32Array([0]));
    if (this.#stencil && d?.stencilStoreOp === 'discard')
      gl.clearBufferiv(gl.STENCIL, 0, new Int32Array([0]));
    this.#colour.forEach((c, i) => {
      if (c.tex === 'screen') blitScreen(s, i, 'out');
    });
    if (this.#provoking !== undefined) s.provokingVertex!.provokingVertexWEBGL(this.#provoking);
    const host = this.#host;
    gl.viewport(host.viewport[0]!, host.viewport[1]!, host.viewport[2]!, host.viewport[3]!);
    gl.depthRange(host.range[0]!, host.range[1]!);
    gl.blendColor(host.blend[0]!, host.blend[1]!, host.blend[2]!, host.blend[3]!);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

const NO_COMPUTE =
  'The WebGL2 backend has no compute pass: a dispatch on WebGL2 runs as the pass program of change 0054 (caps.compute is fragment-emulated).';

class GlEncoder implements RhiCommandEncoder {
  constructor(private readonly device: GlDevice) {}

  beginRenderPass(desc: RhiRenderPassDesc): RhiRenderPass {
    return new GlRenderPass(this.device, this.device.state(), desc);
  }

  beginComputePass(): RhiComputePass {
    throw new TypeError(NO_COMPUTE);
  }

  copyBufferToBuffer(
    src: RhiBuffer,
    srcOffset: number,
    dst: RhiBuffer,
    dstOffset: number,
    size: number,
  ): void {
    const from = (src as GlBuffer).bytes;
    const to = dst as GlBuffer;
    if (from === undefined || to.bytes === undefined)
      throw new TypeError(
        'copyBufferToBuffer on WebGL2 copies between buffers the device made; a host WebGLBuffer holds no bytes the device keeps.',
      );
    to.bytes.set(from.subarray(srcOffset, srcOffset + size), dstOffset);
    to.staleBuffer = to.staleTexture = true;
  }
}

const isA = (name: string, o: object): boolean => {
  const c = (globalThis as Record<string, unknown>)[name];
  return typeof c === 'function' && o instanceof (c as new () => object);
};

class GlDevice implements RhiDevice {
  readonly backend = 'webgl2';
  readonly caps: RhiCaps;
  #state: GlState | undefined;
  #limits: Readonly<Record<string, number>> | undefined;
  readonly #canvas = new GlCanvas();
  readonly #plain: ({ native: WebGLBuffer; count: number } | undefined)[] = [];
  #hosts: WebGLBuffer | undefined;
  readonly #views = new WeakMap<GlTexture, GlView>();
  readonly #handles = new WeakMap<object, RhiBuffer | RhiTexture | RhiSampler>();

  constructor(readonly native: GL) {
    const limits = (): Readonly<Record<string, number>> => this.#limitsOf();
    this.caps = {
      compute: 'fragment-emulated',
      shaderLanguage: 'glsl-es300',
      immediate: true,
      get limits() {
        return limits();
      },
      hasFeature: (name) => this.state().extensions.has(name),
    };
  }

  state(): GlState {
    return (this.#state ??= new GlState(this.native));
  }

  #limitsOf(): Readonly<Record<string, number>> {
    if (this.#limits === undefined) {
      const gl = this.native;
      const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
      this.#limits = Object.freeze({ maxViewportDimension: Math.min(dims[0]!, dims[1]!) });
    }
    return this.#limits;
  }

  upload(b: GlBuffer, target: number): void {
    if (b.bytes === undefined || !b.staleBuffer) return;
    const gl = this.native;
    gl.bindBuffer(target, b.native!);
    gl.bufferData(target, b.bytes, gl.STATIC_DRAW);
    gl.bindBuffer(target, null);
    b.staleBuffer = false;
  }

  firstVertexLast(
    strip: boolean,
    count: number,
    index: { buffer: GlBuffer; type: number } | undefined,
  ): { native: WebGLBuffer; count: number } {
    const gl = this.native;
    const fill = (native: WebGLBuffer, indices: Uint32Array): void => {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, native);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    };
    if (index === undefined) {
      const plain = (this.#plain[strip ? 1 : 0] ??= { native: gl.createBuffer()!, count: 0 });
      if (plain.count < count) {
        fill(plain.native, firstVertexLast(count, strip));
        plain.count = count;
      }
      return {
        native: plain.native,
        count: strip ? Math.max(0, count - 2) * 3 : count - (count % 3),
      };
    }
    const b = index.buffer;
    const wide = index.type === gl.UNSIGNED_INT;
    const width = wide ? 4 : 2;
    const restart = wide ? 0xffffffff : 0xffff;
    if (b.bytes === undefined) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.native!);
      const size = gl.getBufferParameter(gl.ELEMENT_ARRAY_BUFFER, gl.BUFFER_SIZE) as number;
      const n = Math.min(count, Math.floor(size / width));
      const source = wide ? new Uint32Array(n) : new Uint16Array(n);
      gl.getBufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, source);
      const indices = firstVertexLast(n, strip, source, restart);
      fill((this.#hosts ??= gl.createBuffer()!), indices);
      return { native: this.#hosts, count: indices.length };
    }
    const key = `${String(strip)} ${String(wide)} ${String(count)}`;
    if (b.first?.key === key) return b.first;
    const n = Math.min(count, Math.floor(b.size / width));
    const source = wide
      ? new Uint32Array(b.bytes.buffer, 0, n)
      : new Uint16Array(b.bytes.buffer, 0, n);
    const indices = firstVertexLast(n, strip, source, restart);
    const first = (b.first ??= { native: gl.createBuffer()!, key, count: 0 });
    fill(first.native, indices);
    first.key = key;
    first.count = indices.length;
    return first;
  }

  dataTextureOf(b: GlBuffer): WebGLTexture {
    if (b.bytes === undefined)
      throw new TypeError(
        'A storage binding on WebGL2 takes a buffer the device made: it reads the buffer as a data texture of its bytes.',
      );
    if (b.texture !== undefined && !b.staleTexture) return b.texture;
    if (b.texture !== undefined) this.native.deleteTexture(b.texture);
    b.texture = dataTexture(this.native, b.elem, b.bytes);
    b.staleTexture = false;
    return b.texture;
  }

  createBuffer(desc: RhiBufferDesc): RhiBuffer {
    const usage = new Set(desc.usage);
    const object = usage.has('vertex') || usage.has('index') || usage.has('uniform');
    return new GlBuffer(
      desc.size,
      usage,
      desc.elem ?? 'f32',
      new Uint8Array(desc.size),
      object ? this.native.createBuffer()! : undefined,
      object,
    );
  }

  writeBuffer(buffer: RhiBuffer, byteOffset: number, data: ArrayBuffer | ArrayBufferView): void {
    const b = buffer as GlBuffer;
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    if (b.bytes === undefined) {
      const gl = this.native;
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, b.native!);
      gl.bufferSubData(gl.COPY_WRITE_BUFFER, byteOffset, bytes);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
      return;
    }
    b.bytes.set(bytes, byteOffset);
    b.staleBuffer = b.staleTexture = true;
    if (b.first !== undefined) b.first.key = '';
  }

  readBuffer(buffer: RhiBuffer): Promise<ArrayBuffer> {
    const b = buffer as GlBuffer;
    if (b.bytes === undefined)
      return Promise.reject(new TypeError('readBuffer on WebGL2 reads a buffer the device made.'));
    return Promise.resolve(b.bytes.slice().buffer);
  }

  destroyBuffer(buffer: RhiBuffer): void {
    const b = buffer as GlBuffer;
    if (b.owned && b.native !== undefined) this.native.deleteBuffer(b.native);
    if (b.texture !== undefined) this.native.deleteTexture(b.texture);
    b.texture = undefined;
    if (b.first !== undefined) this.native.deleteBuffer(b.first.native);
    b.first = undefined;
  }

  createTexture(desc: RhiTextureDesc): RhiTexture {
    const gl = this.native;
    this.state();
    if ((desc.dimension ?? '2d') !== '2d' || desc.size[2] !== 1)
      throw new TypeError('A 3D or layered texture is not supported yet on the WebGL2 tier.');
    if ((desc.sampleCount ?? 1) !== 1)
      throw new TypeError(
        'A multisampled texture is not supported yet on the WebGL2 tier (Rule 10.5, Rule 11.11).',
      );
    const fmt = formatOf(gl, desc.format);
    if (fmt === undefined) throw new TypeError(`${desc.format} is not supported yet on WebGL2.`);
    const [w, h] = desc.size;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt.internal, w, h);
    gl.bindTexture(gl.TEXTURE_2D, null);
    const handle = new GlTexture(t, w, h, desc.format, fmt);
    this.#handles.set(t, handle);
    return handle;
  }

  writeTexture(
    texture: RhiTexture,
    data: ArrayBufferView,
    bytesPerRow: number,
    width: number,
    height: number,
  ): void {
    const gl = this.native;
    const t = texture as GlTexture;
    const fmt = t.fmt;
    if (fmt === undefined || t.native === undefined)
      throw new TypeError('writeTexture on WebGL2 writes a texture the device made.');
    let bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (fmt.bgra === true) {
      bytes = bytes.slice();
      for (let i = 0; i + 3 < bytes.length; i += 4) {
        const b = bytes[i]!;
        bytes[i] = bytes[i + 2]!;
        bytes[i + 2] = b;
      }
    }
    const texel = (bytesPerRow / width) | 0;
    gl.bindTexture(gl.TEXTURE_2D, t.native);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (texel * width !== bytesPerRow) gl.pixelStorei(gl.UNPACK_ROW_LENGTH, bytesPerRow / texel);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      width,
      height,
      fmt.format,
      fmt.type,
      texelView(gl, fmt.type, bytes),
    );
    if (texel * width !== bytesPerRow) gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  readTexture(texture: RhiTexture, bytesPerTexel: number): Promise<Uint8Array> {
    try {
      const t = texture as GlTexture;
      if (t.fmt === undefined || t.native === undefined)
        throw new TypeError('readTexture on WebGL2 reads a texture the device made.');
      return readTexels(this.state(), t.native, t.format, t.fmt, t.width, t.height, bytesPerTexel);
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  destroyTexture(texture: RhiTexture): void {
    const t = texture as GlTexture;
    if (t.native !== undefined && t.fmt !== undefined) this.native.deleteTexture(t.native);
  }

  createView(texture: RhiTexture): RhiTextureView {
    const t = texture as GlTexture;
    let v = this.#views.get(t);
    if (v === undefined) this.#views.set(t, (v = new GlView(t)));
    return v;
  }

  currentTexture(_canvas: RhiCanvas): RhiTexture {
    const gl = this.native;
    return new GlTexture(
      undefined,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      'rgba8unorm',
      undefined,
      true,
    );
  }

  createSampler(desc: RhiSamplerDesc): RhiSampler {
    const gl = this.native;
    const s = gl.createSampler()!;
    const filter = (f: string): number => (f === 'nearest' ? gl.NEAREST : gl.LINEAR);
    const wrap = (a: string): number =>
      a === 'repeat' ? gl.REPEAT : a === 'mirror-repeat' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, filter(desc.minFilter));
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, filter(desc.magFilter));
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, wrap(desc.addressModeU));
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, wrap(desc.addressModeV));
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_R, wrap(desc.addressModeW));
    if (desc.compare !== undefined) {
      gl.samplerParameteri(s, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.samplerParameteri(s, gl.TEXTURE_COMPARE_FUNC, compareOf(gl, desc.compare));
    }
    const handle = new GlSampler(s);
    this.#handles.set(s, handle);
    return handle;
  }

  createShaderModule(code: string | object): RhiShaderModule {
    if (typeof code !== 'string')
      throw new TypeError(
        "The WebGL2 backend runs a GLSL ES 3.00 program's text; it got a module's CPU program.",
      );
    return new GlModule(code);
  }

  createBindGroupLayout(entries: readonly RhiBindLayoutEntry[]): RhiBindGroupLayout {
    return new GlLayout(entries);
  }

  createBindGroup(_layout: RhiBindGroupLayout, entries: readonly RhiBindEntry[]): RhiBindGroup {
    return new GlGroup(new Map(entries.map((e) => [e.binding, e.resource])));
  }

  createComputePipeline(): Promise<RhiComputePipeline> {
    return Promise.reject(new TypeError(NO_COMPUTE));
  }

  createRenderPipeline(desc: RhiRenderPipelineDesc): Promise<RhiRenderPipeline> {
    try {
      return Promise.resolve(this.#pipeline(desc));
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  #pipeline(desc: RhiRenderPipelineDesc): GlPipeline {
    const gl = this.native;
    this.state();
    const vertex = toGlClip((desc.module as GlModule).code);
    const fragment =
      desc.fragment === undefined
        ? NO_COLOUR
        : ((desc.fragment.module ?? desc.module) as GlModule).code;
    const flat = /\bflat\s+out\b/.test(vertex);
    const topology = desc.primitive.topology;
    if (flat && this.state().provokingVertex === null && /^line/.test(topology))
      throw new TypeError(
        `${desc.label ?? 'A render pipeline'}: a flat interstage value on a ${topology} is not supported yet on the WebGL2 tier without WEBGL_provoking_vertex (Rule 11.11), and this context lacks it. WebGPU takes a flat value from the first vertex of a line and GLSL ES 3.00 from the last, and a line turned round covers other pixels at its ends.`,
      );
    const program = compile(gl, vertex, fragment, desc.label ?? 'a render pipeline');
    const slots = this.#slots(program, desc.layouts as readonly GlLayout[]);
    const state = drawStateOf(gl, desc);
    return new GlPipeline(
      program,
      slots,
      state,
      gl.createVertexArray()!,
      desc.vertex.buffers,
      flat,
    );
  }

  #slots(program: WebGLProgram, layouts: readonly GlLayout[]): Slot[][] {
    const gl = this.native;
    const slots: Slot[][] = layouts.map(() => []);
    const sampled: { group: number; entry: RhiBindLayoutEntry; kind: 'texture' | 'data' }[] = [];
    let blocks = 0;
    gl.useProgram(program);
    layouts.forEach((layout, group) => {
      for (const e of layout.entries) {
        if ('buffer' in e && e.buffer.type === 'uniform') {
          const index = gl.getUniformBlockIndex(program, e.name ?? '');
          if (index === gl.INVALID_INDEX) continue;
          const minimum: unknown = gl.getActiveUniformBlockParameter(
            program,
            index,
            gl.UNIFORM_BLOCK_DATA_SIZE,
          );
          if (typeof minimum !== 'number' || !Number.isSafeInteger(minimum) || minimum < 1)
            throw new Error(
              `WebGL2 reports an invalid uniform block size for "${e.label ?? e.name ?? ''}".`,
            );
          const unit = blocks++;
          gl.uniformBlockBinding(program, index, unit);
          slots[group]!.push({ binding: e.binding, kind: 'block', unit, minimum });
        } else if ('texture' in e) sampled.push({ group, entry: e, kind: 'texture' });
        else if ('buffer' in e) sampled.push({ group, entry: e, kind: 'data' });
      }
    });
    sampled.forEach(({ group, entry, kind }, unit) => {
      gl.uniform1i(gl.getUniformLocation(program, entry.name ?? ''), unit);
      slots[group]!.push({
        binding: entry.binding,
        kind,
        unit,
        ...(kind === 'texture' && entry.samplerBinding !== undefined
          ? { sampler: entry.samplerBinding }
          : {}),
      });
    });
    gl.useProgram(null);
    return slots;
  }

  createCommandEncoder(): RhiCommandEncoder {
    return new GlEncoder(this);
  }

  submit(_encoders: readonly RhiCommandEncoder[]): Promise<void> {
    return Promise.resolve();
  }

  pushValidationScope(): void {}

  popValidationScope(): Promise<string | null> {
    const gl = this.native;
    const e = gl.getError();
    return Promise.resolve(
      e === gl.NO_ERROR ? null : `WebGL2 error 0x${e.toString(16).padStart(4, '0')}`,
    );
  }

  fromNative<K extends keyof RhiNativeKinds>(
    kind: K,
    object: object,
  ): RhiNativeKinds[K] | undefined {
    const known = this.#handles.get(object);
    const found = (h: object | undefined): RhiNativeKinds[K] | undefined =>
      h as RhiNativeKinds[K] | undefined;
    switch (kind) {
      case 'buffer':
        if (known instanceof GlBuffer) return found(known);
        if (!isA('WebGLBuffer', object)) return undefined;
        return found(
          this.#remember(object, new GlBuffer(0, new Set(), 'f32', undefined, object, false)),
        );
      case 'texture':
        if (known instanceof GlTexture) return found(known);
        if (!isA('WebGLTexture', object)) return undefined;
        return found(this.#remember(object, new GlTexture(object, 0, 0, '', undefined)));
      case 'view': {
        if (object instanceof GlView) return found(object);
        const t = this.fromNative('texture', object);
        return t === undefined ? undefined : found(this.createView(t));
      }
      case 'sampler':
        if (known instanceof GlSampler) return found(known);
        if (!isA('WebGLSampler', object)) return undefined;
        return found(this.#remember(object, new GlSampler(object)));
      case 'canvas': {
        const gl = this.native;
        return object === gl || object === gl.canvas ? found(this.#canvas) : undefined;
      }
      default:
        return undefined;
    }
  }

  #remember<H extends RhiBuffer | RhiTexture | RhiSampler>(native: object, h: H): H {
    this.#handles.set(native, h);
    return h;
  }

  toNative(h: object): object {
    if (h instanceof GlBuffer || h instanceof GlTexture || h instanceof GlSampler)
      return h.native ?? h;
    if (h instanceof GlView) return h.texture.native ?? h;
    if (h instanceof GlCanvas) return this.native;
    return h;
  }

  destroy(): void {
    (
      this.native.getExtension('WEBGL_lose_context') as { loseContext(): void } | null
    )?.loseContext();
  }
}

export function webgl2Device(gl: WebGL2RenderingContext): RhiDevice {
  return new GlDevice(gl);
}
