// The CPU backend of the render hardware interface (change 0120, D1 and milestone M3): a software
// `RhiDevice`. Buffers and textures are bytes in host memory. A program is a module's CPU tier
// code (Rule 11.7), a `CpuProgram` (`cpu-program.ts`), in place of the shader text the GPU
// backends take.
//
// - A compute dispatch runs the entry's code for each invocation of each workgroup, `z`, then
//   `y`, then `x`, the local invocations in the same order inside each workgroup, with the
//   workgroup variables zeroed for each workgroup, as the call layer's CPU tier does
//   (`core/host-entry.ts`, `onCpu`). The bytes of each buffer bound to it are turned into the
//   value the code reads by the binding's name, by its layout, and the value of each storage
//   buffer it may write is turned back into the bytes after the dispatch.
// - A render pass runs the vertex entry's code for each vertex of a `triangle-list` draw, indexed
//   or not, instanced or not, rasterizes each triangle (`cpu-raster.ts`), and runs the fragment
//   entry's code for each covered pixel, a `discard` writing nothing. A colour converts to its
//   target's format as WebGPU converts it: an 8-bit unorm channel is the colour clamped to 0..1,
//   times 255, rounded.
// - A canvas is a host's `2d` context; a pass into its texture is shown with `putImageData` when
//   the submit that drew it ends.
//
// The encoder records each command and the submit runs them, in order, before it returns
// (`caps.immediate` is false, as on WebGPU). What the backend cannot do it refuses with a
// `TypeError` that says so, where the object is made: a depth or stencil test, blending,
// multisampling, a topology other than `triangle-list`, and an entry that reaches a texture, a
// sampler, a derivative or a barrier (change 0120, item 4 and O6 (a)).

import type { PackLayout } from '../core/manifest-types.js';
import {
  isCpuProgram,
  type CpuBinding,
  type CpuCode,
  type CpuEntry,
  type CpuIo,
  type CpuIoField,
  type CpuProgram,
} from './cpu-program.js';
import {
  rasterizeTriangle,
  type RasterState,
  type RasterVertex,
  type Varying,
} from './cpu-raster.js';
import type {
  RhiBindEntry,
  RhiBindGroup,
  RhiBindGroupLayout,
  RhiBindLayoutEntry,
  RhiBuffer,
  RhiBufferDesc,
  RhiCanvas,
  RhiCaps,
  RhiColorAttachment,
  RhiCommandEncoder,
  RhiComputePass,
  RhiComputePipeline,
  RhiComputePipelineDesc,
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
} from './rhi.js';

// ─── the handles ─────────────────────────────────────────────────────────────────────────────

class CpuBuffer implements RhiBuffer {
  readonly __rhi = 'buffer';
  readonly bytes: Uint8Array;
  destroyed = false;
  constructor(
    readonly size: number,
    readonly usage: readonly string[],
  ) {
    this.bytes = new Uint8Array(size);
  }
}

/** How a texture format's texels are stored and written. */
interface Format {
  /** Bytes a texel. */
  readonly bytes: number;
  /** The channels a colour writes, in the order the bytes store them, and how each is stored. */
  readonly channels: readonly number[];
  readonly store: 'unorm8' | 'f32' | 'u32' | 'i32' | 'u8' | 'depth' | 'opaque';
}

const FORMATS: Readonly<Record<string, Format>> = {
  rgba8unorm: { bytes: 4, channels: [0, 1, 2, 3], store: 'unorm8' },
  bgra8unorm: { bytes: 4, channels: [2, 1, 0, 3], store: 'unorm8' },
  rg8unorm: { bytes: 2, channels: [0, 1], store: 'unorm8' },
  r8unorm: { bytes: 1, channels: [0], store: 'unorm8' },
  rgba8uint: { bytes: 4, channels: [0, 1, 2, 3], store: 'u8' },
  r32float: { bytes: 4, channels: [0], store: 'f32' },
  rg32float: { bytes: 8, channels: [0, 1], store: 'f32' },
  rgba32float: { bytes: 16, channels: [0, 1, 2, 3], store: 'f32' },
  r32uint: { bytes: 4, channels: [0], store: 'u32' },
  rgba32uint: { bytes: 16, channels: [0, 1, 2, 3], store: 'u32' },
  r32sint: { bytes: 4, channels: [0], store: 'i32' },
  rgba32sint: { bytes: 16, channels: [0, 1, 2, 3], store: 'i32' },
  // Stored, read and written as bytes, never drawn into or cleared as colour.
  rgba16float: { bytes: 8, channels: [], store: 'opaque' },
  // A depth texel is its depth as an `f32`; the stencil aspect is not kept, since no pipeline
  // of this backend tests it.
  depth16unorm: { bytes: 4, channels: [], store: 'depth' },
  depth24plus: { bytes: 4, channels: [], store: 'depth' },
  depth32float: { bytes: 4, channels: [], store: 'depth' },
  'depth24plus-stencil8': { bytes: 4, channels: [], store: 'depth' },
  'depth32float-stencil8': { bytes: 4, channels: [], store: 'depth' },
};

class CpuTexture implements RhiTexture {
  readonly __rhi = 'texture';
  readonly bytes: Uint8Array;
  readonly kind: Format;
  destroyed = false;
  constructor(
    readonly width: number,
    readonly height: number,
    readonly layers: number,
    readonly format: string,
    /** The canvas whose texture this is, shown when a submit that drew it ends. */
    readonly canvas?: CpuCanvas,
  ) {
    const kind = FORMATS[format];
    if (kind === undefined)
      throw new TypeError(`The CPU backend has no texture format "${format}".`);
    this.kind = kind;
    this.bytes = new Uint8Array(width * height * layers * kind.bytes);
  }
}

class CpuView implements RhiTextureView {
  readonly __rhi = 'view';
  constructor(readonly texture: CpuTexture) {}
}

class CpuSampler implements RhiSampler {
  readonly __rhi = 'sampler';
  constructor(readonly desc: RhiSamplerDesc) {}
}

