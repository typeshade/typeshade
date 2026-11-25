import { Emitted } from '../../core/emitted.js';
import { pinOverrides, glslOverrideNames } from '../../core/gl-overrides.js';
import type { Layout } from '../../core/host-entry.js';
import {
  layoutFromPack,
  type Pack,
  type PackBinding,
  type PackEntry,
  type PackGlDraw,
  type PackGlVertex,
} from '../../core/manifest-types.js';
import {
  at,
  entryOf,
  planOf,
  type RenderPipeline,
  type RenderPlan,
  type RenderState,
} from '../program.js';
import { STAGE, type RhiBindLayoutEntry, type RhiColorTarget } from '../../rhi/rhi.js';
import { glReadBindings } from '../../rhi/webgl2.js';
import type { GlDrawing } from './drawing.js';
import type { Slot, Built } from './pipeline-types.js';
import { checkState } from './state-check.js';
import { refuseBias } from './depth-bias.js';
import { GlRenderPipelineImpl } from './render-pipeline.js';

export class GlRenderPrograms {
  readonly #pipelines = new Map<string, Promise<GlRenderPipelineImpl>>();
  readonly #built = new Map<string, Promise<Built>>();
  readonly #bindings: ReadonlyMap<string, Emitted<PackBinding>>;

  constructor(
    readonly d: GlDrawing,
    readonly manifest: Pack,
  ) {
    this.#bindings = new Map(manifest.bindings.map((b) => [b.name, new Emitted(b)]));
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
          this.d,
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
      slots.push({ binding: b.record, index, kind: 'block', ...layoutOfBinding(b.record) });
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
        name: b.glslName,
        label: name,
        ...(paired !== undefined ? { samplerBinding: paired.index } : {}),
        texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
      });
      slots.push({
        binding: b.record,
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
        name: b.glslName,
        label: name,
        buffer: { type: 'read-only-storage' },
      });
      slots.push({ binding: b.record, index, kind: 'data', ...layoutOfBinding(b.record) });
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
