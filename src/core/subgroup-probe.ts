// ═══ The subgroup probe: a known-answer test that selects the subgroup variant (change 0119) ═══
//
// A kernel function's WGSL may carry a second text in which each subgroup folds first with the
// subgroup functions (`KernelFace.gpu.wgslSubgroup`, `core/passes/kernel-lower.ts`). The runtime
// dispatches it only on a device that has the `subgroups` feature and that passes this probe: one
// dispatch of one workgroup of 256 lanes, whose entry folds a reduction and a scatter in the
// exact shape the variant emits, and writes what it saw of its subgroups. The host compares the
// folds with their known answers; a device whose driver folds wrongly, or whose subgroup size or
// count is not a size or a count, gets no variant and runs the tree. The observation also records
// the subgroup size one workgroup saw, how many subgroups it had, and whether a subgroup's lanes
// were consecutive `local_invocation_index` values, which the device report shows.
//
// The probe is fixed WGSL: it belongs to the runtime, not to a compiler build, and this module
// imports no compiler. Its `subgroup_uniformity` rule is off for the same reason the variant's
// scatter entry turns it off: Tint (Chrome for Testing 153) does not read a subgroup function's
// result as uniform, though every lane of a subgroup receives the same `subgroupAny`.

import type { GpuBuffer, GpuDevice } from './host-entry.js';

/** The lanes of the probe's one workgroup. */
export const PROBE_LANES = 256;
/** The words the probe writes: `subgroup_id` per lane, `subgroup_invocation_id` per lane,
 *  `subgroup_size`, `num_subgroups`, the reduction's fold, then eight bins of the scatter's. */
export const PROBE_WORDS = PROBE_LANES * 2 + 2 + 1 + 8;
const AT_SIZE = PROBE_LANES * 2;
const AT_COUNT = AT_SIZE + 1;
const AT_SUM = AT_SIZE + 2;
const AT_BINS = AT_SIZE + 3;

/** The lane's value in the probe: a hash of its index, so a wrong fold is unlikely to equal the
 *  answer by chance. The same expression as the WGSL's. */
export const probeValue = (lane: number): number => Math.imul(lane, 2654435761) >>> 20;

/** The known answers: the sum of every lane's value, and the sum of the lanes' indices in each
 *  of eight bins keyed by the value's low three bits. */
export function probeExpectation(): { readonly sum: number; readonly bins: readonly number[] } {
  let sum = 0;
  const bins = new Array<number>(8).fill(0);
  for (let lane = 0; lane < PROBE_LANES; lane++) {
    const v = probeValue(lane);
    sum = (sum + v) >>> 0;
    bins[v & 7] = (bins[v & 7]! + lane) >>> 0;
  }
  return { sum, bins };
}

export const SUBGROUP_PROBE_WGSL = `enable subgroups;

@group(0) @binding(0) var<storage, read_write> out: array<atomic<u32>>;

var<workgroup> tile: array<u32, ${PROBE_LANES}>;

@compute @workgroup_size(${PROBE_LANES}) @diagnostic(off, subgroup_uniformity)
fn probe(@builtin(local_invocation_index) lid: u32, @builtin(subgroup_invocation_id) sgi: u32, @builtin(subgroup_size) sgs: u32, @builtin(subgroup_id) sgid: u32, @builtin(num_subgroups) nsg: u32) {
  atomicStore(&out[lid], sgid);
  atomicStore(&out[${PROBE_LANES}u + lid], sgi);
  if ((lid == 0u)) {
    atomicStore(&out[${AT_SIZE}u], sgs);
    atomicStore(&out[${AT_COUNT}u], nsg);
  }
  let v = ((lid * 2654435761u) >> 20u);
  let f = subgroupAdd(v);
  if ((sgi == 0u)) {
    tile[sgid] = f;
  }
  workgroupBarrier();
  if ((lid == 0u)) {
    var acc: u32 = 0u;
    for (var j: u32 = 0u; (j < nsg); j = (j + 1u)) {
      acc = (acc + tile[j]);
    }
    atomicStore(&out[${AT_SUM}u], acc);
  }
  var k: u32 = (v & 7u);
  var val: u32 = lid;
  var p: bool = true;
  for (var j: u32 = 0u; (j < 128u); j = (j + 1u)) {
    if (subgroupAny(p)) {
      let key = subgroupMin(select(4294967295u, k, p));
      let m = (p && (k == key));
      let s = subgroupAdd(select(0u, val, m));
      if (subgroupElect()) {
        atomicAdd(&out[${AT_BINS}u + key], s);
      }
      p = select(p, false, m);
    } else {
      break;
    }
  }
}
`;

