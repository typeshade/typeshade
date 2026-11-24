import { pinOverrides, glslOverrideNames } from '../core/gl-overrides.js';
export { pinOverrides, glslOverrideNames } from '../core/gl-overrides.js';

// Implements: Rule 11.11

import { byteSize, describe, Misfit, pack, type Layout } from '../core/host-entry.js';
import {
  layoutFromPack,
  type Pack,
  type PackBinding,
  type PackEntry,
  type PackGlDraw,
  type PackGlVertex,
} from '../core/manifest-types.js';
import {
  decide,
  geometryKind,
  layoutKind,
  residentState,
  tentatively,
  type ResidentArrayState,
} from '../core/resident.js';
import { hostSite } from '../core/submission.js';
import {
  at,
  blendConstantOf,
  checkPassFit,
  depthStencilAttachmentOf,
  entryOf,
  passOf,
  planOf,
  scissorOf,
  stencilReferenceOf,
  viewportOf,
  type Bindings,
  type Geometry,
  type PassFit,
  type RenderPipeline,
  type RenderPlan,
  type RenderState,
} from './program.js';
import type { PassTargets, RenderPass } from './runtime.js';
import {
  STAGE,
  type RhiBindLayoutEntry,
  type RhiBindResource,
  type RhiBuffer,
  type RhiColorAttachment,
  type RhiColorTarget,
  type RhiDevice,
  type RhiRenderPass,
  type RhiTexture,
} from '../rhi/rhi.js';
import { GL_BLEND_FACTOR, GL_BLEND_OPERATION, GL_TOPOLOGY, glReadBindings } from '../rhi/webgl2.js';
import type { GlDrawing } from './gl-draw/drawing.js';
import { glslNameOf } from './gl-draw/glsl-name.js';
import { GlTextureImpl } from './gl-draw/texture.js';
import type { Slot, Built, DrawRun } from './gl-draw/pipeline-types.js';
import { textureOf, samplerOf } from './gl-draw/draw-handles.js';
export { textureOf, samplerOf } from './gl-draw/draw-handles.js';
export { GlSamplerImpl } from './gl-draw/sampler.js';
export { GlTextureImpl } from './gl-draw/texture.js';
export { glslNameOf } from './gl-draw/glsl-name.js';
export { GlDrawing } from './gl-draw/drawing.js';

const BIASED_FORMATS: readonly string[] = ['depth24plus', 'depth32float', 'depth24plus-stencil8'];

function refuseBias(
  prefix: string,
  depth: NonNullable<RenderPlan['depth']>,
  clampExtension: boolean,
): void {
  const b = depth.bias;
  const biased = BIASED_FORMATS.includes(depth.format);
  if (b.constant !== 0 && !biased)
    throw new TypeError(
      `${prefix} sets depth.bias.constant on ${depth.format}; the WebGL2 tier takes a bias on depth24plus, depth32float and depth24plus-stencil8 only.`,
    );
  if (b.slopeScale !== 0 && !biased)
    throw new TypeError(
      `${prefix} sets depth.bias.slopeScale to ${b.slopeScale} on ${depth.format}; the WebGL2 tier takes a bias on depth24plus, depth32float and depth24plus-stencil8 only.`,
    );
  if (b.clamp !== 0 && !clampExtension)
    throw new TypeError(
      `${prefix} sets depth.bias.clamp to ${b.clamp}; a non-zero clamp is not supported yet on the WebGL2 tier without EXT_polygon_offset_clamp (Rule 11.11), and this context lacks it.`,
    );
}

interface BlendComponent {
  readonly srcFactor?: string;
  readonly dstFactor?: string;
  readonly operation?: string;
}

export class GlRenderPrograms {
  readonly #pipelines = new Map<string, Promise<GlRenderPipelineImpl>>();
  readonly #built = new Map<string, Promise<Built>>();
  readonly #bindings: ReadonlyMap<string, PackBinding>;

  constructor(
    readonly d: GlDrawing,
    readonly manifest: Pack,
  ) {
    this.#bindings = new Map(manifest.bindings.map((b) => [b.name, b]));
  }

