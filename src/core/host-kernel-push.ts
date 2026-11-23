import type { CpuValue } from './cpu-runtime.js';
import type {
  ComputeEntry,
  DispatchBatch,
  GpuBuffer,
  GpuDevice,
  Image,
  Layout,
} from './host-entry.js';
import { zeroedBuffer } from './host-entry.js';
import type { Folded, KernelFace } from './host-kernel.js';

type PushLoop = NonNullable<NonNullable<KernelFace['gpu']>['loops'][number]['push']>;
type Collection = NonNullable<NonNullable<KernelFace['gpu']>['collections']>[number];

export interface PushDispatch {
  readonly d: GpuDevice;
  readonly g: NonNullable<KernelFace['gpu']>;
  readonly j: number;
  readonly n: number;
  readonly loop: { readonly push: PushLoop };
  readonly entries: {
    readonly count?: ComputeEntry;
    readonly scan?: ComputeEntry;
    readonly loop: ComputeEntry;
  };
  readonly firstWorkgroups: [number, number, number];
  readonly boundValues: Record<string, unknown>;
  readonly images: Map<string, Image>;
  readonly onDevice: ReadonlyMap<string, GpuBuffer>;
  readonly batch: DispatchBatch;
  readonly word: boolean;
  readonly countOnly: boolean;
  readonly kept: GpuBuffer[];
  readonly folds: Folded[];
  readonly pending: (() => Promise<void>)[];
  readonly applyRecords: (c: Collection, count: number, dv: DataView) => void;
}

export async function dispatchPush(x: PushDispatch): Promise<void> {
  const { d, g, j, n, loop, entries, firstWorkgroups, boundValues, images, onDevice, batch } = x;
  const { word, kept, folds, pending, applyRecords } = x;
  const slots = zeroedBuffer(d, (n + 1) * 4);
  const bound = new Map(onDevice);
  bound.set(loop.push.binding.name, slots);
  const collected = (g.collections ?? []).filter((c) => c.loop === j);
  const recordBuffers = collected.map((c) => {
    const st = (c.records.layout as Layout & { k: 'a' }).st;
    const buffer = zeroedBuffer(d, Math.max(4, n * c.perIteration * st));
    bound.set(c.records.name, buffer);
    return { c, st, buffer };
  });
  const checked = { values: boundValues, images, samplers: new Map(), onDevice: bound };
  try {
    if (n > 0) await batch.add(entries.count!, checked, firstWorkgroups);
    await batch.add(entries.scan!, checked, [1, 1, 1]);
    if (n > 0 && !x.countOnly) await batch.add(entries.loop, checked, firstWorkgroups);
  } catch (e) {
    slots.destroy();
    throw e;
  }
  const total = g.tail !== undefined || !word ? batch.read(slots, n * 4, 4) : undefined;
  if (total === undefined) kept.push(slots);
  else {
    const free = (): void => slots.destroy();
    void total.then(free, free);
  }
  const records = recordBuffers.map((r) => {
    const read = batch.read(r.buffer, 0, Math.max(4, n * r.c.perIteration * r.st));
    const drop = (): void => r.buffer.destroy();
    void read.then(drop, drop);
    return { ...r, read };
  });
  let applied: Promise<void> | undefined;
  const apply = (): Promise<void> =>
    (applied ??= (async () => {
      const count = (await total!).getUint32(0, true);
      for (const r of records) applyRecords(r.c, count, await r.read);
    })());
  if (records.length > 0) pending.push(apply);
  folds.push(async () => {
    if (total === undefined) return [0 as CpuValue];
    await apply();
    return [(await total).getUint32(0, true) as CpuValue];
  });
}
