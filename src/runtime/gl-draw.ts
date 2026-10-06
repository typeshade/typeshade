// The program runtime's draws on WebGL2 (change 0054 decision 2, Rule 11.11): textures, samplers,
// render pipelines and passes on a WebGL2 context, from the vertex and fragment programs the
// manifest carries (`Pack.gl.vertices`, `Pack.gl.draws`). It builds no program itself, so like
// the rest of the runtime it imports no compiler.
//
// WebGPU's conventions, kept. A vertex program's position is flipped in y and its depth moved
// from WebGPU's 0..w to GL's -w..w, so a texture's row 0 is the top row a WebGPU pass draws, a
// fragment's `position` is WebGPU's, and a depth value is the one WebGPU stores. The flip turns
// the winding round, so `frontFace: 'ccw'` is GL's clockwise. A texture uploaded or read back
// keeps WebGPU's row order with no copy turned over; only a pass into the canvas is turned over,
// once, as it is copied to the screen.
//
// Order. A pass is recorded into a frame and runs at `submit()`, and a texture's `read()` runs
// where it is called, each after every call, frame and read before it (`core/resident.ts`), so a
// read reads what was submitted before it, as on WebGPU.

import { byteSize, describe, Misfit, pack, type Layout } from '../core/host-entry.js';
import { compile, gpuDone } from '../core/gl-compute.js';
import {
  layoutFromPack,
  type Pack,
  type PackBinding,
  type PackEntry,
  type PackGlDraw,
  type PackGlVertex,
} from '../core/manifest-types.js';
import { kernelQueue, residentState, type ResidentArrayState } from '../core/resident.js';
import {
  at,
  constantsOf,
  entryOf,
  targetsOf,
  type Bindings,
  type Geometry,
  type RenderPipeline,
  type RenderState,
} from './program.js';
import {
  layoutOf,
  type Sampler,
  type SamplerOptions,
  type Texture,
  type TextureOptions,
} from './resources.js';
import type { PassTargets, RenderPass } from './runtime.js';

type GL = WebGL2RenderingContext;

// ─── overrides ───────────────────────────────────────────────────────────────────────────────

/** `source` with each override named in `values` pinned: GLSL ES 3.00 has no specialization
 *  constants, so a program declares each override as a `#define` under `#ifndef`, and a
 *  `#define` before it pins the value, as the GLSL writer's `overrideValues` does. */
export function pinOverrides(source: string, values: Readonly<Record<string, number>>): string {
  const defines = Object.entries(values)
    .map(([name, v]) => `#define ${name} ${glslLiteral(source, name, v)}\n`)
    .join('');
  const nl = source.indexOf('\n') + 1;
  return source.slice(0, nl) + defines + source.slice(nl);
}

/** `v` as the GLSL literal of the override `name`, typed as the program's default is. */
function glslLiteral(src: string, name: string, v: number): string {
  const d = new RegExp(`#define ${name} (\\S+)`).exec(src)?.[1] ?? '';
  if (d.endsWith('u')) return `${v >>> 0}u`;
  if (d === 'true' || d === 'false') return v === 0 ? 'false' : 'true';
  if (/[.eE]/.test(d)) {
    const s = Object.is(v, -0) ? '-0' : String(v);
    return /[.eE]/.test(s) ? s : `${s}.0`;
  }
  return String(v | 0);
}

// ─── formats ─────────────────────────────────────────────────────────────────────────────────

/** How a `GPUTextureFormat` lives on WebGL2: its sized internal format, the format and type
 *  `texImage2D` and `readPixels` speak, its channels, and how its texels are cleared and read. */
interface GlFormat {
  readonly internal: number;
  readonly format: number;
  readonly type: number;
  readonly channels: number;
  /** How a clear and a read take it: a float or normalized colour, an integer one, or depth. */
  readonly kind: 'float' | 'uint' | 'sint' | 'depth';
  /** Blue first: WebGL2 has no BGRA texture, so the texels are RGBA and a read swaps them. */
  readonly bgra?: boolean;
}

const NAMED = /^(r|rg|rgba|bgra)(8|16|32)(unorm|snorm|uint|sint|float)(-srgb)?$/;