  render(state: RenderState): Promise<RenderPipeline> {
    const m = this.manifest;
    const vs = entryOf(m, state.vertex, 'vertex');
    const fs =
      state.fragment === null ? undefined : entryOf(m, state.fragment ?? undefined, 'fragment');
    const plan = planOf(m, vs, fs, state);
    const hit = this.#pipelines.get(plan.key);
    if (hit !== undefined) return hit;
    let built = this.#built.get(plan.gpuKey);
    if (built === undefined) {
      built = this.#build(vs, fs, plan);
      this.#built.set(plan.gpuKey, built);
      built.catch(() => this.#built.delete(plan.gpuKey));
    }
    const p = built.then(
      (b) =>
        new GlRenderPipelineImpl(
          this,
          vs,
          fs,
          b,
          plan.blendConstant,
          fs?.outputs?.some((o) => o.builtin === 'frag_depth') ?? false,
          plan.depth,
          plan.depth?.stencil?.reference,
          plan.multisample.mask,
          plan.writes,
        ),
    );
    this.#pipelines.set(plan.key, p);
    p.catch(() => this.#pipelines.delete(plan.key));
    return p;
  }

  #build(vs: PackEntry, fs: PackEntry | undefined, plan: RenderPlan): Promise<Built> {
    const m = this.manifest;
    const rhi = this.d.rhi;
    const v = stageOf(m.gl?.vertices?.[vs.name], vs);
    const f = fs === undefined ? undefined : stageOf(m.gl?.draws?.[fs.name], fs);
    const prefix = `The render pipeline of "${(fs ?? vs).name}"${at(fs ?? vs)}`;
    if (plan.multisample.count !== 1)
      throw new TypeError(
        `${prefix}: a multisampled target is not supported yet on the WebGL2 tier (Rule 10.5, Rule 11.11).`,
      );
    if (plan.depth !== undefined)
      refuseBias(prefix, plan.depth, rhi.caps.hasFeature('EXT_polygon_offset_clamp'));
    const samplers: Record<string, string | null> = { ...v.samplers };
    for (const [texture, sampler] of Object.entries(f?.samplers ?? {})) {
      const previous = samplers[texture];
      if (previous != null && sampler !== null && previous !== sampler)
        throw new TypeError(
          `${prefix}: it samples "${texture}" with "${previous}" and "${sampler}", and a texture with more than one sampler is not supported yet on the WebGL2 tier. Declare the texture twice, one binding per sampler.`,
        );
      samplers[texture] = previous ?? sampler;
    }
    checkState(plan, vs, fs);
    const pin = (src: string): string =>
      plan.constants === undefined ? src : pinOverrides(src, plan.constants, glslOverrideNames(m));
    const { entries, slots } = this.#layout(v as PackGlVertex, f, samplers);
    const layout = rhi.createBindGroupLayout(entries);
    const attributes = vs.vertex;
    return rhi
      .createRenderPipeline({
        label: `the render pipeline of "${vs.name}" and "${fs?.name ?? 'no fragment'}"`,
        layouts: [layout],
        module: rhi.createShaderModule(pin((v as PackGlVertex).vertex)),
        vertex: {
          entryPoint: 'main',
          buffers:
            attributes === undefined
              ? []
              : [
                  {
                    arrayStride: attributes.arrayStride,
                    attributes: attributes.attributes.map((a) => ({
                      shaderLocation: a.location,
                      offset: a.offset,
                      format: a.format,
                    })),
                  },
                ],
        },
        ...(f !== undefined
          ? {
              fragment: {
                entryPoint: 'main',
                targets: plan.targets as readonly RhiColorTarget[],
                module: rhi.createShaderModule(pin((f as PackGlDraw).fragment)),
              },
            }
          : {}),
        primitive: plan.primitive,
        ...(plan.depth !== undefined ? { depthStencil: plan.depth } : {}),
        multisample: plan.multisample,
      })
      .then((pipeline) => {
        const read = new Set(glReadBindings(pipeline)[0]);
        return { pipeline, layout, slots: slots.filter((s) => read.has(s.index)) };
      });
  }

  #layout(
    v: PackGlVertex,
    f: PackGlDraw | undefined,
    samplers: Readonly<Record<string, string | null>>,
  ): { entries: RhiBindLayoutEntry[]; slots: Slot[] } {
    const visibility = STAGE.vertex | STAGE.fragment;
    const blocks = { ...v.blocks, ...f?.blocks };
    const data = [...new Set([...(v.data ?? []), ...(f?.data ?? [])])].sort();
    const entries: RhiBindLayoutEntry[] = [];
    const slots: Slot[] = [];
    const layoutOfBinding = (b: PackBinding): { layout?: Layout } =>
      b.layout !== undefined ? { layout: layoutFromPack(b.layout) } : {};
    for (const name of Object.keys(blocks).sort()) {
      const b = this.#bindings.get(name)!;
      const index = entries.length;
      entries.push({
        binding: index,
        visibility,
        name: blocks[name]!,
        label: name,
        buffer: { type: 'uniform' },
      });
      slots.push({ binding: b, index, kind: 'block', ...layoutOfBinding(b) });
    }
    const textures = Object.keys(samplers).sort();
    const samplerIndex = new Map<string, number>();
    for (const name of textures) {
      const sampler = samplers[name];
      if (sampler != null && !samplerIndex.has(sampler))
        samplerIndex.set(
          sampler,
          entries.length + textures.length + data.length + samplerIndex.size,
        );
    }
    for (const name of textures) {
      const b = this.#bindings.get(name)!;
      const index = entries.length;
      const sampler = samplers[name];
      const paired =
        sampler == null ? undefined : { name: sampler, index: samplerIndex.get(sampler)! };
      entries.push({
        binding: index,
        visibility,
        name: glslNameOf(b),
        label: name,
        ...(paired !== undefined ? { samplerBinding: paired.index } : {}),
        texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
      });
      slots.push({
        binding: b,
        index,
        kind: 'texture',
        ...(paired !== undefined ? { sampler: paired } : {}),
      });
    }
    for (const name of data) {
      const b = this.#bindings.get(name)!;
      const index = entries.length;
      entries.push({
        binding: index,
        visibility,
        name: glslNameOf(b),
        label: name,
        buffer: { type: 'read-only-storage' },
      });
      slots.push({ binding: b, index, kind: 'data', ...layoutOfBinding(b) });
    }
    for (const [name, index] of samplerIndex)
      entries.push({
        binding: index,
        visibility,
        label: name,
        sampler: { type: 'filtering' },
      });
    return { entries, slots };
  }
}

