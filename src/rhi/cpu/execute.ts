import {
  rasterizeTriangle,
  type RasterState,
  type RasterVertex,
  type Varying,
} from '../cpu-raster.js';
import type { CpuBuffer } from './buffer.js';
import type { CpuTexture } from './canvas.js';
import type { CpuBindGroup } from './handles.js';
import { argOf, fieldsOf, type Stage } from './stage.js';
import { boundOf, bindTo, writeBack } from './binding.js';
import type { CpuComputePipeline, CpuRenderPipeline } from './pipelines.js';
import { attributeFormat, attributeValue, type Attribute } from './vertex-fetch.js';
import { writeTexel } from './texel.js';

function invoke(stage: Stage, args: readonly unknown[], invocation?: readonly number[]): unknown {
  const F = stage.code.F as Readonly<Record<string, ((...a: unknown[]) => unknown) | undefined>>;
  F['$initPrivates']?.();
  stage.code.$.invocation = invocation;
  return F[stage.entry.fn]!(...args);
}

const fresh = (v: unknown): unknown =>
  v === undefined ? v : (JSON.parse(JSON.stringify(v)) as unknown);

export function dispatch(
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

export interface PassState {
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

export function draw(
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
