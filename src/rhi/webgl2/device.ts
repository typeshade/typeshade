import { compile } from '../../core/gl-compute.js';
import type {
  RhiBindEntry,
  RhiBindGroup,
  RhiBindGroupLayout,
  RhiBindLayoutEntry,
  RhiBuffer,
  RhiBufferDesc,
  RhiCanvas,
  RhiCaps,
  RhiCommandEncoder,
  RhiComputePipeline,
  RhiDevice,
  RhiNativeKinds,
  RhiRenderPipeline,
  RhiRenderPipelineDesc,
  RhiSampler,
  RhiSamplerDesc,
  RhiShaderModule,
  RhiTexture,
  RhiTextureDesc,
  RhiTextureView,
} from '../rhi.js';
import type { GL } from './types.js';
import { formatOf } from './format.js';
import { GlState } from './state.js';
import { compareOf, drawStateOf } from './draw-state.js';
import { dataTexture } from './data-texture.js';
import { readTexels } from './texel-readback.js';
import { texelView } from './texel-view.js';
import { firstVertexLast } from './first-vertex-last.js';
import { GlPipeline, type Slot } from './pipeline.js';
import {
  GlBuffer,
  GlTexture,
  GlView,
  GlSampler,
  GlModule,
  GlLayout,
  GlGroup,
  GlCanvas,
} from './handles.js';
import { NO_COMPUTE, GlEncoder } from './encoder.js';

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

const isA = (name: string, o: object): boolean => {
  const c = (globalThis as Record<string, unknown>)[name];
  return typeof c === 'function' && o instanceof (c as new () => object);
};

export class GlDevice implements RhiDevice {
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