/** `name` on `gl`, or undefined for a format WebGL2 has no texture of. */
function formatOf(gl: GL, name: string): GlFormat | undefined {
  switch (name) {
    case 'depth16unorm':
      return depth(gl.DEPTH_COMPONENT16, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT);
    case 'depth24plus':
      return depth(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    case 'depth32float':
      return depth(gl.DEPTH_COMPONENT32F, gl.DEPTH_COMPONENT, gl.FLOAT);
    case 'depth24plus-stencil8':
      return depth(gl.DEPTH24_STENCIL8, gl.DEPTH_STENCIL, gl.UNSIGNED_INT_24_8);
    case 'depth32float-stencil8':
      return depth(gl.DEPTH32F_STENCIL8, gl.DEPTH_STENCIL, gl.FLOAT_32_UNSIGNED_INT_24_8_REV);
    case 'rgb10a2unorm':
      return {
        internal: gl.RGB10_A2,
        format: gl.RGBA,
        type: gl.UNSIGNED_INT_2_10_10_10_REV,
        channels: 4,
        kind: 'float',
      };
    case 'rgb10a2uint':
      return {
        internal: gl.RGB10_A2UI,
        format: gl.RGBA_INTEGER,
        type: gl.UNSIGNED_INT_2_10_10_10_REV,
        channels: 4,
        kind: 'uint',
      };
    case 'rg11b10ufloat':
      return {
        internal: gl.R11F_G11F_B10F,
        format: gl.RGB,
        type: gl.UNSIGNED_INT_10F_11F_11F_REV,
        channels: 3,
        kind: 'float',
      };
  }
  const m = NAMED.exec(name);
  if (m === null) return undefined;
  const [, ch, bitsText, kind, srgb] = m as unknown as [string, string, string, string, string?];
  const bits = Number(bitsText);
  const channels = ch === 'r' ? 1 : ch === 'rg' ? 2 : 4;
  const bgra = ch === 'bgra';
  const C = ch === 'bgra' ? 'RGBA' : ch.toUpperCase();
  const g = gl as unknown as Record<string, number | undefined>;
  const base = channels === 1 ? 'RED' : channels === 2 ? 'RG' : 'RGBA';
  if (kind === 'unorm' && bits === 8) {
    if (srgb !== undefined)
      return channels === 4
        ? {
            internal: gl.SRGB8_ALPHA8,
            format: gl.RGBA,
            type: gl.UNSIGNED_BYTE,
            channels,
            kind: 'float',
            bgra,
          }
        : undefined;
    return {
      internal: g[`${C}8`]!,
      format: g[base]!,
      type: gl.UNSIGNED_BYTE,
      channels,
      kind: 'float',
      bgra,
    };
  }
  if (srgb !== undefined) return undefined;
  if (kind === 'snorm' && bits === 8)
    return {
      internal: g[`${C}8_SNORM`]!,
      format: g[base]!,
      type: gl.BYTE,
      channels,
      kind: 'float',
    };
  if (kind === 'float' && bits !== 8)
    return {
      internal: g[`${C}${bits}F`]!,
      format: g[base]!,
      type: bits === 16 ? gl.HALF_FLOAT : gl.FLOAT,
      channels,
      kind: 'float',
    };
  if (kind === 'uint' || kind === 'sint') {
    const u = kind === 'uint';
    const type =
      bits === 8
        ? u
          ? gl.UNSIGNED_BYTE
          : gl.BYTE
        : bits === 16
          ? u
            ? gl.UNSIGNED_SHORT
            : gl.SHORT
          : u
            ? gl.UNSIGNED_INT
            : gl.INT;
    const internal = g[`${C}${bits}${u ? 'UI' : 'I'}`];
    return internal === undefined
      ? undefined
      : { internal, format: g[`${base}_INTEGER`]!, type, channels, kind };
  }
  return undefined;
}

function depth(internal: number, format: number, type: number): GlFormat {
  return { internal, format, type, channels: 1, kind: 'depth' };
}

// ─── the drawing state of one context ────────────────────────────────────────────────────────

/** What every texture, pipeline and pass of one runtime shares on its context. */
export class GlDrawing {
  readonly fbo: WebGLFramebuffer;
  readonly blitFbo: WebGLFramebuffer;
  /** Where a texture paired with no sampler is read from: nearest, clamped. */
  readonly nearest: WebGLSampler;
  #guard: WebGLTexture | undefined;
  #screen: { tex: WebGLTexture; w: number; h: number } | undefined;
  /** What a `Resident` uploaded last, by what it became: a buffer or a data texture. */
  readonly uploads = new WeakMap<
    ResidentArrayState,
    Map<string, { obj: object; version: number }>
  >();

  constructor(readonly gl: GL) {
    // A float target (`rgba16float`, `r32float`) and a filtered `f32` texture each need the
    // extension that allows them; one the context lacks leaves such a texture incomplete, and
    // its draw is refused by WebGL2 where WebGPU would refuse its format.
    for (const ext of [
      'EXT_color_buffer_float',
      'EXT_color_buffer_half_float',
      'OES_texture_float_linear',
    ])
      gl.getExtension(ext);
    this.fbo = gl.createFramebuffer()!;
    this.blitFbo = gl.createFramebuffer()!;
    this.nearest = gl.createSampler()!;
    gl.samplerParameteri(this.nearest, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.nearest, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.nearest, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.nearest, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** The `_fp64` guard: a 1 × 1 texture that holds 1.0. */
  guard(): WebGLTexture {
    if (this.#guard === undefined) {
      const gl = this.gl;
      this.#guard = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.#guard);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([255, 255, 255, 255]),
      );
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    return this.#guard;
  }

  /** The texture a pass into the canvas draws into, the drawing buffer's size, turned over onto
   *  the screen once the pass is done. */
  screen(): { tex: WebGLTexture; w: number; h: number } {
    const gl = this.gl;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (this.#screen === undefined || this.#screen.w !== w || this.#screen.h !== h) {
      if (this.#screen !== undefined) gl.deleteTexture(this.#screen.tex);
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.#screen = { tex, w, h };
    }
    return this.#screen;
  }

  /** The upload of `state` as `as`, made again only when its host copy has changed. */
  uploaded<T extends object>(
    state: ResidentArrayState,
    as: string,
    make: (old: T | undefined) => T,
  ): T {
    let byKind = this.uploads.get(state);
    if (byKind === undefined) this.uploads.set(state, (byKind = new Map()));
    const hit = byKind.get(as);
    if (hit !== undefined && hit.version === state.version) return hit.obj as T;
    const obj = make(hit?.obj as T | undefined);
    byKind.set(as, { obj, version: state.version });
    return obj;
  }
}

// ─── textures and samplers ───────────────────────────────────────────────────────────────────

/** A texture of the WebGL2 tier: a sampled texture and a render target at once. */
export class GlTextureImpl implements Texture {
  #tex: WebGLTexture;
  #w: number;
  #h: number;
  readonly #fmt: GlFormat;

  constructor(
    private readonly d: GlDrawing,
    options: TextureOptions | object,
  ) {
    const o = options as TextureOptions;
    if (
      typeof o !== 'object' ||
      o === null ||
      !Array.isArray(o.size) ||
      typeof o.format !== 'string'
    )
      throw new TypeError(
        `texture() on WebGL2 takes { size, format }; got ${describe(options)}. A host's own texture is bound as it is, not wrapped.`,
      );
    if ((o.dimension ?? '2d') !== '2d' || (o.size[2] ?? 1) !== 1)
      throw new TypeError(
        'texture(): the WebGL2 tier makes 2D textures of one layer; an array or a 3D texture is not here yet.',
      );
    if ((o.sampleCount ?? 1) !== 1)
      throw new TypeError(
        'texture(): the WebGL2 tier has no multisampled texture: GLSL ES 3.00 cannot read one (sampler2DMS is ES 3.10).',
      );
    if (o.storage === true)
      throw new TypeError('texture(): the WebGL2 tier has no storage texture yet.');
    const fmt = formatOf(d.gl, o.format);
    if (fmt === undefined) throw new TypeError(`texture(): WebGL2 has no ${o.format} texture.`);
    this.format = o.format;
    this.#fmt = fmt;
    this.#w = o.size[0];
    this.#h = o.size[1];
    this.#tex = this.#make();
  }

  readonly format: string;

  #make(): WebGLTexture {
    const gl = this.d.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, this.#fmt.internal, this.#w, this.#h);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return t;
  }

  get texture(): object {
    return this.#tex;
  }
  get width(): number {
    return this.#w;
  }
  get height(): number {
    return this.#h;
  }
  /** How the texels are cleared and read. */
  get gl(): GlFormat {
    return this.#fmt;
  }

  resize(width: number, height: number): void {
    if (width === this.#w && height === this.#h) return;
    const old = this.#tex;
    this.#w = width;
    this.#h = height;
    this.#tex = this.#make();
    // A frame submitted before the resize still draws into the texture it named.
    kernelQueue.whenIdle(() => this.d.gl.deleteTexture(old));
  }

  read(): Promise<Uint8Array> {
    try {
      return this.#read('read');
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  readFloats(): Promise<Float32Array> {
    try {
      const layout = layoutOf(this.format);
      if (layout?.floats === undefined)
        throw new TypeError(
          layout === undefined
            ? `readFloats() cannot copy a ${this.format} texture back; it copies every uncompressed colour format and depth32float.`
            : `readFloats() takes a float, unorm or snorm format and depth32float; a ${this.format} texture holds integers, which read() gives as bytes.`,
        );
      const floats = layout.floats;
      return this.#read('readFloats').then((bytes) => floats(bytes));
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  /** The texels as the format's bytes, rows tightly packed, row 0 the top. The read is queued
   *  where it is called, so it reads what was submitted before the call. */
  #read(who: string): Promise<Uint8Array> {
    const layout = layoutOf(this.format);
    if (layout === undefined || (this.#fmt.kind === 'depth' && this.format !== 'depth32float'))
      throw new TypeError(
        `${who}() cannot copy a ${this.format} texture back; it copies every uncompressed colour format and depth32float.`,
      );
    if (/snorm$/.test(this.format))
      throw new TypeError(
        `${who}(): WebGL2 renders into no ${this.format} texture, and reads none back.`,
      );
    const tex = this.#tex;
    const w = this.#w;
    const h = this.#h;
    return kernelQueue.run(() =>
      readTexels(this.d, tex, this.format, this.#fmt, w, h, layout.bytes),
    );
  }

  destroy(): void {
    const t = this.#tex;
    kernelQueue.whenIdle(() => this.d.gl.deleteTexture(t));
  }
}

/** A sampler of the WebGL2 tier. */
export class GlSamplerImpl implements Sampler {
  readonly #s: WebGLSampler;
  constructor(gl: GL, options: SamplerOptions | object | undefined) {
    const o = (options ?? {}) as SamplerOptions;
    if (typeof WebGLSampler !== 'undefined' && options instanceof WebGLSampler) {
      this.#s = options;
      return;
    }
    const s = gl.createSampler()!;
    const filter = (o.filter ?? 'linear') === 'nearest' ? gl.NEAREST : gl.LINEAR;
    const wrap =
      o.address === 'repeat'
        ? gl.REPEAT
        : o.address === 'mirror'
          ? gl.MIRRORED_REPEAT
          : gl.CLAMP_TO_EDGE;
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, filter);
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, filter);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, wrap);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, wrap);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_R, wrap);
    if (o.compare !== undefined) {
      gl.samplerParameteri(s, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
      gl.samplerParameteri(s, gl.TEXTURE_COMPARE_FUNC, compareOf(gl, o.compare));
    }
    this.#s = s;
  }
  get sampler(): object {
    return this.#s;
  }
}

function compareOf(gl: GL, c: string): number {
  const f = (
    {
      never: gl.NEVER,
      less: gl.LESS,
      equal: gl.EQUAL,
      'less-equal': gl.LEQUAL,
      greater: gl.GREATER,
      'not-equal': gl.NOTEQUAL,
      'greater-equal': gl.GEQUAL,
      always: gl.ALWAYS,
    } as Record<string, number>
  )[c];
  if (f === undefined)
    throw new TypeError(
      `"${c}" is not a comparison; WebGPU's are less, less-equal, greater, greater-equal, equal, not-equal, always and never.`,
    );
  return f;
}

// ─── reading texels back ─────────────────────────────────────────────────────────────────────

/** Read `tex` back as the bytes of `format`, as WebGPU's copy gives them. */
async function readTexels(
  d: GlDrawing,
  tex: WebGLTexture,
  format: string,
  fmt: GlFormat,
  w: number,
  h: number,
  bytes: number,
): Promise<Uint8Array> {
  const gl = d.gl;
  let source = tex;
  let scratch: WebGLTexture | undefined;
  if (fmt.kind === 'depth') {
    // WebGL2 reads no depth back: a pass copies it into an r32float texture first.
    scratch = depthToColour(d, tex, w, h);
    source = scratch;
  }
  // `readPixels` takes each class in one format and type: RGBA bytes, RGBA floats, RGBA
  // integers, or the packed 10-10-10-2 word.
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
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, d.blitFbo);
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

/** The RGBA read of `texels` texels as the bytes WebGPU's copy of `format` gives. */
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

/** A number a half float holds, as the half float's bits. */
function halfBits(v: number): number {
  const sign = Object.is(v, -0) || v < 0 ? 0x8000 : 0;
  return sign | smallBits(Math.abs(v), 10);
}

/** A non-negative number an unsigned float of a 5-bit exponent and `m` mantissa bits holds, as
 *  its bits. */
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

/** An r32float copy of the depth texture `tex`, texel for texel. */
function depthToColour(d: GlDrawing, tex: WebGLTexture, w: number, h: number): WebGLTexture {
  const gl = d.gl;
  const out = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, out);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, w, h);
  gl.bindTexture(gl.TEXTURE_2D, null);
  const program = compile(gl, BLIT_VS, DEPTH_FS, 'the depth read-back');
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, d.blitFbo);
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
  gl.bindSampler(0, d.nearest);
  gl.uniform1i(gl.getUniformLocation(program, 'd'), 0);
  gl.bindVertexArray(null);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  return out;
}

// ─── render pipelines ────────────────────────────────────────────────────────────────────────

/** The trivial fragment program of a depth-only pipeline. */
const NO_COLOUR = `#version 300 es
precision highp float;
void main() {}
`;

/** `vertex` with its position turned to GL's: y flipped, depth from 0..w to -w..w. */
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

const TOPOLOGY: Readonly<
  Record<string, 'TRIANGLES' | 'TRIANGLE_STRIP' | 'LINES' | 'LINE_STRIP' | 'POINTS'>
> = {
  'triangle-list': 'TRIANGLES',
  'triangle-strip': 'TRIANGLE_STRIP',
  'line-list': 'LINES',
  'line-strip': 'LINE_STRIP',
  'point-list': 'POINTS',
};

const BLEND_FACTOR: Readonly<Record<string, string>> = {
  zero: 'ZERO',
  one: 'ONE',
  src: 'SRC_COLOR',
  'one-minus-src': 'ONE_MINUS_SRC_COLOR',
  'src-alpha': 'SRC_ALPHA',
  'one-minus-src-alpha': 'ONE_MINUS_SRC_ALPHA',
  dst: 'DST_COLOR',
  'one-minus-dst': 'ONE_MINUS_DST_COLOR',
  'dst-alpha': 'DST_ALPHA',
  'one-minus-dst-alpha': 'ONE_MINUS_DST_ALPHA',
  'src-alpha-saturated': 'SRC_ALPHA_SATURATE',
  constant: 'CONSTANT_COLOR',
  'one-minus-constant': 'ONE_MINUS_CONSTANT_COLOR',
};

const BLEND_OP: Readonly<Record<string, string>> = {
  add: 'FUNC_ADD',
  subtract: 'FUNC_SUBTRACT',
  'reverse-subtract': 'FUNC_REVERSE_SUBTRACT',
  min: 'MIN',
  max: 'MAX',
};

interface BlendComponent {
  readonly srcFactor?: string;
  readonly dstFactor?: string;
  readonly operation?: string;
}

/** What a pipeline sets before each draw. */
interface DrawState {
  readonly mode: number;
  readonly depth?: { readonly func: number; readonly write: boolean };
  readonly cull?: number;
  readonly frontFace: number;
  readonly blend?: {
    readonly src: [number, number];
    readonly dst: [number, number];
    readonly op: [number, number];
  };
  readonly mask: readonly [boolean, boolean, boolean, boolean];
}

/** One binding a pipeline's program reads, and where. */
interface Slot {
  readonly binding: PackBinding;
  readonly kind: 'block' | 'texture' | 'data';
  /** The uniform block's binding point, or the texture unit. */
  readonly unit: number;
  /** The sampler binding a texture is read with, or null for none. */
  readonly sampler?: string | null;
  readonly layout?: Layout;
}

/** The program of a load on WebGL2: its manifest's vertex and fragment programs. */
export class GlRenderPrograms {
  readonly #pipelines = new Map<string, GlRenderPipelineImpl>();
  readonly #bindings: ReadonlyMap<string, PackBinding>;

  constructor(
    readonly d: GlDrawing,
    readonly manifest: Pack,
  ) {
    this.#bindings = new Map(manifest.bindings.map((b) => [b.name, b]));
  }

  render(state: RenderState): RenderPipeline {
    const m = this.manifest;
    const vs = entryOf(m, state.vertex, 'vertex');
    const fs =
      state.fragment === null ? undefined : entryOf(m, state.fragment ?? undefined, 'fragment');
    const constants = constantsOf(m, state.constants);
    const key = JSON.stringify({
      ...state,
      vertex: vs.name,
      fragment: fs?.name ?? null,
      constants: constants?.key,
    });
    let p = this.#pipelines.get(key);
    if (p === undefined) {
      const v = stageOf(m.gl?.vertices?.[vs.name], vs);
      const f = fs === undefined ? undefined : stageOf(m.gl?.draws?.[fs.name], fs);
      if ((state.multisample?.count ?? 1) !== 1)
        throw new TypeError(
          `The render pipeline of "${(fs ?? vs).name}"${at(fs ?? vs)}: the WebGL2 tier draws with one sample; a multisampled target is not here.`,
        );
      const targets = fs === undefined ? [] : targetsOf(fs, state.targets);
      const pin = (src: string): string =>
        constants === undefined ? src : pinOverrides(src, constants.values);
      const vertex = toGlClip(pin((v as PackGlVertex).vertex));
      const fragment = f === undefined ? NO_COLOUR : pin((f as PackGlDraw).fragment);
      const gl = this.d.gl;
      const program = compile(
        gl,
        vertex,
        fragment,
        `the render pipeline of "${vs.name}" and "${fs?.name ?? 'no fragment'}"`,
      );
      p = new GlRenderPipelineImpl(
        this,
        vs,
        fs,
        program,
        this.#slots(program, v as PackGlVertex, f),
        this.#state(state, targets, fs),
      );
      this.#pipelines.set(key, p);
    }
    return p;
  }

  /** Each binding the two programs read, at its block binding point or texture unit, set on
   *  `program` once: the units are the same for every pipeline that links the same programs. */
  #slots(program: WebGLProgram, v: PackGlVertex, f: PackGlDraw | undefined): Slot[] {
    const gl = this.d.gl;
    const blocks = { ...v.blocks, ...f?.blocks };
    const samplers = { ...v.samplers, ...f?.samplers };
    const data = [...new Set([...(v.data ?? []), ...(f?.data ?? [])])];
    const slots: Slot[] = [];
    gl.useProgram(program);
    Object.keys(blocks)
      .sort()
      .forEach((name, i) => {
        const b = this.#bindings.get(name)!;
        gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, blocks[name]!), i);
        slots.push({
          binding: b,
          kind: 'block',
          unit: i,
          ...(b.layout !== undefined ? { layout: layoutFromPack(b.layout) } : {}),
        });
      });
    const sampled = [...Object.keys(samplers).sort(), ...data.sort()];
    sampled.forEach((name, unit) => {
      const b = this.#bindings.get(name)!;
      gl.uniform1i(gl.getUniformLocation(program, name), unit);
      if (data.includes(name))
        slots.push({
          binding: b,
          kind: 'data',
          unit,
          ...(b.layout !== undefined ? { layout: layoutFromPack(b.layout) } : {}),
        });
      else slots.push({ binding: b, kind: 'texture', unit, sampler: samplers[name] ?? null });
    });
    gl.useProgram(null);
    return slots;
  }

  #state(
    state: RenderState,
    targets: readonly {
      readonly format: string;
      readonly blend?: object;
      readonly writeMask?: number;
    }[],
    fs: PackEntry | undefined,
  ): DrawState {
    const gl = this.d.gl;
    const where = `The render pipeline of "${(fs ?? entryOf(this.manifest, state.vertex, 'vertex')).name}"`;
    const topology = TOPOLOGY[state.primitive?.topology ?? 'triangle-list'];
    if (topology === undefined)
      throw new TypeError(
        `${where}: "${String(state.primitive?.topology)}" is not a topology; WebGPU's are ${Object.keys(TOPOLOGY).join(', ')}.`,
      );
    // WebGL2 has one blend state and one write mask for every target.
    const first = targets[0];
    for (const t of targets.slice(1))
      if (
        JSON.stringify(t.blend) !== JSON.stringify(first?.blend) ||
        (t.writeMask ?? 15) !== (first?.writeMask ?? 15)
      )
        throw new TypeError(
          `${where}: WebGL2 blends and masks every target alike; give its targets one blend and one writeMask.`,
        );
    const blend = first?.blend as { color?: BlendComponent; alpha?: BlendComponent } | undefined;
    const factor = (f: string | undefined, d: string): number => {
      const n = BLEND_FACTOR[f ?? d];
      if (n === undefined) throw new TypeError(`${where}: "${String(f)}" is not a blend factor.`);
      return (gl as unknown as Record<string, number>)[n]!;
    };
    const op = (o: string | undefined): number => {
      const n = BLEND_OP[o ?? 'add'];
      if (n === undefined)
        throw new TypeError(`${where}: "${String(o)}" is not a blend operation.`);
      return (gl as unknown as Record<string, number>)[n]!;
    };
    const mask = first?.writeMask ?? 15;
    const cull = state.primitive?.cullMode ?? 'none';
    return {
      mode: gl[topology],
      ...(state.depth !== undefined
        ? {
            depth: {
              func: compareOf(gl, state.depth.compare ?? 'less'),
              write: state.depth.write ?? true,
            },
          }
        : {}),
      ...(cull === 'none' ? {} : { cull: cull === 'front' ? gl.FRONT : gl.BACK }),
      // The flip in y turns the winding round.
      frontFace: (state.primitive?.frontFace ?? 'ccw') === 'ccw' ? gl.CW : gl.CCW,
      ...(blend !== undefined
        ? {
            blend: {
              src: [factor(blend.color?.srcFactor, 'one'), factor(blend.alpha?.srcFactor, 'one')],
              dst: [factor(blend.color?.dstFactor, 'zero'), factor(blend.alpha?.dstFactor, 'zero')],
              op: [op(blend.color?.operation), op(blend.alpha?.operation)],
            },
          }
        : {}),
      mask: [(mask & 1) !== 0, (mask & 2) !== 0, (mask & 4) !== 0, (mask & 8) !== 0],
    };
  }
}