class CpuModule implements RhiShaderModule {
  readonly __rhi = 'module';
  constructor(readonly program: CpuProgram) {}
}

class CpuBindLayout implements RhiBindGroupLayout {
  readonly __rhi = 'bindlayout';
  constructor(readonly entries: readonly RhiBindLayoutEntry[]) {}
}

class CpuBindGroup implements RhiBindGroup {
  readonly __rhi = 'bindgroup';
  constructor(
    readonly layout: CpuBindLayout,
    readonly entries: readonly RhiBindEntry[],
  ) {}
}

/** An entry made ready to run: its program, its code (specialized by the pipeline's constants)
 *  and its interface. */
interface Stage {
  readonly program: CpuProgram;
  readonly code: CpuCode;
  readonly entry: CpuEntry;
  readonly name: string;
}

class CpuComputePipeline implements RhiComputePipeline {
  readonly __rhi = 'computepipeline';
  constructor(
    readonly stage: Stage,
    readonly layouts: readonly RhiBindGroupLayout[],
  ) {}
}

class CpuRenderPipeline implements RhiRenderPipeline {
  readonly __rhi = 'pipeline';
  constructor(
    readonly vertex: Stage,
    readonly fragment: Stage | undefined,
    readonly desc: RhiRenderPipelineDesc,
  ) {}
}

/** The part of a `CanvasRenderingContext2D` the backend draws with. */
interface Context2d {
  readonly canvas: { readonly width: number; readonly height: number };
  createImageData(width: number, height: number): { readonly data: Uint8ClampedArray };
  putImageData(image: object, x: number, y: number): void;
}

const isContext2d = (v: object): v is Context2d => {
  const c = v as Partial<Context2d>;
  return (
    typeof c.putImageData === 'function' &&
    typeof c.createImageData === 'function' &&
    typeof c.canvas === 'object'
  );
};

class CpuCanvas implements RhiCanvas {
  readonly __rhi = 'canvas';
  texture: CpuTexture | undefined;
  constructor(readonly context: Context2d) {}
}

// ─── bytes and the CPU tier's values ─────────────────────────────────────────────────────────

/** A number of `type` at `at`: an `f64` is two `f32`s, `hi` then `lo`. */
function readNumber(dv: DataView, at: number, type: string, lo = 4): number {
  switch (type) {
    case 'f32':
      return dv.getFloat32(at, true);
    case 'i32':
      return dv.getInt32(at, true);
    case 'u32':
      return dv.getUint32(at, true);
    default:
      return dv.getFloat32(at, true) + dv.getFloat32(at + lo, true);
  }
}

function writeNumber(dv: DataView, at: number, type: string, x: number, lo = 4): void {
  switch (type) {
    case 'f32':
      dv.setFloat32(at, x, true);
      return;
    case 'i32':
      dv.setInt32(at, x | 0, true);
      return;
    case 'u32':
      dv.setUint32(at, x >>> 0, true);
      return;
    default: {
      const hi = Math.fround(x);
      dv.setFloat32(at, hi, true);
      dv.setFloat32(at + lo, Math.fround(x - hi), true);
    }
  }
}

/** The CPU tier's value of the bytes at `at` by `layout`, as the call layer's `toCpu` makes it
 *  from a host value: a scalar a number, a vector or a matrix (column by column) an array of
 *  numbers, an array an array, a struct an object by field name. An array with no size runs to
 *  `end`. */
export function decode(dv: DataView, at: number, layout: PackLayout, end: number): unknown {
  switch (layout.kind) {
    case 'scalar':
      return readNumber(dv, at, layout.type);
    case 'vector': {
      const out: number[] = [];
      for (let i = 0; i < layout.size; i++)
        out.push(readNumber(dv, at + 4 * i, layout.type, layout.lo ?? 4 * layout.size));
      return out;
    }
    case 'matrix': {
      const out: number[] = [];
      for (let c = 0; c < layout.columns; c++)
        for (let r = 0; r < layout.rows; r++)
          out.push(dv.getFloat32(at + c * layout.columnStride + 4 * r, true));
      return out;
    }
    case 'array': {
      const n = layout.length ?? Math.max(0, Math.floor((end - at) / layout.stride));
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(decode(dv, at + i * layout.stride, layout.element, end));
      return out;
    }
    case 'struct': {
      const out: Record<string, unknown> = {};
      for (const f of layout.fields) out[f.name] = decode(dv, at + f.offset, f.layout, end);
      return out;
    }
  }
}

/** Write the CPU tier's value `v` back into the bytes at `at` by `layout`: {@link decode}'s
 *  inverse. An array writes the elements `v` holds that fit before `end`. */
export function encode(
  dv: DataView,
  at: number,
  layout: PackLayout,
  v: unknown,
  end: number,
): void {
  switch (layout.kind) {
    case 'scalar':
      writeNumber(dv, at, layout.type, v as number);
      return;
    case 'vector': {
      const xs = v as readonly number[];
      for (let i = 0; i < layout.size; i++)
        writeNumber(dv, at + 4 * i, layout.type, xs[i]!, layout.lo ?? 4 * layout.size);
      return;
    }
    case 'matrix': {
      const xs = v as readonly number[];
      for (let c = 0; c < layout.columns; c++)
        for (let r = 0; r < layout.rows; r++)
          dv.setFloat32(at + c * layout.columnStride + 4 * r, xs[c * layout.rows + r]!, true);
      return;
    }
    case 'array': {
      const xs = v as readonly unknown[];
      for (let i = 0; i < xs.length; i++) {
        const where = at + i * layout.stride;
        if (layout.length === null && where + layout.stride > end) break;
        encode(dv, where, layout.element, xs[i], end);
      }
      return;
    }
    case 'struct': {
      const o = v as Readonly<Record<string, unknown>>;
      for (const f of layout.fields) encode(dv, at + f.offset, f.layout, o[f.name], end);
      return;
    }
  }
}

// ─── the bound resources ─────────────────────────────────────────────────────────────────────

/** Each bound buffer by `group:binding`, with the layout entry that bound it. */
type Bound = Map<
  string,
  { readonly buffer: CpuBuffer; readonly size: number; readonly writable: boolean }
