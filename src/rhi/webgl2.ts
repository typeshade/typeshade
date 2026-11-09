// The WebGL2 backend of the render hardware interface (change 0120, D1, milestone M2): an
// `RhiDevice` over a `WebGL2RenderingContext`. It is the one file of the program runtime that
// calls the context; the runtime's WebGL2 tier (`runtime/gl.ts`, `runtime/gl-draw.ts`) records
// through it. Its programs are the GLSL ES 3.00 programs the manifest carries (`gl.vertices`,
// `gl.draws`); it builds none, so like the rest of the runtime it imports no compiler.
//
// WebGPU's conventions, kept (change 0054). A vertex program's position is flipped in y and its
// depth moved from WebGPU's 0..w to GL's -w..w, so a texture's row 0 is the top row a WebGPU pass
// draws, a fragment's `position` is WebGPU's, and a depth value is the one WebGPU stores. The flip
// turns the winding round, so `frontFace: 'ccw'` is GL's clockwise. A texture written or read back
// keeps WebGPU's row order with no copy turned over; only a pass into the canvas is turned over,
// once, as it is copied to the screen.
//
// Buffers. WebGL2 runs no shader that writes a buffer here: a storage buffer is a data texture its
// programs only read (change 0046), as X-GIS's `storage-data-texture.ts` makes one, with the
// element type the buffer carries (`elem`). So each buffer keeps its bytes on the host, and the GL
// object a command reads (an array buffer, a uniform block, a data texture) is made from them when
// the command runs. A read of a buffer is a copy of those bytes.
//
// Immediate. WebGL2 has no command buffer, so the encoder runs each command when it is recorded
// (`caps.immediate`), as X-GIS's WebGL2 encoder does. A pass is begun, drawn and ended at its
// record, and `submit` has nothing left to run. A read of a texture waits on a fence.
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
  RhiCompareFunction,
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
  RhiStencilOperation,
  RhiTexture,
  RhiTextureDesc,
  RhiTextureView,
  RhiVertexBufferLayout,
} from './rhi.js';

type GL = WebGL2RenderingContext;

// ─── formats ─────────────────────────────────────────────────────────────────────────────────

/** How a texel is cleared and read: a float or normalized colour, an integer one, or depth. */
export type GlTextureKind = 'float' | 'uint' | 'sint' | 'depth';

/** A `GPUTextureFormat` on WebGL2, by the names of its constants: its sized internal format, the
 *  format and type `texImage2D` and `readPixels` speak, its channels and its kind. */
interface FormatSpec {
  readonly internal: string;
  readonly format: string;
  readonly type: string;
  readonly channels: number;
  readonly kind: GlTextureKind;
  /** Blue first: WebGL2 has no BGRA texture, so the texels are RGBA and a read swaps them. */
  readonly bgra?: boolean;
}

/** A format as the context's numbers. */
interface GlFormat {
  readonly internal: number;
  readonly format: number;
  readonly type: number;
  readonly channels: number;
  readonly kind: GlTextureKind;
  readonly bgra?: boolean;
}

const NAMED = /^(r|rg|rgba|bgra)(8|16|32)(unorm|snorm|uint|sint|float)(-srgb)?$/;

const depthSpec = (internal: string, format: string, type: string): FormatSpec => ({
  internal,
  format,
  type,
  channels: 1,
  kind: 'depth',
});

