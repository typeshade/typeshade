// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { CpuValue } from '../cpu-runtime.js';
import type { KernelFace } from '../host-kernel.js';
import type { GeneratedCpu } from '../host-entry.js';
import type { KernelCapacityLoop, KernelMade } from '../kernel-made-face.js';
import { MOST_PUSHED } from '../push-count.js';

export { MOST_PUSHED };

const TYPED = { f32: 'Float32Array', i32: 'Int32Array', u32: 'Uint32Array' } as const;

function tripsOf(loop: KernelCapacityLoop, low: number, high: number): bigint {
  const span = high - low + (loop.inclusive ? 1 : 0);
  return span <= 0 ? 0n : BigInt(Math.ceil(span / loop.step));
}

export function exactCapacity(
  cpu: GeneratedCpu,
  made: KernelMade,
  values: readonly CpuValue[],
): number | bigint {
  const init = cpu.F['$initPrivates'];
  const read = (name: string): CpuValue => {
    init?.();
    return cpu.F[name]!(...values);
  };
  let total = 0n;
  for (const term of made.capacity ?? []) {
    if (term.when !== undefined && read(term.when) !== true) continue;
    let trips = 1n;
    for (const loop of [term, ...(term.inner ?? [])]) {
      if (trips === 0n) break;
      trips *= tripsOf(loop, Number(read(loop.low)), Number(read(loop.high)));
    }
    total += BigInt(term.pushes) * trips;
  }
  return total > BigInt(Number.MAX_SAFE_INTEGER) ? total : Number(total);
}

export class PastLimit extends RangeError {}

export function pastLimit(
  k: KernelFace,
  made: KernelMade,
  capacity: number | bigint | string,
  limit: string,
  exact = false,
): PastLimit {
  return new PastLimit(
    `${k.name}(): the array it grows with push, "${made.shown}", needs room for ` +
      `${String(capacity)} elements, ${exact ? 'the number its loops push' : 'the most its loops can push'}, ` +
      `and a length past ${limit} is not supported yet.`,
  );
}

export function countedTotal(k: KernelFace, made: KernelMade, total: number): number {
  if (total >= MOST_PUSHED)
    throw pastLimit(k, made, `${String(total)} or more`, String(MOST_PUSHED - 1), true);
  return total;
}

export function checkedCapacity(
  k: KernelFace,
  made: KernelMade,
  capacity: number | bigint,
): number {
  if (capacity > MOST_PUSHED) throw pastLimit(k, made, capacity, String(MOST_PUSHED));
  return Number(capacity);
}

export function allocatedFor<T>(
  k: KernelFace,
  made: KernelMade,
  capacity: number,
  allocate: () => T,
  exact = false,
): T {
  if (made.grown !== true) return allocate();
  try {
    return allocate();
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    const held = made.struct === undefined ? TYPED[made.array!] : 'Array';
    throw pastLimit(k, made, capacity, `what one ${held} holds on this host`, exact);
  }
}