>;

function boundOf(groups: ReadonlyMap<number, CpuBindGroup>): Bound {
  const out: Bound = new Map();
  for (const [index, group] of groups)
    for (const e of group.entries) {
      const r = e.resource;
      if (!('buffer' in r)) continue;
      const le = group.layout.entries.find((l) => l.binding === e.binding);
      const writable = le !== undefined && 'buffer' in le && le.buffer.type === 'storage';
      const buffer = r.buffer as CpuBuffer;
      out.set(`${index}:${e.binding}`, {
        buffer,
        size: Math.min(r.size ?? buffer.size, buffer.size),
        writable,
      });
    }
  return out;
}

/** The CPU tier's value a buffer holds in place of its bytes, by buffer: what the call layer binds
 *  for an entry call (change 0120, M4). The call layer's CPU tier hands the code the value
 *  `toCpu` makes of the host's value, a double where the host gave one, and takes back what the
 *  code left, with no bytes between (Rule 11.7): bytes would hold an `f64` as two `f32`s and a
 *  plain array's numbers as `f32`s, which the CPU tier never rounds them to. */
const hostValues = new WeakMap<object, { value: unknown }>();

/**
 * Bind `slot` as what `buffer` holds, or bind its bytes again when `slot` is undefined. A dispatch
 * hands the code `slot.value` in place of the bytes, and a storage buffer it may write takes the
 * value the code left back into `slot.value`, with the bytes left as they were.
 */
export function holdValue(buffer: RhiBuffer, slot: { value: unknown } | undefined): void {
  if (slot === undefined) hostValues.delete(buffer);
  else hostValues.set(buffer, slot);
}

/** Hand the bound buffers to the stages' code, each by its binding's name; returns the storage
 *  buffers to write back after the stages ran. */
function bindTo(
  stages: readonly Stage[],
  bound: Bound,
): { binding: CpuBinding; code: CpuCode; buffer: CpuBuffer; size: number }[] {
  const back: { binding: CpuBinding; code: CpuCode; buffer: CpuBuffer; size: number }[] = [];
  const seen = new Set<CpuCode>();
  for (const s of stages) {
    if (seen.has(s.code)) continue;
    seen.add(s.code);
    for (const b of s.program.bindings) {
      const at = bound.get(`${b.group}:${b.binding}`);
      if (at === undefined || b.layout === undefined) continue;
      const held = hostValues.get(at.buffer);
      s.code.$.bindings[b.name] =
        held !== undefined
          ? held.value
          : decode(new DataView(at.buffer.bytes.buffer, 0, at.size), 0, b.layout, at.size);
      if (at.writable && b.kind === 'storage')
        back.push({ binding: b, code: s.code, buffer: at.buffer, size: at.size });
    }
  }
  return back;
}

function writeBack(
  back: readonly { binding: CpuBinding; code: CpuCode; buffer: CpuBuffer; size: number }[],
): void {
  for (const { binding, code, buffer, size } of back) {
    const held = hostValues.get(buffer);
    if (held !== undefined) {
      held.value = code.$.bindings[binding.name];
      continue;
    }
    encode(
      new DataView(buffer.bytes.buffer, 0, size),
      0,
      binding.layout!,
      code.$.bindings[binding.name],
      size,
    );
  }
}

// ─── entries ─────────────────────────────────────────────────────────────────────────────────

/** The argument of one parameter: a field's value from `value`, or a struct of them. */
function argOf(io: CpuIo, value: (f: CpuIoField) => unknown): unknown {
  if (io.kind === 'field') return value(io.field);
  const out: Record<string, unknown> = {};
  for (const f of io.fields) out[f.name] = value(f);
  return out;
}

/** Each field of a result, with its value. */
function fieldsOf(io: CpuIo, result: unknown): [CpuIoField, unknown][] {
  if (io.kind === 'field') return [[io.field, result]];
  const o = result as Readonly<Record<string, unknown>>;
  return io.fields.map((f) => [f, o[f.name]]);
}

/** Call the entry once, its private variables started over. */
function invoke(stage: Stage, args: readonly unknown[], invocation?: readonly number[]): unknown {
  const F = stage.code.F as Readonly<Record<string, ((...a: unknown[]) => unknown) | undefined>>;
  F['$initPrivates']?.();
  stage.code.$.invocation = invocation;
  return F[stage.entry.fn]!(...args);
}

/** The program's entry `name`, made ready to run, or the reason it cannot be. */
function stageOf(
  module: RhiShaderModule,
  name: string,
  stage: CpuEntry['stage'],
  constants: Readonly<Record<string, number>> | undefined,
): Stage {
  const program = (module as CpuModule).program;
  const entry = program.entries[name];
  if (entry === undefined || entry.stage !== stage)
    throw new TypeError(`The CPU program has no ${stage} entry "${name}".`);
  if (entry.noCpu !== undefined)
    throw new TypeError(`The CPU backend cannot run "${name}": ${entry.noCpu}.`);
  if (program.code.F[entry.fn] === undefined)
    throw new TypeError(`The CPU program has no code for "${name}".`);
  let code = program.code;
  if (constants !== undefined && Object.keys(constants).length > 0) {
    if (code.specialize === undefined)
      throw new TypeError(
        `The CPU program of "${name}" declares no override, and the pipeline sets ${Object.keys(constants).join(', ')}.`,
      );
    code = code.specialize(constants);
  }
  return { program, code, entry, name };
}

/** A copy of a workgroup variable's zero value, for one workgroup. */
const fresh = (v: unknown): unknown =>
  v === undefined ? v : (JSON.parse(JSON.stringify(v)) as unknown);