/** The constants of the format `name`, or undefined for a format WebGL2 has no texture of. */
function specOf(name: string): FormatSpec | undefined {
  switch (name) {
    case 'depth16unorm':
      return depthSpec('DEPTH_COMPONENT16', 'DEPTH_COMPONENT', 'UNSIGNED_SHORT');
    case 'depth24plus':
      return depthSpec('DEPTH_COMPONENT24', 'DEPTH_COMPONENT', 'UNSIGNED_INT');
    case 'depth32float':
      return depthSpec('DEPTH_COMPONENT32F', 'DEPTH_COMPONENT', 'FLOAT');
    case 'depth24plus-stencil8':
      return depthSpec('DEPTH24_STENCIL8', 'DEPTH_STENCIL', 'UNSIGNED_INT_24_8');
    case 'depth32float-stencil8':
      return depthSpec('DEPTH32F_STENCIL8', 'DEPTH_STENCIL', 'FLOAT_32_UNSIGNED_INT_24_8_REV');
    case 'rgb10a2unorm':
      return {
        internal: 'RGB10_A2',
        format: 'RGBA',
        type: 'UNSIGNED_INT_2_10_10_10_REV',
        channels: 4,
        kind: 'float',
      };
    case 'rgb10a2uint':
      return {
        internal: 'RGB10_A2UI',
        format: 'RGBA_INTEGER',
        type: 'UNSIGNED_INT_2_10_10_10_REV',
        channels: 4,
        kind: 'uint',
      };
    case 'rg11b10ufloat':
      return {
        internal: 'R11F_G11F_B10F',
        format: 'RGB',
        type: 'UNSIGNED_INT_10F_11F_11F_REV',
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
  const base = channels === 1 ? 'RED' : channels === 2 ? 'RG' : 'RGBA';
  if (kind === 'unorm' && bits === 8) {
    if (srgb !== undefined)
      return channels === 4
        ? {
            internal: 'SRGB8_ALPHA8',
            format: 'RGBA',
            type: 'UNSIGNED_BYTE',
            channels,
            kind: 'float',
            bgra,
          }
        : undefined;
    return {
      internal: `${C}8`,
      format: base,
      type: 'UNSIGNED_BYTE',
      channels,
      kind: 'float',
      bgra,
    };
  }
  if (srgb !== undefined) return undefined;
  if (kind === 'snorm' && bits === 8)
    return { internal: `${C}8_SNORM`, format: base, type: 'BYTE', channels, kind: 'float' };
  if (kind === 'float' && bits !== 8)
    return {
      internal: `${C}${bits}F`,
      format: base,
      type: bits === 16 ? 'HALF_FLOAT' : 'FLOAT',
      channels,
      kind: 'float',
    };
  if (kind === 'uint' || kind === 'sint') {
    const u = kind === 'uint';
    const type =
      bits === 8
        ? u
          ? 'UNSIGNED_BYTE'
          : 'BYTE'
        : bits === 16
          ? u
            ? 'UNSIGNED_SHORT'
            : 'SHORT'
          : u
            ? 'UNSIGNED_INT'
            : 'INT';
    return {
      internal: `${C}${bits}${u ? 'UI' : 'I'}`,
      format: `${base}_INTEGER`,
      type,
      channels,
      kind,
    };
  }
  return undefined;
}

/** How a texel of `format` is cleared and read on WebGL2, or undefined for a format WebGL2 has no
 *  texture of. */
export function textureKindOf(format: string): GlTextureKind | undefined {
  return specOf(format)?.kind;
}

/** `name` on `gl`, or undefined for a format WebGL2 has no texture of. */
function formatOf(gl: GL, name: string): GlFormat | undefined {
  const spec = specOf(name);
  if (spec === undefined) return undefined;
  const g = gl as unknown as Record<string, number | undefined>;
  const internal = g[spec.internal];
  // A context that lacks an integer format makes no texture of it.
  if (internal === undefined && (spec.kind === 'uint' || spec.kind === 'sint')) return undefined;
  return {
    internal: internal!,
    format: g[spec.format]!,
    type: g[spec.type]!,
    channels: spec.channels,
    kind: spec.kind,
    ...(spec.bgra === true ? { bgra: true } : {}),
  };
}

// ─── the state of one context ────────────────────────────────────────────────────────────────

/** `EXT_polygon_offset_clamp`: `polygonOffsetClampEXT(factor, units, clamp)`. */
interface PolygonOffsetClamp {
  polygonOffsetClampEXT(factor: number, units: number, clamp: number): void;
}

/** What every texture, pipeline and pass of one device shares on its context, made on the first
 *  texture, pipeline or pass. */
class GlState {
  readonly fbo: WebGLFramebuffer;
  readonly blitFbo: WebGLFramebuffer;
  /** Where a texture paired with no sampler is read from: nearest, clamped. */
  readonly nearest: WebGLSampler;
  /** The context's `MAX_COLOR_ATTACHMENTS`, read once: a pass detaches the attachments below it
   *  that it does not use. An attachment at or above it is `INVALID_ENUM`, an error that stays on
   *  the context until the next `getError()`, which may be another layer's. */
  readonly maxColorAttachments: number;
  /** `EXT_polygon_offset_clamp`, requested once, or null when the context lacks it (A1). */
  readonly polygonOffsetClamp: PolygonOffsetClamp | null;
  /** The extensions the context gave when they were asked for. */
  readonly extensions = new Set<string>();
  #screen: { tex: WebGLTexture; w: number; h: number } | undefined;

  constructor(readonly gl: GL) {
    // A float target (`rgba16float`, `r32float`) and a filtered `f32` texture each need the
    // extension that allows them; one the context lacks leaves such a texture incomplete, and
    // its draw is refused by WebGL2 where WebGPU would refuse its format.
    for (const ext of [
      'EXT_color_buffer_float',
      'EXT_color_buffer_half_float',
      'OES_texture_float_linear',
    ])
      if (gl.getExtension(ext) !== null) this.extensions.add(ext);
    this.fbo = gl.createFramebuffer()!;
    this.blitFbo = gl.createFramebuffer()!;
    this.nearest = gl.createSampler()!;
    this.maxColorAttachments = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) as number;
    this.polygonOffsetClamp = gl.getExtension(
      'EXT_polygon_offset_clamp',
    ) as PolygonOffsetClamp | null;
    if (this.polygonOffsetClamp !== null) this.extensions.add('EXT_polygon_offset_clamp');
    gl.samplerParameteri(this.nearest, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.nearest, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(this.nearest, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.nearest, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
}

// ─── handles ─────────────────────────────────────────────────────────────────────────────────

/** A buffer: its bytes on the host, and the GL objects made from them. A host's own
 *  `WebGLBuffer` has no bytes here; it is bound as it is. */
class GlBuffer implements RhiBuffer {
  readonly __rhi = 'buffer' as const;
  /** Whether the GL buffer and the data texture still hold older bytes than `bytes`. */
  staleBuffer = true;
  staleTexture = true;
  /** The block size the uniform buffer was last padded to. */
  padded = -1;
  /** The data texture a program reads a storage buffer from. */
  texture: WebGLTexture | undefined;

  constructor(
    readonly size: number,
    readonly usage: ReadonlySet<RhiBufferUsage>,
    readonly elem: 'f32' | 'i32' | 'u32',
    readonly bytes: Uint8Array | undefined,
    readonly native: WebGLBuffer | undefined,
    /** Whether the device made `native`, and deletes it with the buffer. */
    readonly owned: boolean,
  ) {}
}

/** A texture: one the device made, a host's own (no format known), or the canvas's (`screen`),
 *  which the pass that attaches it draws into and turns over onto the screen. */
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

/** One binding a linked program reads, and where: a uniform block's binding point, or the texture
 *  unit of a texture or a data texture. */
interface Slot {
  readonly binding: number;
  readonly kind: 'block' | 'texture' | 'data';
  readonly unit: number;
  /** The linked block's size, which its buffer is padded to. */
  readonly minimum?: number;
  /** The binding of the sampler a texture is read with. */
  readonly sampler?: number;
}

/** The GL stencil test of one face: its function and its three operations. */
interface DrawFace {
  readonly func: number;
  readonly fail: number;
  readonly zfail: number;
  readonly zpass: number;
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
  readonly stencil?: {
    readonly front: DrawFace;
    readonly back: DrawFace;
    readonly readMask: number;
    readonly writeMask: number;
  };
  /** The polygon offset: `polygonOffset(factor, units)`, or `polygonOffsetClampEXT` with a non-zero
   *  clamp. Absent when the constant and the slope are 0. */
  readonly offset?: { readonly factor: number; readonly units: number; readonly clamp: number };
}

class GlPipeline implements RhiRenderPipeline {
  readonly __rhi = 'pipeline' as const;
  constructor(
    readonly program: WebGLProgram,
    /** The slots of each bind group, by group index. */
    readonly slots: readonly (readonly Slot[])[],
    readonly state: DrawState,
    readonly vao: WebGLVertexArrayObject,
    readonly buffers: readonly RhiVertexBufferLayout[],
  ) {}
}

/** The bindings of each group a WebGL2 pipeline's program reads, in the order of their units. A
 *  uniform block the driver found inactive is not among them: no draw binds it (0127). */
export function glReadBindings(pipeline: RhiRenderPipeline): readonly (readonly number[])[] {
  return (pipeline as GlPipeline).slots.map((group) => group.map((s) => s.binding));
}

// ─── pipelines ───────────────────────────────────────────────────────────────────────────────

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

/** The GL mode of each WebGPU topology this backend draws. */
export const GL_TOPOLOGY: Readonly<
  Record<string, 'TRIANGLES' | 'TRIANGLE_STRIP' | 'LINES' | 'LINE_STRIP' | 'POINTS'>
> = {
  'triangle-list': 'TRIANGLES',
  'triangle-strip': 'TRIANGLE_STRIP',
  'line-list': 'LINES',
  'line-strip': 'LINE_STRIP',
  'point-list': 'POINTS',
};

/** The GL factor of each WebGPU blend factor this backend takes. */
export const GL_BLEND_FACTOR: Readonly<Record<string, string>> = {
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

/** The GL equation of each WebGPU blend operation. */
export const GL_BLEND_OPERATION: Readonly<Record<string, string>> = {
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

function compareOf(gl: GL, c: RhiCompareFunction): number {
  const table: Record<RhiCompareFunction, number> = {
    never: gl.NEVER,
    less: gl.LESS,
    equal: gl.EQUAL,
    'less-equal': gl.LEQUAL,
    greater: gl.GREATER,
    'not-equal': gl.NOTEQUAL,
    'greater-equal': gl.GEQUAL,
    always: gl.ALWAYS,
  };
  return table[c];
}

/** The GL operation of a stencil operation. `increment-clamp` is INCR and `decrement-clamp` is
 *  DECR; the wrap forms are their own. */
function stencilOpOf(gl: GL, op: RhiStencilOperation): number {
  const table: Record<RhiStencilOperation, number> = {
    keep: gl.KEEP,
    zero: gl.ZERO,
    replace: gl.REPLACE,
    invert: gl.INVERT,
    'increment-clamp': gl.INCR,
    'decrement-clamp': gl.DECR,
    'increment-wrap': gl.INCR_WRAP,
    'decrement-wrap': gl.DECR_WRAP,
  };
  return table[op];
}

/** What a pipeline of `desc` sets before each draw. The runtime refuses a topology, a blend factor
 *  or a blend operation this backend has no name for before it asks for the pipeline. */
function drawStateOf(gl: GL, desc: RhiRenderPipelineDesc): DrawState {
  const g = gl as unknown as Record<string, number>;
  // WebGL2 has one blend state and one write mask for every target: the first target's.
  const first = desc.fragment?.targets[0];
  const blend = first?.blend as { color?: BlendComponent; alpha?: BlendComponent } | undefined;
  const factor = (f: string | undefined, d: string): number => g[GL_BLEND_FACTOR[f ?? d]!]!;
  const op = (o: string | undefined): number => g[GL_BLEND_OPERATION[o ?? 'add']!]!;
  const mask = first?.writeMask ?? 15;
  const cull = desc.primitive.cullMode;
  const face = (f: {
    compare: RhiCompareFunction;
    failOp: RhiStencilOperation;
    depthFailOp: RhiStencilOperation;
    passOp: RhiStencilOperation;
  }): DrawFace => ({
    func: compareOf(gl, f.compare),
    fail: stencilOpOf(gl, f.failOp),
    zfail: stencilOpOf(gl, f.depthFailOp),
    zpass: stencilOpOf(gl, f.passOp),
  });
  const ds = desc.depthStencil;
  const stencil = ds?.stencil;
  const bias = ds?.bias;
  return {
    mode: g[GL_TOPOLOGY[desc.primitive.topology]!]!,
    ...(ds !== undefined ? { depth: { func: compareOf(gl, ds.compare), write: ds.write } } : {}),
    ...(stencil !== undefined
      ? {
          stencil: {
            front: face(stencil.front),
            back: face(stencil.back),
            readMask: stencil.readMask,
            writeMask: stencil.writeMask,
          },
        }
      : {}),
    // WebGPU's depthBiasSlopeScale is GL's factor, and depthBias is units.
    ...(bias !== undefined && (bias.constant !== 0 || bias.slopeScale !== 0)
      ? { offset: { factor: bias.slopeScale, units: bias.constant, clamp: bias.clamp } }
      : {}),
    ...(cull === 'none' ? {} : { cull: cull === 'front' ? gl.FRONT : gl.BACK }),
    // The flip in y turns the winding round.
    frontFace: desc.primitive.frontFace === 'ccw' ? gl.CW : gl.CCW,
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

function setState(
  gl: GL,
  s: DrawState,
  reference: number,
  clampExtension: PolygonOffsetClamp | null,
): void {
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
  if (s.stencil === undefined) gl.disable(gl.STENCIL_TEST);
  else {
    const t = s.stencil;
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFuncSeparate(gl.FRONT, t.front.func, reference, t.readMask);
    gl.stencilFuncSeparate(gl.BACK, t.back.func, reference, t.readMask);
    gl.stencilOpSeparate(gl.FRONT, t.front.fail, t.front.zfail, t.front.zpass);
    gl.stencilOpSeparate(gl.BACK, t.back.fail, t.back.zfail, t.back.zpass);
    gl.stencilMaskSeparate(gl.FRONT, t.writeMask);
    gl.stencilMaskSeparate(gl.BACK, t.writeMask);
  }
  if (s.offset === undefined) gl.disable(gl.POLYGON_OFFSET_FILL);
  else {
    gl.enable(gl.POLYGON_OFFSET_FILL);
    if (s.offset.clamp === 0) gl.polygonOffset(s.offset.factor, s.offset.units);
    else clampExtension!.polygonOffsetClampEXT(s.offset.factor, s.offset.units, s.offset.clamp);
  }
}

// ─── data textures ───────────────────────────────────────────────────────────────────────────

/** The widest row a data texture takes. A program reads word `i` at `(i % 2048, i / 2048)`. */
export const DATA_WIDTH = 2048;

/** A storage buffer's bytes as the data texture GLSL ES 3.00 reads it from: its words, one a
 *  texel of the buffer's element type, in rows of {@link DATA_WIDTH}. */
function dataTexture(gl: GL, elem: 'f32' | 'i32' | 'u32', bytes: Uint8Array): WebGLTexture {
  const words = Math.max(1, Math.ceil(bytes.byteLength / 4));
  const w = Math.min(words, DATA_WIDTH);
  const h = Math.ceil(words / w);
  const data = new Uint8Array(w * h * 4);
  data.set(bytes);
  const [internal, fmt, type, view] =
    elem === 'u32'
      ? [gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, new Uint32Array(data.buffer)]
      : elem === 'i32'
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

// ─── reading texels back ─────────────────────────────────────────────────────────────────────

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

/** Read `tex` back as the bytes of `format`, `bytes` to a texel, as WebGPU's copy gives them. */
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
    // WebGL2 reads no depth back: a pass copies it into an r32float texture first.
    scratch = depthToColour(s, tex, w, h);
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

/** The typed array of `data`'s bytes that `texSubImage2D` takes for the GL type `type`. */
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

// ─── passes ──────────────────────────────────────────────────────────────────────────────────

const pad = (v: readonly number[]): number[] => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0];

/** One colour attachment of a pass: a texture, or the canvas's. */
interface Attachment {
  readonly tex: WebGLTexture | 'screen';
  readonly kind: GlTextureKind;
  readonly a: RhiColorAttachment;
}

/** Copy the canvas's texture onto the screen (`out`), or the screen into it (`in`), turned over
 *  in y: the texture's row 0 is the top, and the screen's is the bottom. */
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
    // Only the canvas's attachment takes the copy.
    const only = Array.from({ length: attachment + 1 }, (_, k) =>
      k === attachment ? gl.COLOR_ATTACHMENT0 + attachment : gl.NONE,
    );
    gl.drawBuffers(only);
  }
  gl.blitFramebuffer(0, 0, w, h, 0, h, w, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
}

/** A render pass on WebGL2, run as it is recorded (proposal 0064, PR-1, the pass procedure). It
 *  begins when it is made: the attachments, the host state it gives back at its end, the pass
 *  state of its start and the clears. Each call then runs in order, and `end()` is the tail: the
 *  masks made full, the discards cleared, the canvas turned over onto the screen, the host state
 *  given back. */
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
    // The scissor is off for the blit and the clears: a scissor still on would clip them (E4).
    gl.disable(gl.SCISSOR_TEST);
    // A pass that loads the canvas starts from what the screen shows, turned over.
    this.#colour.forEach((c, i) => {
      if (c.tex === 'screen' && c.a.loadOp === 'load') blitScreen(s, i, 'in');
    });
    // The host's viewport, depth range and blend constant, which the pass gives back at its end.
    this.#host = {
      viewport: Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array),
      range: Array.from(gl.getParameter(gl.DEPTH_RANGE) as Float32Array),
      blend: Array.from(gl.getParameter(gl.BLEND_COLOR) as Float32Array),
    };
    // The pass state of its start: the whole target, the depth range 0 to 1, a blend constant of 0.
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
    // The depth, then the stencil apart from it. A read-only aspect has no load, so it is never
    // cleared.
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
    if (index === undefined) gl.drawArraysInstanced(p.state.mode, 0, count, instances);
    else gl.drawElementsInstanced(p.state.mode, count, index.type, 0, instances);
    gl.bindVertexArray(null);
  }

  /** Bind what `group` holds to the units of `slots`. */
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

  /** No call: each stencil draw passes the reference to its own `stencilFuncSeparate`. */
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
    // A discarded attachment is cleared to 0 at the end, by the clear of its kind: colour by index,
    // then depth, then stencil. No invalidation call is made.
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
    const host = this.#host;
    gl.viewport(host.viewport[0]!, host.viewport[1]!, host.viewport[2]!, host.viewport[3]!);
    gl.depthRange(host.range[0]!, host.range[1]!);
    gl.blendColor(host.blend[0]!, host.blend[1]!, host.blend[2]!, host.blend[3]!);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

/** Why the backend makes no compute pass or pipeline. */
const NO_COMPUTE =
  'The WebGL2 backend has no compute pass: a dispatch on WebGL2 runs as the pass program of change 0054 (caps.compute is fragment-emulated).';

/** The encoder: WebGL2 has no command buffer, so each command runs as it is recorded. */
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

// ─── the device ──────────────────────────────────────────────────────────────────────────────

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
  readonly #views = new WeakMap<GlTexture, GlView>();
  /** The handle of each native object: the ones the device made, and a host's it was given. */
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

  /** The state of the context, made on first use. */
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

  /** Bring a vertex or index buffer's GL object up to its bytes, through `target`. */
  upload(b: GlBuffer, target: number): void {
    if (b.bytes === undefined || !b.staleBuffer) return;
    const gl = this.native;
    gl.bindBuffer(target, b.native!);
    gl.bufferData(target, b.bytes, gl.STATIC_DRAW);
    gl.bindBuffer(target, null);
    b.staleBuffer = false;
  }

  /** The data texture of a storage buffer, made again when its bytes have changed. */
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
      // A host's own buffer: written where it is.
      const gl = this.native;
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, b.native!);
      gl.bufferSubData(gl.COPY_WRITE_BUFFER, byteOffset, bytes);
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
      return;
    }
    b.bytes.set(bytes, byteOffset);
    b.staleBuffer = b.staleTexture = true;
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
  }

  createTexture(desc: RhiTextureDesc): RhiTexture {
    const gl = this.native;
    this.state();
    if ((desc.dimension ?? '2d') !== '2d' || desc.size[2] !== 1)
      throw new TypeError('The WebGL2 backend makes 2D textures of one layer.');
    if ((desc.sampleCount ?? 1) !== 1)
      throw new TypeError('The WebGL2 backend makes no multisampled texture.');
    const fmt = formatOf(gl, desc.format);
    if (fmt === undefined) throw new TypeError(`WebGL2 has no ${desc.format} texture.`);
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
      // WebGL2 has no BGRA texture: the texels go up as RGBA.
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

  /** The canvas's texture, the drawing buffer's size now. The pass that attaches it draws into a
   *  texture of its own and turns it over onto the screen at its end. */
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
    // A texture of this backend has one level, so the minification takes no mipmap filter.
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

  /** Link the pipeline's program, give each binding its unit, and make its vertex array. */
  #pipeline(desc: RhiRenderPipelineDesc): GlPipeline {
    const gl = this.native;
    this.state();
    const vertex = toGlClip((desc.module as GlModule).code);
    const fragment =
      desc.fragment === undefined
        ? NO_COLOUR
        : ((desc.fragment.module ?? desc.module) as GlModule).code;
    const program = compile(gl, vertex, fragment, desc.label ?? 'a render pipeline');
    const slots = this.#slots(program, desc.layouts as readonly GlLayout[]);
    const state = drawStateOf(gl, desc);
    return new GlPipeline(program, slots, state, gl.createVertexArray()!, desc.vertex.buffers);
  }

  /** Each binding the program reads, at its block binding point or texture unit, set on `program`
   *  once: the units are the same for every draw of the pipeline. The blocks take the binding
   *  points in the order of the layout's entries, and the textures and the data textures the units,
   *  after them, in the same order. */
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
          // Inactive after driver optimization: no size query and no binding point needed.
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

  /** The commands ran as they were recorded: nothing is left to hand over. */
  submit(_encoders: readonly RhiCommandEncoder[]): Promise<void> {
    return Promise.resolve();
  }

  /** WebGL2 has no error scopes: the first error of what follows is the context's own, which
   *  `popValidationScope` takes. */
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
        // WebGL2 has no native encoder or pass.
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

  /** Lose the context: the runtime calls it only for a context it made itself. */
  destroy(): void {
    (
      this.native.getExtension('WEBGL_lose_context') as { loseContext(): void } | null
    )?.loseContext();
  }
}

/** The RHI device over a `WebGL2RenderingContext`. Its handles and its context state are its own,
 *  so a runtime makes one device for its context and keeps it. */
export function webgl2Device(gl: WebGL2RenderingContext): RhiDevice {
  return new GlDevice(gl);
}