/** A stage's program from the manifest, or a `TypeError` that gives why it has none. */
function stageOf<T>(p: T | { readonly none: string } | undefined, e: PackEntry): T {
  if (p === undefined)
    throw new TypeError(
      `The manifest carries no WebGL2 program for "${e.name}"${at(e)}; pack it again with this version of typeshade.`,
    );
  if (typeof p === 'object' && p !== null && 'none' in p)
    throw new TypeError(
      `"${e.name}"${at(e)} has no WebGL2 program: ${(p as { none: string }).none}.`,
    );
  return p as T;
}

/** A draw as recorded: everything it binds, ready to run on the context, and the `Resident`s it
 *  reads, whose host copies the pass brings up to date first. */
interface DrawRun {
  readonly run: (gl: GL) => void;
  readonly residents: readonly ResidentArrayState[];
}

/** A render pipeline of the WebGL2 tier. */
export class GlRenderPipelineImpl implements RenderPipeline {
  readonly #vao: WebGLVertexArrayObject;

  constructor(
    private readonly programs: GlRenderPrograms,
    private readonly vs: PackEntry,
    private readonly fs: PackEntry | undefined,
    private readonly program: WebGLProgram,
    private readonly slots: readonly Slot[],
    private readonly state: DrawState,
  ) {
    this.#vao = programs.d.gl.createVertexArray()!;
  }