/** Run every invocation of `x` × `y` × `z` workgroups of the pipeline's entry. */
function dispatch(
  pipeline: CpuComputePipeline,
  groups: ReadonlyMap<number, CpuBindGroup>,
  wg: readonly [number, number, number],
): void {
  const s = pipeline.stage;
  const back = bindTo([s], boundOf(groups));
  const [sx, sy, sz] = s.entry.workgroupSize ?? [1, 1, 1];
  try {
    for (let wz = 0; wz < wg[2]; wz++)
      for (let wy = 0; wy < wg[1]; wy++)
        for (let wx = 0; wx < wg[0]; wx++) {
          for (const [name, zero] of Object.entries(s.program.workgroupZero))
            s.code.$.vars[name] = fresh(zero);
          for (let lz = 0; lz < sz; lz++)
            for (let ly = 0; ly < sy; ly++)
              for (let lx = 0; lx < sx; lx++) {
                const gid = [wx * sx + lx, wy * sy + ly, wz * sz + lz];
                const builtin = (name: string | undefined): unknown => {
                  switch (name) {
                    case 'global_invocation_id':
                      return [...gid];
                    case 'local_invocation_id':
                      return [lx, ly, lz];
                    case 'local_invocation_index':
                      return lz * sy * sx + ly * sx + lx;
                    case 'workgroup_id':
                      return [wx, wy, wz];
                    case 'num_workgroups':
                      return [...wg];
                    default:
                      return 0;
                  }
                };
                invoke(
                  s,
                  s.entry.params.map((p) => argOf(p, (f) => builtin(f.builtin))),
                  gid,
                );
              }
        }
  } finally {
    s.code.$.invocation = undefined;
  }
  writeBack(back);
}

// ─── vertices ────────────────────────────────────────────────────────────────────────────────

/** How one vertex attribute's components are stored. */
interface AttributeFormat {
  readonly kind: 'float' | 'uint' | 'sint' | 'unorm' | 'snorm';
  readonly bits: 8 | 16 | 32;
  readonly n: number;
}

function attributeFormat(format: string): AttributeFormat {
  const m = /^(float|uint|sint|unorm|snorm)(8|16|32)(?:x([234]))?$/.exec(format);
  if (m === null || (m[1] === 'float' && m[2] === '8'))
    throw new TypeError(`The CPU backend has no vertex format "${format}".`);
  return {
    kind: m[1] as AttributeFormat['kind'],
    bits: Number(m[2]) as 8 | 16 | 32,
    n: m[3] === undefined ? 1 : Number(m[3]),
  };
}

