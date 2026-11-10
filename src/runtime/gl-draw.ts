import { pinOverrides, glslOverrideNames } from '../core/gl-overrides.js';
export { pinOverrides, glslOverrideNames } from '../core/gl-overrides.js';

// The program runtime's draws on WebGL2 (change 0054 decision 2, Rule 11.11): textures, samplers,
// render pipelines and passes, from the vertex and fragment programs the manifest carries
// (`Pack.gl.vertices`, `Pack.gl.draws`). It builds no program itself, so like the rest of the
// runtime it imports no compiler.
//
// The render hardware interface (change 0120, M2). Every object and command goes through the
// WebGL2 backend of `src/rhi/webgl2.ts`, which keeps WebGPU's conventions (row 0 at the top,
// `position`, depth, `frontFace`) and turns a pass into the canvas over onto the screen. This file
// checks what a host gives, binds it by name, and records; it calls no WebGL2 function.
//
// Order. A pass is recorded into a frame and runs at `submit()`, and a texture's `read()` runs
// where it is called, each after every call, frame and read before it (`core/resident.ts`), so a
// read reads what was submitted before it, as on WebGPU.

import { byteSize, describe, Misfit, pack, type Layout } from '../core/host-entry.js';
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
  type CompareFunction,
  type Geometry,
  type PassFit,
  type RenderPipeline,
  type RenderPlan,
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
import {
  STAGE,
  type RhiBindGroupLayout,
  type RhiBindLayoutEntry,
  type RhiBindResource,
  type RhiBuffer,
  type RhiColorAttachment,
  type RhiColorTarget,
  type RhiDevice,
  type RhiRenderPass,
  type RhiRenderPipeline,
  type RhiSampler,
  type RhiTexture,
  type RhiTextureView,
} from '../rhi/rhi.js';
import {
  GL_BLEND_FACTOR,
  GL_BLEND_OPERATION,
  GL_TOPOLOGY,
  glReadBindings,
  textureKindOf,
  type GlTextureKind,
} from '../rhi/webgl2.js';

// ─── overrides ───────────────────────────────────────────────────────────────────────────────

/** The name the GLSL program declares a manifest binding under (Proposal 0070, C8). */
export const glslNameOf = (b: {
  readonly emitted: string;
  readonly emittedGlsl?: string;
}): string => b.emittedGlsl ?? b.emitted;

// ─── the drawing state of one runtime ────────────────────────────────────────────────────────

/** What every texture, pipeline and pass of one runtime shares: its device, and what a
 *  `Resident` uploaded last. */
export class GlDrawing {
  #guard: RhiTextureView | undefined;
  /** What a `Resident` uploaded last, by what it became: a vertex, index or storage buffer. */
  readonly uploads = new WeakMap<
    ResidentArrayState,
    Map<string, { buffer: RhiBuffer; version: number }>
  >();

  constructor(readonly rhi: RhiDevice) {}

  /** The `_fp64` guard: a 1 × 1 texture that holds 1.0. */
  guard(): RhiTextureView {
    if (this.#guard === undefined) {
      const t = this.rhi.createTexture({
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: ['sampled', 'copy-dst'],
      });
      this.rhi.writeTexture(t, new Uint8Array([255, 255, 255, 255]), 4, 1, 1);
      this.#guard = this.rhi.createView(t);
    }
    return this.#guard;
  }

  /** The buffer `state` was uploaded into as `as`, written again only when its host copy has
   *  changed, and made again when its size has. */
  uploaded(
    state: ResidentArrayState,
    as: string,
    bytes: ArrayBufferView,
    make: (size: number) => RhiBuffer,
  ): RhiBuffer {
    let byKind = this.uploads.get(state);
    if (byKind === undefined) this.uploads.set(state, (byKind = new Map()));
    const hit = byKind.get(as);
    if (hit !== undefined && hit.version === state.version) return hit.buffer;
    let buffer = hit?.buffer;
    if (buffer === undefined || buffer.size !== bytes.byteLength) {
      if (buffer !== undefined) this.rhi.destroyBuffer(buffer);
      buffer = make(bytes.byteLength);
    }
    this.rhi.writeBuffer(buffer, 0, bytes);
    byKind.set(as, { buffer, version: state.version });
    return buffer;
  }
}