function checkState(plan: RenderPlan, vs: PackEntry, fs: PackEntry | undefined): void {
  const where = `The render pipeline of "${(fs ?? vs).name}"`;
  if (GL_TOPOLOGY[plan.primitive.topology] === undefined)
    throw new TypeError(
      `${where}: "${String(plan.primitive.topology)}" is not a topology; WebGPU's are ${Object.keys(GL_TOPOLOGY).join(', ')}.`,
    );
  const targets = plan.targets;
  const first = targets[0];
  for (const t of targets.slice(1))
    if (
      JSON.stringify(t.blend) !== JSON.stringify(first?.blend) ||
      (t.writeMask ?? 15) !== (first?.writeMask ?? 15)
    )
      throw new TypeError(
        `${where}: targets that blend or mask apart are not supported yet on the WebGL2 tier (Rule 11.11); give its targets one blend and one writeMask.`,
      );
  const blend = first?.blend as { color?: BlendComponent; alpha?: BlendComponent } | undefined;
  if (blend === undefined) return;
  for (const [f, d] of [
    [blend.color?.srcFactor, 'one'],
    [blend.alpha?.srcFactor, 'one'],
    [blend.color?.dstFactor, 'zero'],
    [blend.alpha?.dstFactor, 'zero'],
  ] as const)
    if (GL_BLEND_FACTOR[f ?? d] === undefined)
      throw new TypeError(`${where}: "${String(f)}" is not a blend factor.`);
  for (const o of [blend.color?.operation, blend.alpha?.operation])
    if (GL_BLEND_OPERATION[o ?? 'add'] === undefined)
      throw new TypeError(`${where}: "${String(o)}" is not a blend operation.`);
}

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