/** An IEEE half-precision number. */
function half(h: number): number {
  const e = (h >> 10) & 0x1f;
  const m = h & 0x3ff;
  const s = h & 0x8000 ? -1 : 1;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m === 0 ? s * Infinity : NaN;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

function readComponent(dv: DataView, at: number, f: AttributeFormat): number {
  switch (f.bits) {
    case 32:
      return f.kind === 'float'
        ? dv.getFloat32(at, true)
        : f.kind === 'sint'
          ? dv.getInt32(at, true)
          : dv.getUint32(at, true);
    case 16: {
      if (f.kind === 'float') return half(dv.getUint16(at, true));
      const v =
        f.kind === 'sint' || f.kind === 'snorm' ? dv.getInt16(at, true) : dv.getUint16(at, true);
      return f.kind === 'unorm' ? v / 65535 : f.kind === 'snorm' ? Math.max(-1, v / 32767) : v;
    }
    case 8: {
      const v = f.kind === 'sint' || f.kind === 'snorm' ? dv.getInt8(at) : dv.getUint8(at);
      return f.kind === 'unorm' ? v / 255 : f.kind === 'snorm' ? Math.max(-1, v / 127) : v;
    }
  }
}

/** A vertex attribute of the pipeline: where it is read and how. */
interface Attribute {
  readonly slot: number;
  readonly stride: number;
  readonly offset: number;
  readonly format: AttributeFormat;
}

/** The value of attribute `a` at vertex `i`, as wide as the shader reads it: missing components
 *  are 0, and 1 for the fourth, as WebGPU fills them. */
function attributeValue(
  a: Attribute,
  buffers: readonly (CpuBuffer | undefined)[],
  i: number,
  width: number,
): unknown {
  const buffer = buffers[a.slot];
  if (buffer === undefined)
    throw new TypeError(`The draw reads vertex buffer slot ${a.slot}, which no buffer is set to.`);
  const dv = new DataView(buffer.bytes.buffer);
  const at = i * a.stride + a.offset;
  const size = (a.format.bits / 8) * a.format.n;
  if (at + size > buffer.size)
    throw new TypeError(
      `The draw reads vertex ${i} of slot ${a.slot} at byte ${at}, past the buffer's ${buffer.size} bytes.`,
    );
  const out: number[] = [];
  for (let c = 0; c < width; c++) {
    const v =
      c < a.format.n ? readComponent(dv, at + (c * a.format.bits) / 8, a.format) : c === 3 ? 1 : 0;
    out.push(
      a.format.kind === 'float' || a.format.kind === 'unorm' || a.format.kind === 'snorm'
        ? Math.fround(v)
        : v,
    );
  }
  return width === 1 ? out[0] : out;
}

// ─── the render pass ─────────────────────────────────────────────────────────────────────────

/** The 8-bit unorm byte of `v`, as WebGPU converts a colour to an `rgba8unorm` texel. */
const unorm8 = (v: number): number =>
  Number.isNaN(v) ? 0 : Math.round(Math.min(1, Math.max(0, v)) * 255);

/** Write colour `c` into texel `i` of `t`, the channels `mask` allows (WebGPU's `GPUColorWrite`
 *  bits: red 1, green 2, blue 4, alpha 8). */
function writeTexel(t: CpuTexture, i: number, c: readonly number[], mask = 0xf): void {
  const f = t.kind;
  const at = i * f.bytes;
  const dv = new DataView(t.bytes.buffer);
  f.channels.forEach((ch, k) => {
    if ((mask & (1 << ch)) === 0) return;
    const v = c[ch] ?? (ch === 3 ? 1 : 0);
    switch (f.store) {
      case 'unorm8':
        t.bytes[at + k] = unorm8(v);
        return;
      case 'u8':
        t.bytes[at + k] = v & 0xff;
        return;
      case 'f32':
        dv.setFloat32(at + 4 * k, v, true);
        return;
      case 'u32':
        dv.setUint32(at + 4 * k, v >>> 0, true);
        return;
      case 'i32':
        dv.setInt32(at + 4 * k, v | 0, true);
        return;
    }
  });
}

function clearTexture(t: CpuTexture, value: readonly number[]): void {
  if (t.kind.store === 'opaque')
    throw new TypeError(`The CPU backend cannot clear a "${t.format}" texture as a colour target.`);
  const texels = t.width * t.height;
  for (let i = 0; i < texels; i++) writeTexel(t, i, value);
}

function clearDepth(t: CpuTexture, depth: number): void {
  const f = new Float32Array(t.bytes.buffer, 0, t.width * t.height);
  f.fill(depth);
}

/** What a pass holds while its commands run. */
interface PassState {
  readonly targets: readonly (CpuTexture | undefined)[];
  readonly width: number;
  readonly height: number;
  pipeline: CpuRenderPipeline | undefined;
  readonly groups: Map<number, CpuBindGroup>;
  readonly vertexBuffers: (CpuBuffer | undefined)[];
  index: { buffer: CpuBuffer; format: 'uint16' | 'uint32' } | undefined;
  viewport: RasterState['viewport'];
  scissor: RasterState['scissor'];
}

/** The interstage values a vertex entry writes, in location order, and where each sits. */
function varyingsOf(
  pipeline: CpuRenderPipeline,
): { location: number; varying: Varying; integer: boolean }[] {
  const out = pipeline.vertex.entry.out;
  if (out === undefined) return [];
  const fields = out.kind === 'field' ? [out.field] : out.fields;
  const located = fields
    .filter((f) => f.location !== undefined)
    .sort((a, b) => a.location! - b.location!);
  let offset = 0;
  return located.map((f) => {
    const width = f.width ?? 4;
    const mode = (f.interpolate ?? 'perspective').split(/[\s,]+/)[0]!;
    const interpolation: Varying['interpolation'] =
      f.integer === true || mode === 'flat' ? 'flat' : mode === 'linear' ? 'linear' : 'perspective';
    const v = {
      location: f.location!,
      varying: { offset, width, interpolation },
      integer: f.integer === true,
    };
    offset += width;
    return v;
  });
}

function draw(
  state: PassState,
  first: (k: number) => number,
  count: number,
  instances: number,
): void {
  const pipeline = state.pipeline;
  if (pipeline === undefined)
    throw new TypeError('The draw has no pipeline: call setPipeline first.');
  const vs = pipeline.vertex;
  const fs = pipeline.fragment;
  const stages = fs === undefined ? [vs] : [vs, fs];
  const back = bindTo(stages, boundOf(state.groups));
  const attributes = new Map<number, Attribute>();
  pipeline.desc.vertex.buffers.forEach((b, slot) => {
    for (const a of b.attributes)
      attributes.set(a.shaderLocation, {
        slot,
        stride: b.arrayStride,
        offset: a.offset,
        format: attributeFormat(a.format),
      });
  });
  const varyings = varyingsOf(pipeline);
  const slots = varyings.map((v) => v.varying);
  const raster: RasterState = {
    width: state.width,
    height: state.height,
    viewport: state.viewport,
    scissor: state.scissor,
    cullMode: pipeline.desc.primitive.cullMode,
    frontFace: pipeline.desc.primitive.frontFace,
  };
  const targets = pipeline.desc.fragment?.targets ?? [];
  // A fragment input by location: where its numbers sit among a vertex's.
  const byLocation = new Map(varyings.map((v) => [v.location, v]));

  const runVertex = (index: number, instance: number): RasterVertex => {
    const args = vs.entry.params.map((p) =>
      argOf(p, (f) => {
        if (f.builtin === 'vertex_index') return index;
        if (f.builtin === 'instance_index') return instance;
        if (f.location !== undefined) {
          const a = attributes.get(f.location);
          if (a === undefined)
            throw new TypeError(
              `The vertex entry "${vs.name}" reads location ${f.location}, which the pipeline's vertex buffers do not hold.`,
            );
          return attributeValue(a, state.vertexBuffers, index, f.width ?? 4);
        }
        return 0;
      }),
    );
    const result = invoke(vs, args);
    let position: readonly number[] | undefined;
    const values: number[] = [];
    const out = vs.entry.out;
    if (out !== undefined)
      for (const [f, v] of fieldsOf(out, result)) {
        if (f.builtin === 'position') position = v as readonly number[];
        if (f.location === undefined) continue;
        const slot = byLocation.get(f.location)!.varying;
        const xs = typeof v === 'number' ? [v] : (v as readonly number[]);
        for (let i = 0; i < slot.width; i++) values[slot.offset + i] = xs[i] ?? 0;
      }
    if (position === undefined)
      throw new TypeError(`The vertex entry "${vs.name}" writes no position.`);
    return { position: position as RasterVertex['position'], values };
  };

  const shade = (
    x: number,
    y: number,
    position: number[],
    frontFacing: boolean,
    values: number[],
  ): void => {
    if (fs === undefined) return;
    const args = fs.entry.params.map((p) =>
      argOf(p, (f) => {
        switch (f.builtin) {
          case 'position':
            return position.map(Math.fround);
          case 'front_facing':
            return frontFacing;
          case 'sample_index':
            return 0;
          case 'sample_mask':
            return 1;
        }
        if (f.location === undefined) return 0;
        const v = byLocation.get(f.location);
        if (v === undefined)
          throw new TypeError(
            `The fragment entry "${fs.name}" reads location ${f.location}, which the vertex entry "${vs.name}" does not write.`,
          );
        const xs = values.slice(v.varying.offset, v.varying.offset + v.varying.width);
        const read = v.integer ? xs : xs.map(Math.fround);
        return v.varying.width === 1 ? read[0] : read;
      }),
    );
    const result = invoke(fs, args, [x, y, 0]);
    // A fragment that discards returns nothing and writes nothing.
    if (result === undefined || fs.entry.out === undefined) return;
    for (const [f, v] of fieldsOf(fs.entry.out, result)) {
      if (f.builtin !== undefined) continue;
      const k = f.location ?? 0;
      const t = state.targets[k];
      if (t === undefined) continue;
      writeTexel(
        t,
        y * t.width + x,
        typeof v === 'number' ? [v] : (v as number[]),
        targets[k]?.writeMask,
      );
    }
  };

  for (let inst = 0; inst < instances; inst++) {
    const cache = new Map<number, RasterVertex>();
    const vertex = (k: number): RasterVertex => {
      const index = first(k);
      let v = cache.get(index);
      if (v === undefined) cache.set(index, (v = runVertex(index, inst)));
      return v;
    };
    for (let k = 0; k + 2 < count; k += 3)
      rasterizeTriangle(vertex(k), vertex(k + 1), vertex(k + 2), slots, raster, (f) =>
        shade(f.x, f.y, f.position, f.frontFacing, f.values),
      );
  }
  vs.code.$.invocation = undefined;
  if (fs !== undefined) fs.code.$.invocation = undefined;
  writeBack(back);
}

// ─── the encoder ─────────────────────────────────────────────────────────────────────────────

type Command = () => void;

class CpuRenderPass implements RhiRenderPass {
  readonly #commands: Command[];
  readonly #state: () => PassState;
  constructor(commands: Command[], begin: () => PassState) {
    this.#commands = commands;
    let state: PassState | undefined;
    commands.push(() => {
      state = begin();
    });
    this.#state = () => state!;
  }
  #push(f: (s: PassState) => void): void {
    this.#commands.push(() => f(this.#state()));
  }
  setPipeline(pipeline: RhiRenderPipeline): void {
    this.#push((s) => (s.pipeline = pipeline as CpuRenderPipeline));
  }
  setBindGroup(index: number, group: RhiBindGroup): void {
    this.#push((s) => s.groups.set(index, group as CpuBindGroup));
  }
  setVertexBuffer(slot: number, buffer: RhiBuffer): void {
    this.#push((s) => (s.vertexBuffers[slot] = buffer as CpuBuffer));
  }
  setIndexBuffer(buffer: RhiBuffer, format: 'uint16' | 'uint32'): void {
    this.#push((s) => (s.index = { buffer: buffer as CpuBuffer, format }));
  }
  draw(vertexCount: number, instanceCount = 1): void {
    this.#push((s) => draw(s, (k) => k, vertexCount, instanceCount));
  }
  drawIndexed(indexCount: number, instanceCount = 1): void {
    this.#push((s) => {
      if (s.index === undefined)
        throw new TypeError('The indexed draw has no index buffer: call setIndexBuffer first.');
      const { buffer, format } = s.index;
      const size = format === 'uint16' ? 2 : 4;
      if (indexCount * size > buffer.size)
        throw new TypeError(
          `The indexed draw reads ${indexCount} indices, past the index buffer's ${buffer.size / size}.`,
        );
      const dv = new DataView(buffer.bytes.buffer);
      draw(
        s,
        (k) => (size === 2 ? dv.getUint16(2 * k, true) : dv.getUint32(4 * k, true)),
        indexCount,
        instanceCount,
      );
    });
  }
  setViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth: number,
    maxDepth: number,
  ): void {
    this.#push((s) => (s.viewport = { x, y, width, height, minDepth, maxDepth }));
  }
  setScissorRect(x: number, y: number, width: number, height: number): void {
    this.#push((s) => (s.scissor = { x, y, width, height }));
  }
  setBlendConstant(): void {
    // No pipeline of this backend blends (it refuses a `blend`), so the constant reaches nothing.
  }
  setStencilReference(): void {
    // No pipeline of this backend tests the stencil (it refuses one), so the reference reaches
    // nothing.
  }
  end(): void {}
}

