import { describe } from '../../core/host-entry.js';
import type { PackEntry } from '../../core/manifest-types.js';
import {
  decide,
  layoutKind,
  residentState,
  tentatively,
  type ResidentArrayState,
} from '../../core/resident.js';
import { hostSite } from '../../core/submission.js';
import {
  at,
  checkPassFit,
  type Bindings,
  type Geometry,
  type RenderPipeline,
  type RenderPlan,
} from '../program.js';
import type { RhiBindResource, RhiBuffer, RhiRenderPass } from '../../rhi/rhi.js';
import type { GlDrawing } from './drawing.js';
import type { Built, DrawRun } from './pipeline-types.js';
import { textureOf, samplerOf } from './draw-handles.js';
import { GlPass } from './pass.js';
import { dataElemOf, fresh, bufferSource, packed } from './buffer-data.js';

interface Bind {
  readonly index: number;
  readonly resource: (made: RhiBuffer[]) => RhiBindResource;
}

const SAMPLES_OWN_DEPTH =
  'Sampling the depth attachment of the pass that writes it is not supported yet on the WebGL2 tier (Rule 11.11); sample it in a later pass.';

export class GlRenderPipelineImpl implements RenderPipeline {
  constructor(
    private readonly d: GlDrawing,
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
    const d = this.d;
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
    return bufferSource(this.d, v, 'vertices', entry);
  }

  #indices(
    geometry: Geometry,
    entry: PackEntry,
  ): ((made: RhiBuffer[]) => { buffer: RhiBuffer; format: 'uint16' | 'uint32' }) | undefined {
    const idx = geometry.indices;
    if (idx === undefined) return undefined;
    const d = this.d;
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