// ─── textures and samplers ───────────────────────────────────────────────────────────────────

/** A texture of the WebGL2 tier: a sampled texture and a render target at once. */
export class GlTextureImpl implements Texture {
  #tex: RhiTexture;
  #w: number;
  #h: number;
  readonly #kind: GlTextureKind;
  readonly #storage: boolean;

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
    // `storage: true` asks for nothing more here: a compute entry's storage texture is a memory
    // root of its pass program, drawn back into this texture after the dispatch (change 0054).
    const kind = textureKindOf(o.format);
    if (kind === undefined) throw new TypeError(`texture(): WebGL2 has no ${o.format} texture.`);
    this.format = o.format;
    this.#kind = kind;
    this.#storage = o.storage === true;
    this.#w = o.size[0];
    this.#h = o.size[1];
    this.#tex = this.#make();
  }

  readonly format: string;

  #make(): RhiTexture {
    return this.d.rhi.createTexture({
      size: [this.#w, this.#h, 1],
      format: this.format,
      usage: [
        'render',
        'sampled',
        'copy-src',
        'copy-dst',
        ...(this.#storage ? ['storage' as const] : []),
      ],
    });
  }

  get texture(): object {
    return this.d.rhi.toNative(this.#tex);
  }
  /** The device's texture now: a resize replaces it. */
  get handle(): RhiTexture {
    return this.#tex;
  }
  get width(): number {
    return this.#w;
  }
  get height(): number {
    return this.#h;
  }
  /** How the texels are cleared and read. */
  get kind(): GlTextureKind {
    return this.#kind;
  }

  resize(width: number, height: number): void {
    if (width === this.#w && height === this.#h) return;
    const old = this.#tex;
    this.#w = width;
    this.#h = height;
    this.#tex = this.#make();
    // A frame submitted before the resize still draws into the texture it named.
    kernelQueue.whenIdle(() => this.d.rhi.destroyTexture(old));
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
    if (layout === undefined || (this.#kind === 'depth' && this.format !== 'depth32float'))
      throw new TypeError(
        `${who}() cannot copy a ${this.format} texture back; it copies every uncompressed colour format and depth32float.`,
      );
    if (/snorm$/.test(this.format))
      throw new TypeError(
        `${who}(): WebGL2 renders into no ${this.format} texture, and reads none back.`,
      );
    const tex = this.#tex;
    return kernelQueue.run(() => this.d.rhi.readTexture(tex, layout.bytes));
  }

  destroy(): void {
    const t = this.#tex;
    kernelQueue.whenIdle(() => this.d.rhi.destroyTexture(t));
  }
}

/** The comparisons WebGPU names. Typed by CompareFunction: a new member is a compile error here. */
const COMPARISONS: Record<CompareFunction, true> = {
  never: true,
  less: true,
  equal: true,
  'less-equal': true,
  greater: true,
  'not-equal': true,
  'greater-equal': true,
  always: true,
};

/** A sampler of the WebGL2 tier. */
export class GlSamplerImpl implements Sampler {
  readonly handle: RhiSampler;
  constructor(
    private readonly rhi: RhiDevice,
    options: SamplerOptions | object | undefined,
  ) {
    const host = options === undefined ? undefined : rhi.fromNative('sampler', options);
    if (host !== undefined) {
      this.handle = host;
      return;
    }
    const o = (options ?? {}) as SamplerOptions;
    // A name a sampler gives that is not a comparison is refused in WebGPU's sentence.
    if (o.compare !== undefined && !(o.compare in COMPARISONS))
      throw new TypeError(
        `"${String(o.compare)}" is not a comparison; WebGPU's are less, less-equal, greater, greater-equal, equal, not-equal, always and never.`,
      );
    const filter = (o.filter ?? 'linear') === 'nearest' ? 'nearest' : 'linear';
    const address =
      o.address === 'repeat'
        ? 'repeat'
        : o.address === 'mirror'
          ? 'mirror-repeat'
          : 'clamp-to-edge';
    this.handle = rhi.createSampler({
      magFilter: filter,
      minFilter: filter,
      mipmapFilter: filter,
      addressModeU: address,
      addressModeV: address,
      addressModeW: address,
      ...(o.compare !== undefined ? { compare: o.compare } : {}),
    });
  }
  get sampler(): object {
    return this.rhi.toNative(this.handle);
  }
}

/** The depth formats whose constant and slope bias the WebGL2 tier takes (A1). A format joins
 *  this set when its measure shows the same thresholds as `depth24plus` on both tiers. */
const BIASED_FORMATS: readonly string[] = ['depth24plus', 'depth32float', 'depth24plus-stencil8'];

/** A depth bias the WebGL2 tier refuses before anything is built: a constant or slope bias on a
 *  format it has not measured, and a non-zero clamp without `EXT_polygon_offset_clamp` (A1). */
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
      `${prefix} sets depth.bias.clamp to ${b.clamp}; the WebGL2 tier takes a non-zero clamp only through EXT_polygon_offset_clamp, and this context lacks it.`,
    );
}

// ─── render pipelines ────────────────────────────────────────────────────────────────────────

interface BlendComponent {
  readonly srcFactor?: string;
  readonly dstFactor?: string;
  readonly operation?: string;
}

/** One binding a pipeline's programs read: its manifest binding, its number in the pipeline's
 *  bind group, and how it is bound. */
interface Slot {
  readonly binding: PackBinding;
  /** Its entry in the pipeline's bind group layout. */
  readonly index: number;
  readonly kind: 'block' | 'texture' | 'data';
  /** The sampler binding a texture is read with, by name and by its entry; none for none. */
  readonly sampler?: { readonly name: string; readonly index: number };
  readonly layout?: Layout;
}

/** A pipeline as the device made it: the bind group layout of its bindings, and the slots of the
 *  bindings its programs read, in the order of their units. */
interface Built {
  readonly pipeline: RhiRenderPipeline;
  readonly layout: RhiBindGroupLayout;
  readonly slots: readonly Slot[];
}

/** The program of a load on WebGL2: its manifest's vertex and fragment programs. */
export class GlRenderPrograms {
  readonly #pipelines = new Map<string, Promise<GlRenderPipelineImpl>>();
  /** The built objects of each normalised state without its blend constant, by `gpuKey`. */
  readonly #built = new Map<string, Promise<Built>>();
  readonly #bindings: ReadonlyMap<string, PackBinding>;

  constructor(
    readonly d: GlDrawing,
    readonly manifest: Pack,
  ) {
    this.#bindings = new Map(manifest.bindings.map((b) => [b.name, b]));
  }

  /** The pipeline of `state`. A state the tier refuses throws before anything is built. */
  render(state: RenderState): Promise<RenderPipeline> {
    const m = this.manifest;
    const vs = entryOf(m, state.vertex, 'vertex');
    const fs =
      state.fragment === null ? undefined : entryOf(m, state.fragment ?? undefined, 'fragment');
    // The checked state (proposal 0064, F1). Two levels, as on WebGPU: the wrapper by the whole
    // state, the built objects by the state without `blendConstant`.
    const plan = planOf(m, vs, fs, state);
    const hit = this.#pipelines.get(plan.key);
    if (hit !== undefined) return hit;
    let built = this.#built.get(plan.gpuKey);
    if (built === undefined) {
      built = this.#build(vs, fs, plan);
      this.#built.set(plan.gpuKey, built);
      // A pipeline the device refused is built again by the next state that asks for it.
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

  /** The pipeline of a normalised state: linked once for each `gpuKey`, so a state that differs
   *  only in its blend constant builds nothing. Every refusal throws before the device is asked. */
  #build(vs: PackEntry, fs: PackEntry | undefined, plan: RenderPlan): Promise<Built> {
    const m = this.manifest;
    const rhi = this.d.rhi;
    const v = stageOf(m.gl?.vertices?.[vs.name], vs);
    const f = fs === undefined ? undefined : stageOf(m.gl?.draws?.[fs.name], fs);
    const prefix = `The render pipeline of "${(fs ?? vs).name}"${at(fs ?? vs)}`;
    if (plan.multisample.count !== 1)
      throw new TypeError(
        `${prefix}: the WebGL2 tier draws with one sample; a multisampled target is not here.`,
      );
    if (plan.depth !== undefined)
      refuseBias(prefix, plan.depth, rhi.caps.hasFeature('EXT_polygon_offset_clamp'));
    // One combined texture uniform has one sampler state across both stages. A null
    // stage entry is load-only and imposes no state; it must not erase the other stage's.
    const samplers: Record<string, string | null> = { ...v.samplers };
    for (const [texture, sampler] of Object.entries(f?.samplers ?? {})) {
      const previous = samplers[texture];
      if (previous != null && sampler !== null && previous !== sampler)
        throw new TypeError(
          `${prefix}: it samples "${texture}" with "${previous}" and "${sampler}", and GLSL ES 3.00 fuses a texture with one sampler. Declare the texture twice, one binding per sampler.`,
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
        // A uniform block the driver found inactive is read by no program, so no draw binds it.
        const read = new Set(glReadBindings(pipeline)[0]);
        return { pipeline, layout, slots: slots.filter((s) => read.has(s.index)) };
      });
  }

  /** The bind group layout of the two programs' bindings: the uniform blocks by binding name, then
   *  the textures and the data textures each by name, then the samplers a texture is read with.
   *  The blocks take their binding points, and the textures and data textures their units, in
   *  this order. */
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
    // The samplers follow the textures and the data textures, one entry for each.
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

/** Refuse a state the WebGL2 tier cannot draw, in the sentences it has always used: a topology,
 *  a blend factor or a blend operation it has no name for, and targets blended or masked apart. */
function checkState(plan: RenderPlan, vs: PackEntry, fs: PackEntry | undefined): void {
  const where = `The render pipeline of "${(fs ?? vs).name}"`;
  if (GL_TOPOLOGY[plan.primitive.topology] === undefined)
    throw new TypeError(
      `${where}: "${String(plan.primitive.topology)}" is not a topology; WebGPU's are ${Object.keys(GL_TOPOLOGY).join(', ')}.`,
    );
  // WebGL2 has one blend state and one write mask for every target.
  const targets = plan.targets;
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

/** A draw as recorded: what it binds, ready to record into the pass when the pass runs, and the
 *  `Resident`s it reads, whose host copies the pass brings up to date first. */
interface DrawRun {
  readonly run: (pass: RhiRenderPass) => void;
  readonly residents: readonly ResidentArrayState[];
}

/** One binding of a draw: its entry in the pipeline's bind group, and what it binds, made when the
 *  pass runs. A buffer made for this draw alone goes into `made`, destroyed after the draw. */
interface Bind {
  readonly index: number;
  readonly resource: (made: RhiBuffer[]) => RhiBindResource;
}

/** The WebGL2 tier refuses to sample the depth attachment of the pass that writes it: WebGL2 raises
 *  INVALID_OPERATION for it, whatever the depth test and mask say. */
const SAMPLES_OWN_DEPTH =
  'The WebGL2 tier cannot sample the depth attachment of the pass that writes it; sample it in a later pass.';

/** A render pipeline of the WebGL2 tier. */
export class GlRenderPipelineImpl implements RenderPipeline {
  constructor(
    private readonly programs: GlRenderPrograms,
    private readonly vs: PackEntry,
    private readonly fs: PackEntry | undefined,
    private readonly built: Built,
    /** The blend constant the pipeline declares, which a draw sets. */
    private readonly blendConstant: readonly [number, number, number, number] | undefined,
    /** Whether the fragment writes `frag_depth`: WebGL2 refuses a depth range other than 0 to 1 for it. */
    private readonly writesFragDepth: boolean,
    /** The depth state of the plan: its stencil test is checked against the pass's depth format. */
    private readonly depth: RenderPlan['depth'],
    /** The reference the pipeline declares, or undefined: a draw uses it instead of the pass value. */
    private readonly stencilReference: number | undefined,
    /** The sample mask: bit 0 keeps or drops each draw. */
    private readonly sampleMask: number,
    /** What a draw writes: a read-only aspect of the pass refuses a pipeline that writes it. */
    private readonly writes: RenderPlan['writes'],
  ) {}

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
    // The pass must fit the pipeline's stencil (F6(a)), before anything is recorded.
    checkPassFit(entry.name, this.depth, this.writes, target);
    // The depth range the pass has now, at the record of this draw (proposal 0064, O6).
    const [near, far] = target.range;
    if (this.writesFragDepth && (near !== 0 || far !== 1))
      throw new TypeError(
        `pass.draw: the pipeline of "${this.fs!.name}" writes frag_depth, and the depth range is ${near} to ${far}; the WebGL2 tier refuses this range.`,
      );
    // R32: a declared constant is set for this draw, and the pass value again after a draw that set
    // one. The pass value is copied now: a later setBlendConstant does not change this draw.
    // The pass bookkeeping changes only after `#record` accepts the draw: a refused draw sets nothing.
    let blend: readonly [number, number, number, number] | undefined;
    if (this.blendConstant !== undefined) blend = this.blendConstant;
    else if (target.declared) blend = [...target.blend] as unknown as typeof blend;
    // The reference is copied now: a later setStencilReference does not change this draw.
    const reference =
      this.depth?.stencil === undefined
        ? undefined
        : (this.stencilReference ?? target.stencilReference);
    const run = this.#record(entry, bindings, geometry, blend, reference, target);
    // A mask whose bit 0 is 0 drops the draw. It was checked and recorded above, so no refusal
    // changes, and a dropped draw sets no blend constant: the bookkeeping stays as it was.
    if ((this.sampleMask & 1) === 0) return;
    target.declared = this.blendConstant !== undefined;
    target.add(run);
  }

  /** Check and take what the draw binds, now, as WebGPU's `writeBuffer` takes a plain value when
   *  the draw is recorded; the device's objects are made when the pass runs. `blend` is the blend
   *  constant the draw sets, and `reference` its stencil reference. */
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
          throw new TypeError('This Resident was destroyed; make a new one with array().');
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

  /** The vertex buffer of the draw, made when the pass runs; none for a vertex entry that reads no
   *  attribute. */
  #vertices(geometry: Geometry, entry: PackEntry): ((made: RhiBuffer[]) => RhiBuffer) | undefined {
    if (this.vs.vertex === undefined) return undefined;
    const v = geometry.vertices;
    if (v === undefined)
      throw new TypeError(
        `"${this.vs.name}"${at(this.vs)} reads vertex attributes; the geometry gives no vertices.`,
      );
    return bufferSource(this.programs.d, v, 'vertices', entry);
  }

  /** The index buffer and its format, made when the pass runs; none for a draw with no indices. */
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
        `"${entry.name}"${at(entry)}: the geometry's indices on WebGL2 take a typed array, a Resident or { buffer: WebGLBuffer, format }.`,
      );
    const format = host.format === 'uint32' ? 'uint32' : 'uint16';
    return () => ({ buffer, format });
  }
}

/** The element type of a storage binding's data texture, as the manifest gives its format. */
const dataElemOf = (b: PackBinding): 'f32' | 'i32' | 'u32' => {
  const format = b.dataTexture?.format ?? 'r32float';
  return format === 'r32uint' ? 'u32' : format === 'r32sint' ? 'i32' : 'f32';
};

/** A buffer of `bytes` made for one draw, destroyed after it. */
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

/** Where a draw's vertices or indices come from: a typed array, copied now and made into a buffer
 *  when the draw runs; a `Resident`, uploaded when its host copy has changed; or the host's
 *  buffer. */
function bufferSource(
  d: GlDrawing,
  v: unknown,
  field: 'vertices' | 'indices',
  entry: PackEntry,
): (made: RhiBuffer[]) => RhiBuffer {
  const usage = field === 'indices' ? 'index' : 'vertex';
  const state = residentState(v);
  if (state !== undefined) {
    const host = state.view();
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

/** The texture a binding names, taken now: the device's texture a resize after the draw does not
 *  move. */
export function textureOf(rhi: RhiDevice, v: unknown, where: string): RhiTexture {
  if (v instanceof GlTextureImpl) return v.handle;
  const host = typeof v === 'object' && v !== null ? rhi.fromNative('texture', v) : undefined;
  if (host !== undefined) return host;
  throw new TypeError(
    `${where} takes a Texture of the runtime or a WebGLTexture; got ${describe(v)}.`,
  );
}

export function samplerOf(rhi: RhiDevice, v: unknown, where: string): RhiSampler {
  if (v instanceof GlSamplerImpl) return v.handle;
  const host = typeof v === 'object' && v !== null ? rhi.fromNative('sampler', v) : undefined;
  if (host !== undefined) return host;
  throw new TypeError(
    `${where} takes a Sampler of the runtime or a WebGLSampler; got ${describe(v)}.`,
  );
}

// ─── passes ──────────────────────────────────────────────────────────────────────────────────

/** A render pass of a frame on WebGL2: the steps recorded into it, the state calls and the draws,
 *  in the order they were recorded (proposal 0064, PR-1). */
export class GlPass implements RenderPass, PassFit {
  /** The state calls and the draws, in the order they were recorded. */
  readonly steps: DrawRun[] = [];
  /** The pass value of the blend constant: `[0, 0, 0, 0]` at the pass start. */
  blend: readonly number[] = [0, 0, 0, 0];
  /** Whether the last draw recorded set a declared constant, and the pass value is not set since. */
  declared = false;
  /** The depth range at the record of the draw being recorded: `[0, 1]` at the pass start. */
  range: [number, number] = [0, 1];
  /** The pass value of the stencil reference: 0 at the pass start. */
  stencilReference = 0;

  constructor(
    private readonly info: {
      readonly rhi: RhiDevice;
      readonly width: number;
      readonly height: number;
      /** The format of the depth attachment, or undefined when the pass has none. */
      readonly depthFormat?: string;
      /** Whether the depth aspect is read-only. */
      readonly depthReadOnly: boolean;
      /** Whether the stencil aspect is read-only. */
      readonly stencilReadOnly: boolean;
      /** The depth attachment as the host named it. */
      readonly depthTarget?: object;
      /** The device's texture of the depth attachment, taken when the pass is recorded. */
      readonly depthTexture?: RhiTexture;
    },
  ) {}

  get raw(): object {
    throw new TypeError('A pass on WebGL2 has no GPURenderPassEncoder.');
  }

  /** The depth format of the pass, or undefined when it has no depth attachment. */
  get depthFormat(): string | undefined {
    return this.info.depthFormat;
  }

  /** Whether the depth aspect is read-only. */
  get depthReadOnly(): boolean {
    return this.info.depthReadOnly;
  }

  /** Whether the stencil aspect is read-only. */
  get stencilReadOnly(): boolean {
    return this.info.stencilReadOnly;
  }

  /** Whether a binding of a draw is the depth attachment of this pass: the `Texture` the host gave,
   *  or the `WebGLTexture` it holds. */
  readsOwnDepth(value: unknown, texture: RhiTexture): boolean {
    const own = this.info.depthTexture;
    return (
      value === this.info.depthTarget ||
      (own !== undefined && this.info.rhi.toNative(texture) === this.info.rhi.toNative(own))
    );
  }

  /** Set the pass value. No step is recorded: each stencil draw passes it to its own call. */
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
    // WebGL2's own limit, the smaller of `MAX_VIEWPORT_DIMS`, where WebGPU has
    // `maxTextureDimension2D`.
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

/** Record a pass: its attachments checked and taken now, its draws as `record` records them. The
 *  run records them into a pass of the device when the frame is submitted. */
export function recordPass(
  d: GlDrawing,
  targets: PassTargets,
  record: (pass: RenderPass) => void,
): () => Promise<void> {
  const rhi = d.rhi;
  // Check the targets first: a refused pass records nothing.
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
    // A Resident a WebGPU call wrote is read back first, and a zeroed one that no host copy holds
    // makes its zeros first: the draws read the host copy.
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