class CpuComputePassImpl implements RhiComputePass {
  #pipeline: CpuComputePipeline | undefined;
  readonly #groups = new Map<number, CpuBindGroup>();
  constructor(readonly commands: Command[]) {}
  setPipeline(pipeline: RhiComputePipeline): void {
    this.commands.push(() => (this.#pipeline = pipeline as CpuComputePipeline));
  }
  setBindGroup(index: number, group: RhiBindGroup): void {
    this.commands.push(() => this.#groups.set(index, group as CpuBindGroup));
  }
  dispatchWorkgroups(x: number, y = 1, z = 1): void {
    this.commands.push(() => {
      if (this.#pipeline === undefined)
        throw new TypeError('The dispatch has no pipeline: call setPipeline first.');
      dispatch(this.#pipeline, new Map(this.#groups), [x, y, z]);
    });
  }
  dispatchWorkgroupsIndirect(buffer: RhiBuffer, byteOffset: number): void {
    this.commands.push(() => {
      if (this.#pipeline === undefined)
        throw new TypeError('The dispatch has no pipeline: call setPipeline first.');
      // The counts are read when the dispatch runs, so a command before it may write them.
      const b = buffer as CpuBuffer;
      if (byteOffset % 4 !== 0 || byteOffset + 12 > b.size)
        throw new TypeError(
          `dispatchWorkgroupsIndirect: three counts from byte ${byteOffset} do not fit a buffer of ${b.size}.`,
        );
      const dv = new DataView(b.bytes.buffer, b.bytes.byteOffset + byteOffset, 12);
      const wg = [dv.getUint32(0, true), dv.getUint32(4, true), dv.getUint32(8, true)] as const;
      if (wg.some((n) => n === 0)) return;
      dispatch(this.#pipeline, new Map(this.#groups), wg);
    });
  }
  end(): void {}
}

class CpuEncoder implements RhiCommandEncoder {
  readonly commands: Command[] = [];
  constructor(readonly drawn: Set<CpuCanvas>) {}
  beginRenderPass(desc: RhiRenderPassDesc): RhiRenderPass {
    return new CpuRenderPass(this.commands, () => {
      const targets = desc.colorAttachments.map(
        (a: RhiColorAttachment) => (a.view as CpuView).texture,
      );
      const ds = desc.depthStencilAttachment;
      const depth = ds === undefined ? undefined : (ds.view as CpuView).texture;
      const first = targets[0] ?? depth;
      if (first === undefined) throw new TypeError('The render pass has no attachment.');
      for (const [i, a] of desc.colorAttachments.entries()) {
        const t = targets[i]!;
        if (a.loadOp === 'clear') clearTexture(t, a.clearValue);
        if (t.canvas !== undefined) this.drawn.add(t.canvas);
      }
      if (depth !== undefined && ds!.depthReadOnly !== true && ds!.depthLoadOp === 'clear')
        clearDepth(depth, ds!.depthClearValue ?? 1);
      return {
        targets,
        width: first.width,
        height: first.height,
        pipeline: undefined,
        groups: new Map(),
        vertexBuffers: [],
        index: undefined,
        viewport: {
          x: 0,
          y: 0,
          width: first.width,
          height: first.height,
          minDepth: 0,
          maxDepth: 1,
        },
        scissor: { x: 0, y: 0, width: first.width, height: first.height },
      };
    });
  }
  beginComputePass(): RhiComputePass {
    return new CpuComputePassImpl(this.commands);
  }
  copyBufferToBuffer(
    src: RhiBuffer,
    srcOffset: number,
    dst: RhiBuffer,
    dstOffset: number,
    size: number,
  ): void {
    this.commands.push(() => {
      const s = src as CpuBuffer;
      const d = dst as CpuBuffer;
      if (srcOffset + size > s.size || dstOffset + size > d.size)
        throw new TypeError(
          `copyBufferToBuffer: ${size} bytes from ${srcOffset} of ${s.size} to ${dstOffset} of ${d.size} do not fit.`,
        );
      d.bytes.set(s.bytes.subarray(srcOffset, srcOffset + size), dstOffset);
    });
  }
}

// ─── the device ──────────────────────────────────────────────────────────────────────────────

/** The limits the CPU backend reports, by their names in WebGPU's `GPUSupportedLimits`: WebGPU's
 *  defaults, since a host that runs on the CPU tier wrote its program for those. */
const LIMITS: Readonly<Record<string, number>> = Object.freeze({
  maxTextureDimension1D: 8192,
  maxTextureDimension2D: 8192,
  maxTextureDimension3D: 2048,
  maxTextureArrayLayers: 256,
  maxBindGroups: 4,
  maxBindingsPerBindGroup: 1000,
  maxUniformBufferBindingSize: 65536,
  maxStorageBufferBindingSize: 134217728,
  maxBufferSize: 268435456,
  maxVertexBuffers: 8,
  maxVertexAttributes: 16,
  maxVertexBufferArrayStride: 2048,
  maxColorAttachments: 8,
  maxComputeWorkgroupStorageSize: 16384,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupsPerDimension: 65535,
});

/** What the CPU backend refuses of a render pipeline, as the end of a sentence, or nothing. */
function refusalOf(desc: RhiRenderPipelineDesc): string | undefined {
  if (desc.primitive.topology !== 'triangle-list')
    return `it draws a triangle-list, and the pipeline's topology is "${desc.primitive.topology}"`;
  if (desc.depthStencil !== undefined) return 'it draws with no depth or stencil test';
  if (desc.multisample.count !== 1) return 'it draws with no multisampling';
  for (const t of desc.fragment?.targets ?? []) {
    if (t.blend !== undefined) return 'it draws with no blending';
    const f = FORMATS[t.format];
    if (f === undefined || f.channels.length === 0)
      return `it draws into no "${t.format}" colour target`;
  }
  return undefined;
}

class CpuDevice implements RhiDevice {
  readonly backend = 'cpu';
  readonly native = null;
  readonly caps: RhiCaps = {
    compute: 'native',
    shaderLanguage: 'cpu',
    immediate: false,
    limits: LIMITS,
    hasFeature: () => false,
  };
  readonly #scopes: (string | null)[] = [];
  readonly #canvases = new WeakMap<object, CpuCanvas>();

  /** Record an error in the innermost open validation scope, or throw it when none is open. */
  #fail(message: string): never {
    if (this.#scopes.length > 0 && this.#scopes[this.#scopes.length - 1] === null)
      this.#scopes[this.#scopes.length - 1] = message;
    throw new TypeError(message);
  }

  createBuffer(desc: RhiBufferDesc): RhiBuffer {
    if (!Number.isInteger(desc.size) || desc.size < 0)
      this.#fail(`createBuffer: the size ${desc.size} is not a whole number of bytes.`);
    return new CpuBuffer(desc.size, desc.usage);
  }
  writeBuffer(buffer: RhiBuffer, byteOffset: number, data: ArrayBuffer | ArrayBufferView): void {
    const b = buffer as CpuBuffer;
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : new Uint8Array(data);
    if (byteOffset + bytes.length > b.size)
      this.#fail(
        `writeBuffer: ${bytes.length} bytes at ${byteOffset} do not fit a buffer of ${b.size}.`,
      );
    b.bytes.set(bytes, byteOffset);
  }
  readBuffer(buffer: RhiBuffer): Promise<ArrayBuffer> {
    const b = buffer as CpuBuffer;
    return Promise.resolve(b.bytes.slice().buffer);
  }
  destroyBuffer(buffer: RhiBuffer): void {
    (buffer as CpuBuffer).destroyed = true;
  }

  createTexture(desc: RhiTextureDesc): RhiTexture {
    if ((desc.sampleCount ?? 1) !== 1) this.#fail('The CPU backend makes no multisampled texture.');
    return new CpuTexture(desc.size[0], desc.size[1], desc.size[2], desc.format);
  }
  writeTexture(
    texture: RhiTexture,
    data: ArrayBufferView,
    bytesPerRow: number,
    width: number,
    height: number,
  ): void {
    const t = texture as CpuTexture;
    const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const row = width * t.kind.bytes;
    for (let y = 0; y < height; y++)
      t.bytes.set(src.subarray(y * bytesPerRow, y * bytesPerRow + row), y * t.width * t.kind.bytes);
  }
  readTexture(texture: RhiTexture, bytesPerTexel: number): Promise<Uint8Array> {
    const t = texture as CpuTexture;
    if (bytesPerTexel !== t.kind.bytes)
      return Promise.reject(
        new TypeError(
          `readTexture: a "${t.format}" texel is ${t.kind.bytes} bytes, not ${bytesPerTexel}.`,
        ),
      );
    return Promise.resolve(t.bytes.slice(0, t.width * t.height * t.kind.bytes));
  }
  destroyTexture(texture: RhiTexture): void {
    (texture as CpuTexture).destroyed = true;
  }
  createView(texture: RhiTexture): RhiTextureView {
    return new CpuView(texture as CpuTexture);
  }
  currentTexture(canvas: RhiCanvas): RhiTexture {
    const c = canvas as CpuCanvas;
    const { width, height } = c.context.canvas;
    if (c.texture === undefined || c.texture.width !== width || c.texture.height !== height)
      c.texture = new CpuTexture(width, height, 1, 'rgba8unorm', c);
    return c.texture;
  }

  createSampler(desc: RhiSamplerDesc): RhiSampler {
    return new CpuSampler(desc);
  }
  createShaderModule(code: string | CpuProgram): RhiShaderModule {
    if (!isCpuProgram(code))
      this.#fail(
        "The CPU backend runs a module's CPU program (change 0120, O2), not shader text; it got a string.",
      );
    return new CpuModule(code);
  }
  createBindGroupLayout(entries: readonly RhiBindLayoutEntry[]): RhiBindGroupLayout {
    for (const e of entries)
      if (!('buffer' in e))
        this.#fail(
          `The CPU backend binds buffers only; binding ${e.binding}${e.label !== undefined ? ` ("${e.label}")` : ''} is a texture or a sampler, which the CPU tier cannot read (change 0120, O6 (a)).`,
        );
    return new CpuBindLayout(entries);
  }
  createBindGroup(layout: RhiBindGroupLayout, entries: readonly RhiBindEntry[]): RhiBindGroup {
    for (const e of entries)
      if (!('buffer' in e.resource))
        this.#fail(`The CPU backend binds buffers only; binding ${e.binding} is not a buffer.`);
    return new CpuBindGroup(layout as CpuBindLayout, entries);
  }
  createComputePipeline(desc: RhiComputePipelineDesc): Promise<RhiComputePipeline> {
    try {
      return Promise.resolve(
        new CpuComputePipeline(
          stageOf(desc.module, desc.entryPoint, 'compute', desc.constants),
          desc.layouts,
        ),
      );
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }
  createRenderPipeline(desc: RhiRenderPipelineDesc): Promise<RhiRenderPipeline> {
    try {
      const why = refusalOf(desc);
      if (why !== undefined)
        throw new TypeError(
          `The CPU backend cannot make ${desc.label ?? 'the render pipeline'}: ${why} (change 0120, item 4).`,
        );
      const vertex = stageOf(desc.module, desc.vertex.entryPoint, 'vertex', desc.constants);
      const fragment =
        desc.fragment === undefined
          ? undefined
          : stageOf(
              desc.fragment.module ?? desc.module,
              desc.fragment.entryPoint,
              'fragment',
              desc.constants,
            );
      return Promise.resolve(new CpuRenderPipeline(vertex, fragment, desc));
    } catch (err) {
      return Promise.reject(err as Error);
    }
  }

  readonly #drawn = new Set<CpuCanvas>();
  createCommandEncoder(): RhiCommandEncoder {
    return new CpuEncoder(this.#drawn);
  }
  submit(encoders: readonly RhiCommandEncoder[]): Promise<void> {
    try {
      for (const e of encoders) for (const c of (e as CpuEncoder).commands) c();
    } catch (err) {
      this.#drawn.clear();
      if (this.#scopes.length > 0 && this.#scopes[this.#scopes.length - 1] === null)
        this.#scopes[this.#scopes.length - 1] = err instanceof Error ? err.message : String(err);
      return Promise.reject(err as Error);
    }
    for (const canvas of this.#drawn) present(canvas);
    this.#drawn.clear();
    return Promise.resolve();
  }
  pushValidationScope(): void {
    this.#scopes.push(null);
  }
  popValidationScope(): Promise<string | null> {
    return Promise.resolve(this.#scopes.pop() ?? null);
  }

  fromNative<K extends keyof RhiNativeKinds>(
    kind: K,
    native: object,
  ): RhiNativeKinds[K] | undefined {
    const is: Record<keyof RhiNativeKinds, (v: object) => boolean> = {
      buffer: (v) => v instanceof CpuBuffer,
      texture: (v) => v instanceof CpuTexture,
      view: (v) => v instanceof CpuView,
      sampler: (v) => v instanceof CpuSampler,
      canvas: (v) => v instanceof CpuCanvas,
      encoder: (v) => v instanceof CpuEncoder,
      'compute-pass': (v) => v instanceof CpuComputePassImpl,
      'render-pass': (v) => v instanceof CpuRenderPass,
    };
    if (is[kind](native)) return native as RhiNativeKinds[K];
    if (kind === 'canvas' && isContext2d(native)) {
      let c = this.#canvases.get(native);
      if (c === undefined) this.#canvases.set(native, (c = new CpuCanvas(native)));
      return c as unknown as RhiNativeKinds[K];
    }
    return undefined;
  }
  /** The CPU backend has no native objects: each handle is its own. */
  toNative(handle: object): object {
    return handle instanceof CpuCanvas ? handle.context : handle;
  }
  destroy(): void {}
}

/** Show the canvas's texture on its `2d` context. */
function present(c: CpuCanvas): void {
  const t = c.texture;
  if (t === undefined) return;
  const image = c.context.createImageData(t.width, t.height);
  image.data.set(t.bytes);
  c.context.putImageData(image, 0, 0);
}

/** A software device: the CPU backend of the render hardware interface. */
export function cpuDevice(): RhiDevice {
  return new CpuDevice();
}