/** What one workgroup of the probe saw of its subgroups, on a device that folded right. */
export interface SubgroupObservation {
  /** The adapter's `subgroupMinSize` and `subgroupMaxSize`, where the browser reports them. */
  readonly minSize: number | null;
  readonly maxSize: number | null;
  /** The `subgroup_size` and `num_subgroups` one workgroup of 256 lanes saw. */
  readonly size: number;
  readonly numSubgroups: number;
  /** Whether lane `i` was lane `i % size` of subgroup `i / size`. */
  readonly consecutive: boolean;
}

/** Reads the probe's words into the observation, or null where they are not a passing probe: a
 *  size or a count that is not one, a fold that is not its known answer. */
export function readSubgroupProbe(
  words: ArrayLike<number>,
  adapter: { readonly subgroupMinSize?: number; readonly subgroupMaxSize?: number } = {},
): SubgroupObservation | null {
  if (words.length < PROBE_WORDS) return null;
  const size = words[AT_SIZE]!;
  const numSubgroups = words[AT_COUNT]!;
  if (size < 1 || numSubgroups < 1 || size * numSubgroups < PROBE_LANES) return null;
  const { sum, bins } = probeExpectation();
  if (words[AT_SUM] !== sum) return null;
  for (let b = 0; b < 8; b++) if (words[AT_BINS + b] !== bins[b]) return null;
  let consecutive = true;
  for (let lane = 0; lane < PROBE_LANES; lane++)
    if (words[lane] !== Math.floor(lane / size) || words[PROBE_LANES + lane] !== lane % size)
      consecutive = false;
  return {
    minSize: typeof adapter.subgroupMinSize === 'number' ? adapter.subgroupMinSize : null,
    maxSize: typeof adapter.subgroupMaxSize === 'number' ? adapter.subgroupMaxSize : null,
    size,
    numSubgroups,
    consecutive,
  };
}

const observations = new WeakMap<object, SubgroupObservation | null>();

/** The observation the probe made on `device`, when it ran there: null where it has not run, or
 *  where the device failed it. */
export function subgroupObservationOf(device: object): SubgroupObservation | null {
  return observations.get(device) ?? null;
}

/** Whether `device` has the `subgroups` feature, so that the probe can run on it. */
export function hasSubgroups(device: GpuDevice): boolean {
  return device.features?.has('subgroups') === true;
}

/** `GPUBufferUsage` and `GPUMapMode` bits, which the WebGPU specification fixes. */
const MAP_READ = 0x0001;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const STORAGE = 0x0080;
const READ_MODE = 0x0001;

/**
 * Runs the probe once on `device` and records what it saw. Returns the observation, or null when
 * the device lacks the feature, refuses the probe, or folds wrongly; a refusal is never thrown,
 * since the tree text runs either way. The result is cached per device, so a second owner of the
 * same device asks nothing of it.
 */
export async function probeSubgroups(device: GpuDevice): Promise<SubgroupObservation | null> {
  const cached = observations.get(device);
  if (cached !== undefined) return cached;
  let observation: SubgroupObservation | null = null;
  if (hasSubgroups(device)) {
    try {
      observation = await run(device);
    } catch {
      observation = null;
    }
  }
  observations.set(device, observation);
  return observation;
}

async function run(device: GpuDevice): Promise<SubgroupObservation | null> {
  const bytes = PROBE_WORDS * 4;
  const out = device.createBuffer({ size: bytes, usage: STORAGE | COPY_SRC | COPY_DST });
  const read = device.createBuffer({ size: bytes, usage: MAP_READ | COPY_DST });
  try {
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code: SUBGROUP_PROBE_WGSL });
    const descriptor = { layout: 'auto' as const, compute: { module, entryPoint: 'probe' } };
    const pipeline =
      device.createComputePipelineAsync !== undefined
        ? await device.createComputePipelineAsync(descriptor)
        : device.createComputePipeline(descriptor);
    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: out } }],
    });
    device.queue.writeBuffer(out, 0, new ArrayBuffer(bytes));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(1, 1, 1);
    pass.end();
    encoder.copyBufferToBuffer(out, 0, read, 0, bytes);
    device.queue.submit([encoder.finish()]);
    const error = await device.popErrorScope();
    if (error !== null) return null;
    await read.mapAsync(READ_MODE);
    const words = new Uint32Array(read.getMappedRange().slice(0));
    read.unmap();
    return readSubgroupProbe(words, adapterInfoOf(device));
  } finally {
    out.destroy();
    read.destroy();
  }
}

/** The adapter's subgroup size range, where the browser puts `adapterInfo` on the device. */
function adapterInfoOf(device: GpuDevice): {
  readonly subgroupMinSize?: number;
  readonly subgroupMaxSize?: number;
} {
  const info = (device as { adapterInfo?: unknown }).adapterInfo;
  return typeof info === 'object' && info !== null
    ? (info as { subgroupMinSize?: number; subgroupMaxSize?: number })
    : {};
}

/** The buffer the probe reads back, as this module needs it. */
export type ProbeBuffer = GpuBuffer;