  get vertex(): string {
    return this.vs.name;
  }
  get fragment(): string | null {
    return this.fs?.name ?? null;
  }

  draw(target: object, bindings: Bindings, geometry: Geometry): void {
    if (!(target instanceof GlPass))
      throw new TypeError(`draw() on WebGL2 records into a frame's pass; got ${describe(target)}.`);
    const entry = this.fs ?? this.vs;
    if (
      typeof geometry !== 'object' ||
      geometry === null ||
      !Number.isInteger(geometry.count) ||
      geometry.count < 0
    )
      throw new TypeError(
        `"${entry.name}"${at(entry)}: the geometry needs a whole-number count; got ${describe(geometry)}.`,
      );
    target.add(this.#record(entry, bindings, geometry));
  }

  /** Check and take what the draw binds, now, as WebGPU's `writeBuffer` takes a plain value when
   *  the draw is recorded; the GL objects are made when the pass runs. */
  #record(entry: PackEntry, values: Bindings, geometry: Geometry): DrawRun {
    if (typeof values !== 'object' || values === null)
      throw new TypeError(
        `"${entry.name}"${at(entry)}: the bindings are ${describe(values)}, not an object.`,
      );
    const d = this.programs.d;
    const reached = new Set<string>();
    for (const e of [this.vs, this.fs]) for (const b of e?.bindings ?? []) reached.add(b.name);
    for (const name of Object.keys(values))
      if (!reached.has(name))
        throw new TypeError(
          `"${entry.name}"${at(entry)} reaches no binding "${name}"; it binds ${
            [...reached]
              .filter((n) => !n.startsWith('_'))
              .map((n) => `"${n}"`)
              .join(', ') || 'nothing'
          }.`,
        );
    const steps: ((gl: GL, made: object[]) => void)[] = [];
    const residents: ResidentArrayState[] = [];
    for (const s of this.slots) {
      const b = s.binding;
      const where = `"${entry.name}"${at(entry)}, binding "${b.name}" (${b.type})`;
      if (b.name === '_fp64') {
        steps.push((gl) => bindTexture(gl, s.unit, d.guard(), d.nearest));
        continue;
      }
      const v = values[b.name];
      if (v === undefined) throw new TypeError(`${where} is not given.`);
      if (s.kind === 'texture') {
        const tex = textureOf(v, where);
        const sv = s.sampler === null || s.sampler === undefined ? undefined : values[s.sampler];
        const sampler =
          sv === undefined
            ? d.nearest
            : samplerOf(sv, `"${entry.name}"${at(entry)}, binding "${s.sampler}"`);
        steps.push((gl) => bindTexture(gl, s.unit, tex, sampler));
        continue;
      }
      if (typeof WebGLBuffer !== 'undefined' && v instanceof WebGLBuffer && s.kind === 'block') {
        steps.push((gl) => gl.bindBufferBase(gl.UNIFORM_BUFFER, s.unit, v));
        continue;
      }
      if (s.layout === undefined)
        throw new TypeError(
          `${where} has no host value${b.noLayout !== undefined ? `: ${b.noLayout}` : ''}.`,
        );
      const layout = s.layout;
      const state = residentState(v);
      if (state !== undefined) {
        if (state.destroyed)
          throw new TypeError('This Resident was destroyed; make a new one with resident().');
        residents.push(state);
        steps.push((gl, made) => {
          const bytes = packed(layout, state.host, b.name, where);
          if (s.kind === 'block') {
            const buf = gl.createBuffer()!;
            made.push(buf);
            uploadBlock(gl, s.unit, buf, bytes);
          } else
            bindTexture(
              gl,
              s.unit,
              d.uploaded<WebGLTexture>(state, 'data', (old) => {
                if (old !== undefined) gl.deleteTexture(old);
                return dataTexture(gl, b, bytes);
              }),
              d.nearest,
            );
        });
        continue;
      }
      const bytes = packed(layout, v, b.name, where);
      steps.push((gl, made) => {
        if (s.kind === 'block') {
          const buf = gl.createBuffer()!;
          made.push(buf);
          uploadBlock(gl, s.unit, buf, bytes);
        } else {
          const t = dataTexture(gl, b, bytes);
          made.push(t);
          bindTexture(gl, s.unit, t, d.nearest);
        }
      });
    }
    const vertices = this.#vertices(geometry, entry);
    const indices = this.#indices(geometry, entry);
    for (const g of [geometry.vertices, geometry.indices]) {
      const state = residentState(g);
      if (state !== undefined) residents.push(state);
    }
    const count = geometry.count;
    const instances = geometry.instances ?? 1;
    const program = this.program;
    const vao = this.#vao;
    const st = this.state;
    const run = (gl: GL): void => {
      const made: object[] = [];
      gl.useProgram(program);
      for (const step of steps) step(gl, made);
      gl.bindVertexArray(vao);
      vertices?.(gl, made);
      const index = indices?.(gl, made);
      setState(gl, st);
      if (index === undefined) gl.drawArraysInstanced(st.mode, 0, count, instances);
      else gl.drawElementsInstanced(st.mode, count, index, 0, instances);
      gl.bindVertexArray(null);
      for (const o of made)
        if (typeof WebGLBuffer !== 'undefined' && o instanceof WebGLBuffer) gl.deleteBuffer(o);
        else gl.deleteTexture(o as WebGLTexture);
    };
    return { run, residents };
  }