interface Bind {
  readonly index: number;
  readonly resource: (made: RhiBuffer[]) => RhiBindResource;
}

const SAMPLES_OWN_DEPTH =
  'Sampling the depth attachment of the pass that writes it is not supported yet on the WebGL2 tier (Rule 11.11); sample it in a later pass.';

export class GlRenderPipelineImpl implements RenderPipeline {
  constructor(
    private readonly programs: GlRenderPrograms,
    private readonly vs: PackEntry,
    private readonly fs: PackEntry | undefined,
    private readonly built: Built,
    private readonly blendConstant: readonly [number, number, number, number] | undefined,
    private readonly writesFragDepth: boolean,
    private readonly depth: RenderPlan['depth'],
    private readonly stencilReference: number | undefined,
    private readonly sampleMask: number,
    private readonly writes: RenderPlan['writes'],
  ) {}

  get vertex(): string {
    return this.vs.name;
  }
  get fragment(): string | null {
    return this.fs?.name ?? null;
  }

  draw(target: object, bindings: Bindings, geometry: Geometry): void {
    tentatively(() => this.#draw(target, bindings, geometry));
  }

  #draw(target: object, bindings: Bindings, geometry: Geometry): void {
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
    checkPassFit(entry.name, this.depth, this.writes, target);
    const [near, far] = target.range;
    if (this.writesFragDepth && (near !== 0 || far !== 1))
      throw new TypeError(
        `pass.draw: the pipeline of "${this.fs!.name}" writes frag_depth, and the depth range is ${near} to ${far}; the WebGL2 tier refuses this range.`,
      );
    let blend: readonly [number, number, number, number] | undefined;
    if (this.blendConstant !== undefined) blend = this.blendConstant;
    else if (target.declared) blend = [...target.blend] as unknown as typeof blend;
    const reference =
      this.depth?.stencil === undefined
        ? undefined
        : (this.stencilReference ?? target.stencilReference);
    const run = this.#record(entry, bindings, geometry, blend, reference, target);
    if ((this.sampleMask & 1) === 0) return;
    target.declared = this.blendConstant !== undefined;
    target.add(run);
  }

