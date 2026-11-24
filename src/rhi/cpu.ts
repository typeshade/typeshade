import { isCpuProgram, type CpuProgram } from './cpu-program.js';
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
import { FORMATS } from './cpu/format.js';
import { CpuBuffer } from './cpu/buffer.js';
import { CpuTexture, isContext2d, CpuCanvas, present } from './cpu/canvas.js';
import { CpuView, CpuSampler, CpuModule, CpuBindLayout, CpuBindGroup } from './cpu/handles.js';
import { argOf, fieldsOf, stageOf, type Stage } from './cpu/stage.js';
import { boundOf, bindTo, writeBack } from './cpu/binding.js';
import { CpuComputePipeline, CpuRenderPipeline } from './cpu/pipelines.js';
import { attributeFormat, attributeValue, type Attribute } from './cpu/vertex-fetch.js';
import { writeTexel, clearTexture, clearDepth } from './cpu/texel.js';
import { LIMITS } from './cpu/limits.js';
export { holdValue } from './cpu/binding.js';
export { decode, encode } from './cpu/codec.js';

function invoke(stage: Stage, args: readonly unknown[], invocation?: readonly number[]): unknown {
  const F = stage.code.F as Readonly<Record<string, ((...a: unknown[]) => unknown) | undefined>>;
  F['$initPrivates']?.();
  stage.code.$.invocation = invocation;
  return F[stage.entry.fn]!(...args);
}

const fresh = (v: unknown): unknown =>
  v === undefined ? v : (JSON.parse(JSON.stringify(v)) as unknown);

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

function refusalOf(desc: RhiRenderPipelineDesc): string | undefined {
  if (desc.primitive.topology !== 'triangle-list') return `a "${desc.primitive.topology}" topology`;
  if (desc.depthStencil !== undefined) return 'a depth or stencil test';
  if (desc.multisample.count !== 1) return 'multisampling';
  for (const t of desc.fragment?.targets ?? []) {
    if (t.blend !== undefined) return 'blending';
    const f = FORMATS[t.format];
    if (f === undefined || f.channels.length === 0) return `a "${t.format}" colour target`;
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
    if ((desc.sampleCount ?? 1) !== 1)
      this.#fail('A multisampled texture is not supported yet on the CPU tier (Rule 11.7).');
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
          `The CPU backend binds buffers only; binding ${e.binding}${e.label !== undefined ? ` ("${e.label}")` : ''} is a texture or a sampler, which the CPU tier does not support yet (Rule 8.24, Rule 11.7).`,
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
          `The CPU tier does not support ${why} yet in ${desc.label ?? 'the render pipeline'} (Rule 11.7).`,
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
  toNative(handle: object): object {
    return handle instanceof CpuCanvas ? handle.context : handle;
  }
  destroy(): void {}
}

export function cpuDevice(): RhiDevice {
  return new CpuDevice();
}