  /** The vertex buffer's attributes, set when the draw runs. */
  #vertices(geometry: Geometry, entry: PackEntry): ((gl: GL, made: object[]) => void) | undefined {
    const layout = this.vs.vertex;
    if (layout === undefined) return undefined;
    const v = geometry.vertices;
    if (v === undefined)
      throw new TypeError(
        `"${this.vs.name}"${at(this.vs)} reads vertex attributes; the geometry gives no vertices.`,
      );
    const d = this.programs.d;
    const source = bufferSource(d, v, 'vertices', entry);
    return (gl, made) => {
      const buffer = source(gl, made, gl.ARRAY_BUFFER);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const a of layout.attributes) {
        const [kind, n] = a.format.split('x') as [string, string?];
        const size = Number(n ?? 1);
        gl.enableVertexAttribArray(a.location);
        if (kind === 'float32')
          gl.vertexAttribPointer(a.location, size, gl.FLOAT, false, layout.arrayStride, a.offset);
        else
          gl.vertexAttribIPointer(
            a.location,
            size,
            kind === 'uint32' ? gl.UNSIGNED_INT : gl.INT,
            layout.arrayStride,
            a.offset,
          );
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    };
  }

  /** The index buffer, bound when the draw runs; the index type, or undefined for none. */
  #indices(geometry: Geometry, entry: PackEntry): ((gl: GL, made: object[]) => number) | undefined {
    const idx = geometry.indices;
    if (idx === undefined) return undefined;
    const d = this.programs.d;
    if (residentState(idx) !== undefined || ArrayBuffer.isView(idx)) {
      const wide = residentState(idx) !== undefined || idx instanceof Uint32Array;
      const source = bufferSource(d, idx, 'indices', entry);
      return (gl, made) => {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, source(gl, made, gl.ELEMENT_ARRAY_BUFFER));
        return wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      };
    }
    const host = idx as { readonly buffer: object; readonly format: 'uint16' | 'uint32' };
    if (typeof WebGLBuffer === 'undefined' || !(host.buffer instanceof WebGLBuffer))
      throw new TypeError(
        `"${entry.name}"${at(entry)}: the geometry's indices on WebGL2 take a typed array, a Resident or { buffer: WebGLBuffer, format }.`,
      );
    return (gl) => {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, host.buffer as WebGLBuffer);
      return host.format === 'uint32' ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    };
  }
}