  #record(
    entry: PackEntry,
    values: Bindings,
    geometry: Geometry,
    blend: readonly [number, number, number, number] | undefined,
    reference: number | undefined,
    pass: GlPass,
  ): DrawRun {
    if (typeof values !== 'object' || values === null)
      throw new TypeError(
        `"${entry.name}"${at(entry)}: the bindings are ${describe(values)}, not an object.`,
      );
    const d = this.programs.d;
    const rhi = d.rhi;
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
    const binds: Bind[] = [];
    const residents: ResidentArrayState[] = [];
    for (const s of this.built.slots) {
      const b = s.binding;
      const where = `"${entry.name}"${at(entry)}, binding "${b.name}" (${b.type})`;
      if (b.name === '_fp64') {
        binds.push({ index: s.index, resource: () => ({ view: d.guard() }) });
        continue;
      }
      const v = values[b.name];
      if (v === undefined) throw new TypeError(`${where} is not given.`);
      if (s.kind === 'texture') {
        const tex = textureOf(rhi, v, where);
        if (pass.readsOwnDepth(v, tex)) throw new TypeError(SAMPLES_OWN_DEPTH);
        const view = rhi.createView(tex);
        binds.push({ index: s.index, resource: () => ({ view }) });
        const sv = s.sampler === undefined ? undefined : values[s.sampler.name];
        if (sv !== undefined) {
          const sampler = samplerOf(
            rhi,
            sv,
            `"${entry.name}"${at(entry)}, binding "${s.sampler!.name}"`,
          );
          binds.push({ index: s.sampler!.index, resource: () => ({ sampler }) });
        }
        continue;
      }
      const host =
        s.kind === 'block' && typeof v === 'object' && v !== null
          ? rhi.fromNative('buffer', v)
          : undefined;
      if (host !== undefined) {
        binds.push({ index: s.index, resource: () => ({ buffer: host }) });
        continue;
      }
      if (s.layout === undefined)
        throw new TypeError(
          `${where} has no host value${b.noLayout !== undefined ? `: ${b.noLayout}` : ''}.`,
        );
      const layout = s.layout;
      const elem = dataElemOf(b);
      const state = residentState(v);
      if (state !== undefined) {
        if (state.destroyed)
          throw new TypeError('This Buffer was disposed; make a new one with array().');
        decide(state, layoutKind(layout), where, hostSite);
        residents.push(state);
        binds.push({
          index: s.index,
          resource: (made) => {
            const bytes = packed(layout, state.host, b.name, where);
            if (s.kind === 'block') return { buffer: fresh(rhi, made, 'uniform', bytes) };
            return {
              buffer: d.uploaded(state, 'data', bytes, (size) =>
                rhi.createBuffer({ size, usage: ['storage', 'copy-dst'], elem }),
              ),
            };
          },
        });
        continue;
      }
      const bytes = packed(layout, v, b.name, where);
      binds.push({
        index: s.index,
        resource: (made) => ({
          buffer: fresh(rhi, made, s.kind === 'block' ? 'uniform' : 'storage', bytes, elem),
        }),
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
    const { pipeline, layout } = this.built;
    const run = (p: RhiRenderPass): void => {
      const made: RhiBuffer[] = [];
      p.setPipeline(pipeline);
      p.setBindGroup(
        0,
        rhi.createBindGroup(
          layout,
          binds.map((x) => ({ binding: x.index, resource: x.resource(made) })),
        ),
      );
      const vb = vertices?.(made);
      if (vb !== undefined) p.setVertexBuffer(0, vb);
      const ib = indices?.(made);
      if (ib !== undefined) p.setIndexBuffer(ib.buffer, ib.format);
      if (blend !== undefined) p.setBlendConstant(blend);
      if (reference !== undefined) p.setStencilReference(reference);
      if (ib === undefined) p.draw(count, instances);
      else p.drawIndexed(count, instances);
      for (const o of made) rhi.destroyBuffer(o);
    };
    return { run, residents };
  }

  #vertices(geometry: Geometry, entry: PackEntry): ((made: RhiBuffer[]) => RhiBuffer) | undefined {
    if (this.vs.vertex === undefined) return undefined;
    const v = geometry.vertices;
    if (v === undefined)
      throw new TypeError(
        `"${this.vs.name}"${at(this.vs)} reads vertex attributes; the geometry gives no vertices.`,
      );
    return bufferSource(this.programs.d, v, 'vertices', entry);
  }

  #indices(
    geometry: Geometry,
    entry: PackEntry,
  ): ((made: RhiBuffer[]) => { buffer: RhiBuffer; format: 'uint16' | 'uint32' }) | undefined {
    const idx = geometry.indices;
    if (idx === undefined) return undefined;
    const d = this.programs.d;
    if (residentState(idx) !== undefined || ArrayBuffer.isView(idx)) {
      const format =
        residentState(idx) !== undefined || idx instanceof Uint32Array ? 'uint32' : 'uint16';
      const source = bufferSource(d, idx, 'indices', entry);
      return (made) => ({ buffer: source(made), format });
    }
    const host = idx as { readonly buffer: object; readonly format: 'uint16' | 'uint32' };
    const buffer =
      typeof host.buffer === 'object' && host.buffer !== null
        ? d.rhi.fromNative('buffer', host.buffer)
        : undefined;
    if (buffer === undefined)
      throw new TypeError(
        `"${entry.name}"${at(entry)}: the geometry's indices on WebGL2 take a typed array, a Buffer or { buffer: WebGLBuffer, format }.`,
      );
    const format = host.format === 'uint32' ? 'uint32' : 'uint16';
    return () => ({ buffer, format });
  }
}

const dataElemOf = (b: PackBinding): 'f32' | 'i32' | 'u32' => {
  const format = b.dataTexture?.format ?? 'r32float';
  return format === 'r32uint' ? 'u32' : format === 'r32sint' ? 'i32' : 'f32';
};

