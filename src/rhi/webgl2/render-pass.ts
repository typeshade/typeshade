import { glUniformBytes } from '../../core/gl-uniform-bytes.js';
import type {
  RhiBindGroup,
  RhiBuffer,
  RhiColorAttachment,
  RhiDepthStencilAttachment,
  RhiRenderPass,
  RhiRenderPassDesc,
  RhiRenderPipeline,
} from '../rhi.js';
import type { GL, GlPassHost, GlTextureKind } from './types.js';
import type { GlState } from './state.js';
import { setState } from './draw-state.js';
import { bindTexture } from './bind-texture.js';
import { blitScreen } from './screen-blit.js';
import type { GlPipeline, Slot } from './pipeline.js';
import type { GlBuffer, GlView, GlSampler, GlGroup } from './handles.js';

const pad = (v: readonly number[]): number[] => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0];

interface Attachment {
  readonly tex: WebGLTexture | 'screen';
  readonly kind: GlTextureKind;
  readonly a: RhiColorAttachment;
}

export class GlRenderPass implements RhiRenderPass {
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
    private readonly device: GlPassHost,
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