/** Where a draw's vertices or indices come from: a typed array, copied now and uploaded when the
 *  draw runs; a `Resident`, uploaded when its host copy has changed; or the host's buffer. */
function bufferSource(
  d: GlDrawing,
  v: unknown,
  field: 'vertices' | 'indices',
  entry: PackEntry,
): (gl: GL, made: object[], target: number) => WebGLBuffer {
  const state = residentState(v);
  if (state !== undefined) {
    const host = state.host;
    const takes =
      field === 'indices'
        ? host instanceof Uint32Array
        : host instanceof Float32Array || host instanceof Int32Array || host instanceof Uint32Array;
    if (!takes)
      throw new TypeError(
        `"${entry.name}"${at(entry)}: the geometry's ${field} is a Resident of ${describe(host)}; ${
          field === 'indices'
            ? 'indices take a Resident of a Uint32Array'
            : 'vertices take a Resident of a Float32Array, an Int32Array or a Uint32Array'
        }.`,
      );
    return (gl, _made, target) =>
      d.uploaded<WebGLBuffer>(state, field, (old) => {
        const b = old ?? gl.createBuffer()!;
        gl.bindBuffer(target, b);
        gl.bufferData(target, state.host as ArrayBufferView, gl.STATIC_DRAW);
        gl.bindBuffer(target, null);
        return b;
      });
  }
  if (ArrayBuffer.isView(v)) {
    const copy = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    return (gl, made, target) => {
      const b = gl.createBuffer()!;
      made.push(b);
      gl.bindBuffer(target, b);
      gl.bufferData(target, copy, gl.STREAM_DRAW);
      gl.bindBuffer(target, null);
      return b;
    };
  }
  if (typeof WebGLBuffer !== 'undefined' && v instanceof WebGLBuffer) return () => v;
  throw new TypeError(
    `"${entry.name}"${at(entry)}: the geometry's ${field} on WebGL2 take a typed array, a Resident or a WebGLBuffer; got ${describe(v)}.`,
  );
}