function fresh(
  rhi: RhiDevice,
  made: RhiBuffer[],
  kind: 'uniform' | 'storage' | 'vertex' | 'index',
  bytes: ArrayBufferView,
  elem?: 'f32' | 'i32' | 'u32',
): RhiBuffer {
  const b = rhi.createBuffer({
    size: bytes.byteLength,
    usage: [kind, 'copy-dst'],
    ...(kind === 'storage' && elem !== undefined ? { elem } : {}),
  });
  made.push(b);
  rhi.writeBuffer(b, 0, bytes);
  return b;
}

function bufferSource(
  d: GlDrawing,
  v: unknown,
  field: 'vertices' | 'indices',
  entry: PackEntry,
): (made: RhiBuffer[]) => RhiBuffer {
  const usage = field === 'indices' ? 'index' : 'vertex';
  const state = residentState(v);
  if (state !== undefined) {
    decide(
      state,
      geometryKind(field, entry.vertex?.attributes),
      `"${entry.name}"${at(entry)}: the geometry's ${field}`,
      hostSite,
    );
    const host = state.view();
    const takes =
      field === 'indices'
        ? host instanceof Uint32Array
        : host instanceof Float32Array || host instanceof Int32Array || host instanceof Uint32Array;
    if (!takes)
      throw new TypeError(
        `"${entry.name}"${at(entry)}: the geometry's ${field} is a Buffer of ${describe(host)}; ${
          field === 'indices'
            ? 'indices take a Buffer<u32>'
            : 'vertices take a Buffer<f32>, a Buffer<i32> or a Buffer<u32>'
        }.`,
      );
    return () =>
      d.uploaded(state, field, state.host as ArrayBufferView, (size) =>
        d.rhi.createBuffer({ size, usage: [usage, 'copy-dst'] }),
      );
  }
  if (ArrayBuffer.isView(v)) {
    const copy = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    return (made) => fresh(d.rhi, made, usage, copy);
  }
  const host = typeof v === 'object' && v !== null ? d.rhi.fromNative('buffer', v) : undefined;
  if (host !== undefined) return () => host;
  throw new TypeError(
    `"${entry.name}"${at(entry)}: the geometry's ${field} on WebGL2 take a typed array, a Buffer or a WebGLBuffer; got ${describe(v)}.`,
  );
}

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

export class GlPass implements RenderPass, PassFit {
  readonly steps: DrawRun[] = [];
  blend: readonly number[] = [0, 0, 0, 0];
  declared = false;
  range: [number, number] = [0, 1];
  stencilReference = 0;

  constructor(
    private readonly info: {
      readonly rhi: RhiDevice;
      readonly width: number;
      readonly height: number;
      readonly depthFormat?: string;
      readonly depthReadOnly: boolean;
      readonly stencilReadOnly: boolean;
      readonly depthTarget?: object;
      readonly depthTexture?: RhiTexture;
    },
  ) {}

  get raw(): object {
    throw new TypeError('A pass on WebGL2 has no GPURenderPassEncoder.');
  }

  get depthFormat(): string | undefined {
    return this.info.depthFormat;
  }

  get depthReadOnly(): boolean {
    return this.info.depthReadOnly;
  }

  get stencilReadOnly(): boolean {
    return this.info.stencilReadOnly;
  }

  readsOwnDepth(value: unknown, texture: RhiTexture): boolean {
    const own = this.info.depthTexture;
    return (
      value === this.info.depthTarget ||
      (own !== undefined && this.info.rhi.toNative(texture) === this.info.rhi.toNative(own))
    );
  }

  setStencilReference(reference: number): void {
    this.stencilReference = stencilReferenceOf(reference);
  }

  add(run: DrawRun): void {
    this.steps.push(run);
  }

  draw<B>(pipeline: RenderPipeline<B>, bindings: NoInfer<B>, geometry: Geometry): void {
    pipeline.draw(this, bindings, geometry);
  }

  setViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth?: number,
    maxDepth?: number,
  ): void {
    const limit = this.info.rhi.caps.limits.maxViewportDimension!;
    const v = viewportOf(x, y, width, height, minDepth, maxDepth, limit);
    this.range = [v.minDepth, v.maxDepth];
    this.add({
      residents: [],
      run: (p) => p.setViewport(...v.rect, v.minDepth, v.maxDepth),
    });
  }

  setScissorRect(x: number, y: number, width: number, height: number): void {
    const r = scissorOf(x, y, width, height, { width: this.info.width, height: this.info.height });
    this.add({ residents: [], run: (p) => p.setScissorRect(...r) });
  }

  setBlendConstant(color: ArrayLike<number>): void {
    const c = blendConstantOf(color);
    this.blend = c;
    this.declared = false;
    this.add({ residents: [], run: (p) => p.setBlendConstant(c) });
  }
}

export function recordPass(
  d: GlDrawing,
  targets: PassTargets,
  record: (pass: RenderPass) => void,
): () => Promise<void> {
  const rhi = d.rhi;
  const plan = passOf(targets, {
    isTexture: (t) => t instanceof GlTextureImpl,
    isCanvas: (t) => rhi.fromNative('canvas', t) !== undefined,
    formatOf: (t) => (t instanceof GlTextureImpl ? t.format : undefined),
  });
  const colour: { attachment: RhiColorAttachment; w: number; h: number }[] = plan.color.map(
    (c, i) => {
      const t = c.target;
      const common = { clearValue: c.clear, loadOp: c.load, storeOp: c.store } as const;
      if (t instanceof GlTextureImpl) {
        if (t.kind === 'depth')
          throw new TypeError(
            `pass(): colour target ${i} is a ${t.format} texture, which holds depth.`,
          );
        return {
          attachment: { view: rhi.createView(t.handle), ...common },
          w: t.width,
          h: t.height,
        };
      }
      const canvas = rhi.fromNative('canvas', t);
      if (canvas !== undefined) {
        const screen = rhi.currentTexture(canvas);
        return {
          attachment: { view: rhi.createView(screen), ...common },
          w: screen.width,
          h: screen.height,
        };
      }
      throw new TypeError(
        `pass(): a colour target on WebGL2 is a Texture of the runtime, or its context for the canvas; got ${describe(t)}.`,
      );
    },
  );
  const pd = plan.depth;
  let depth: { tex: RhiTexture; target: object; w: number; h: number } | undefined;
  if (pd !== undefined) {
    const t = pd.target;
    if (!(t instanceof GlTextureImpl) || t.kind !== 'depth')
      throw new TypeError(
        `pass(): the depth target on WebGL2 is a depth Texture of the runtime; got ${describe(t)}.`,
      );
    depth = { tex: t.handle, target: t, w: t.width, h: t.height };
  }
  const sizes = [...colour, ...(depth === undefined ? [] : [depth])];
  const w = sizes[0]?.w ?? 0;
  const h = sizes[0]?.h ?? 0;
  if (sizes.some((a) => a.w !== w || a.h !== h))
    throw new TypeError('pass(): every attachment of a pass has one size.');
  const pass = new GlPass({
    rhi,
    width: w,
    height: h,
    depthFormat: pd?.format,
    depthReadOnly: pd?.depth.readOnly ?? false,
    stencilReadOnly: pd?.stencil?.readOnly ?? false,
    depthTarget: depth?.target,
    depthTexture: depth?.tex,
  });
  record(pass);
  const steps = pass.steps;
  const colorAttachments = colour.map((c) => c.attachment);
  const depthStencilAttachment =
    pd === undefined || depth === undefined
      ? undefined
      : depthStencilAttachmentOf(rhi.createView(depth.tex), pd);
  return async () => {
    for (const step of steps)
      for (const state of step.residents)
        if (state.fresh === 'device' || state.host === undefined) await state.sync();
    const encoder = rhi.createCommandEncoder();
    const p = encoder.beginRenderPass({
      colorAttachments,
      ...(depthStencilAttachment !== undefined ? { depthStencilAttachment } : {}),
    });
    for (const step of steps) step.run(p);
    p.end();
    await rhi.submit([encoder]);
  };
}