/** `v` packed by `layout`, or a `TypeError` naming the binding. */
function packed(layout: Layout, v: unknown, name: string, where: string): Uint8Array {
  try {
    const bytes = new ArrayBuffer(byteSize(layout, v, name));
    pack(new DataView(bytes), 0, layout, v, name);
    return new Uint8Array(bytes);
  } catch (err) {
    if (err instanceof Misfit) throw new TypeError(`${where}: ${err.path} ${err.problem}.`);
    throw err;
  }
}

/** A uniform block's bytes at binding point `unit`, padded to std140's 16. */
function uploadBlock(gl: GL, unit: number, buf: WebGLBuffer, bytes: Uint8Array): void {
  const size = Math.max(16, Math.ceil(bytes.byteLength / 16) * 16);
  const data = new Uint8Array(size);
  data.set(bytes);
  gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
  gl.bufferData(gl.UNIFORM_BUFFER, data, gl.STREAM_DRAW);
  gl.bindBuffer(gl.UNIFORM_BUFFER, null);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, unit, buf);
}

/** The widest row a data texture takes. */
const DATA_WIDTH = 2048;

/** A read-only storage array as the data texture GLSL ES 3.00 reads it from: its std430 words,
 *  one a texel, in rows of {@link DATA_WIDTH}. */
function dataTexture(gl: GL, b: PackBinding, bytes: Uint8Array): WebGLTexture {
  const format = b.dataTexture?.format ?? 'r32float';
  const words = Math.max(1, Math.ceil(bytes.byteLength / 4));
  const w = Math.min(words, DATA_WIDTH);
  const h = Math.ceil(words / w);
  const data = new Uint8Array(w * h * 4);
  data.set(bytes);
  const [internal, fmt, type, view] =
    format === 'r32uint'
      ? [gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, new Uint32Array(data.buffer)]
      : format === 'r32sint'
        ? [gl.R32I, gl.RED_INTEGER, gl.INT, new Int32Array(data.buffer)]
        : [gl.R32F, gl.RED, gl.FLOAT, new Float32Array(data.buffer)];
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, fmt, type, view);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return t;
}

function bindTexture(gl: GL, unit: number, tex: WebGLTexture, sampler: WebGLSampler): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.bindSampler(unit, sampler);
}

/** The texture a binding names, taken now: the WebGL2 texture a resize after the draw does not
 *  move. */
function textureOf(v: unknown, where: string): WebGLTexture {
  if (v instanceof GlTextureImpl) return v.texture as WebGLTexture;
  if (typeof WebGLTexture !== 'undefined' && v instanceof WebGLTexture) return v;
  throw new TypeError(
    `${where} takes a Texture of the runtime or a WebGLTexture; got ${describe(v)}.`,
  );
}

function samplerOf(v: unknown, where: string): WebGLSampler {
  if (v instanceof GlSamplerImpl) return v.sampler as WebGLSampler;
  if (typeof WebGLSampler !== 'undefined' && v instanceof WebGLSampler) return v;
  throw new TypeError(
    `${where} takes a Sampler of the runtime or a WebGLSampler; got ${describe(v)}.`,
  );
}

function setState(gl: GL, s: DrawState): void {
  if (s.depth === undefined) gl.disable(gl.DEPTH_TEST);
  else {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(s.depth.func);
    gl.depthMask(s.depth.write);
  }
  if (s.cull === undefined) gl.disable(gl.CULL_FACE);
  else {
    gl.enable(gl.CULL_FACE);
    gl.cullFace(s.cull);
  }
  gl.frontFace(s.frontFace);
  if (s.blend === undefined) gl.disable(gl.BLEND);
  else {
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(s.blend.src[0], s.blend.dst[0], s.blend.src[1], s.blend.dst[1]);
    gl.blendEquationSeparate(s.blend.op[0], s.blend.op[1]);
  }
  gl.colorMask(...s.mask);
}

// ─── passes ──────────────────────────────────────────────────────────────────────────────────

/** A render pass of a frame on WebGL2: the draws recorded into it. */
export class GlPass implements RenderPass {
  readonly draws: DrawRun[] = [];

  get raw(): object {
    throw new TypeError('A pass on WebGL2 has no GPURenderPassEncoder.');
  }

  add(run: DrawRun): void {
    this.draws.push(run);
  }

  draw<B>(pipeline: RenderPipeline<B>, bindings: NoInfer<B>, geometry: Geometry): void {
    pipeline.draw(this, bindings, geometry);
  }
}

/** One colour attachment as recorded: a texture, or the canvas the runtime draws to. */
interface Attachment {
  readonly tex: WebGLTexture | 'screen';
  readonly kind: GlFormat['kind'];
  readonly clear: readonly number[];
  readonly load: 'clear' | 'load';
  readonly w: number;
  readonly h: number;
}

/** Record a pass: its attachments checked and taken now, its draws as `record` records them. The
 *  run draws them when the frame is submitted. */
export function recordPass(
  d: GlDrawing,
  targets: PassTargets,
  record: (pass: RenderPass) => void,
): () => Promise<void> {
  const gl = d.gl;
  const colour: Attachment[] = (targets.color ?? []).map((c, i) => {
    const spec = (typeof c === 'object' && c !== null && 'target' in c ? c : { target: c }) as {
      target: object;
      clear?: readonly number[];
      load?: 'clear' | 'load';
    };
    const t = spec.target;
    const common = { clear: spec.clear ?? [0, 0, 0, 0], load: spec.load ?? 'clear' } as const;
    if (t instanceof GlTextureImpl) {
      if (t.gl.kind === 'depth')
        throw new TypeError(
          `pass(): colour target ${i} is a ${t.format} texture, which holds depth.`,
        );
      return {
        tex: t.texture as WebGLTexture,
        kind: t.gl.kind,
        w: t.width,
        h: t.height,
        ...common,
      };
    }
    if (t === gl || t === gl.canvas)
      return {
        tex: 'screen',
        kind: 'float',
        w: gl.drawingBufferWidth,
        h: gl.drawingBufferHeight,
        ...common,
      };
    throw new TypeError(
      `pass(): a colour target on WebGL2 is a Texture of the runtime, or its context for the canvas; got ${describe(t)}.`,
    );
  });
  const ds = targets.depth;
  const depthSpec =
    ds === undefined
      ? undefined
      : ds instanceof GlTextureImpl
        ? { target: ds }
        : (ds as { target: Texture; clear?: number; load?: 'clear' | 'load' });
  let depth:
    | {
        tex: WebGLTexture;
        stencil: boolean;
        clear: number;
        load: 'clear' | 'load';
        w: number;
        h: number;
      }
    | undefined;
  if (depthSpec !== undefined) {
    const t = depthSpec.target;
    if (!(t instanceof GlTextureImpl) || t.gl.kind !== 'depth')
      throw new TypeError(
        `pass(): the depth target on WebGL2 is a depth Texture of the runtime; got ${describe(t)}.`,
      );
    depth = {
      tex: t.texture as WebGLTexture,
      stencil: /stencil/.test(t.format),
      clear: depthSpec.clear ?? 1,
      load: depthSpec.load ?? 'clear',
      w: t.width,
      h: t.height,
    };
  }
  const sizes = [...colour, ...(depth === undefined ? [] : [depth])];
  const w = sizes[0]?.w ?? 0;
  const h = sizes[0]?.h ?? 0;
  if (sizes.some((a) => a.w !== w || a.h !== h))
    throw new TypeError('pass(): every attachment of a pass has one size.');
  const pass = new GlPass();
  record(pass);
  const draws = pass.draws;
  return async () => {
    // A Resident a WebGPU call wrote is read back first: the draws read the host copy.
    for (const draw of draws)
      for (const state of draw.residents) if (state.fresh === 'device') await state.sync();
    const screen = colour.some((a) => a.tex === 'screen') ? d.screen() : undefined;
    gl.bindFramebuffer(gl.FRAMEBUFFER, d.fbo);
    const buffers: number[] = [];
    colour.forEach((a, i) => {
      const tex = a.tex === 'screen' ? screen!.tex : a.tex;
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
      buffers.push(gl.COLOR_ATTACHMENT0 + i);
    });
    for (let i = colour.length; i < 8; i++)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, null, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, null, 0);
    if (depth !== undefined)
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        depth.stencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT,
        gl.TEXTURE_2D,
        depth.tex,
        0,
      );
    // A pass that loads the canvas starts from what the screen shows, turned over.
    colour.forEach((a, i) => {
      if (a.tex === 'screen' && a.load === 'load') blitScreen(d, i, 'in');
    });
    gl.drawBuffers(buffers.length > 0 ? buffers : [gl.NONE]);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    colour.forEach((a, i) => {
      if (a.load !== 'clear') return;
      if (a.kind === 'uint') gl.clearBufferuiv(gl.COLOR, i, new Uint32Array(pad(a.clear)));
      else if (a.kind === 'sint') gl.clearBufferiv(gl.COLOR, i, new Int32Array(pad(a.clear)));
      else gl.clearBufferfv(gl.COLOR, i, new Float32Array(pad(a.clear)));
    });
    if (depth !== undefined && depth.load === 'clear') {
      gl.depthMask(true);
      if (depth.stencil) gl.clearBufferfi(gl.DEPTH_STENCIL, 0, depth.clear, 0);
      else gl.clearBufferfv(gl.DEPTH, 0, new Float32Array([depth.clear]));
    }
    for (const draw of draws) draw.run(gl);
    gl.useProgram(null);
    colour.forEach((a, i) => {
      if (a.tex === 'screen') blitScreen(d, i, 'out');
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
}

const pad = (v: readonly number[]): number[] => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0];

/** Copy the canvas's texture onto the screen (`out`), or the screen into it (`in`), turned over
 *  in y: the texture's row 0 is the top, and the screen's is the bottom. */
function blitScreen(d: GlDrawing, attachment: number, way: 'in' | 'out'): void {
  const gl = d.gl;
  const { w, h } = d.screen();
  const fbo = d.fbo;
  if (way === 'out') {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
  } else {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
    gl.readBuffer(gl.BACK);
    // Only the canvas's attachment takes the copy.
    const only = Array.from({ length: attachment + 1 }, (_, k) =>
      k === attachment ? gl.COLOR_ATTACHMENT0 + attachment : gl.NONE,
    );
    gl.drawBuffers(only);
  }
  gl.blitFramebuffer(0, 0, w, h, 0, h, w, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
}
