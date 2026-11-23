// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { CpuValue } from '../cpu-runtime.js';
import type { KernelFace } from '../host-kernel.js';
import type { GeneratedCpu } from '../host-entry.js';
import type { KernelCapacityTerm, KernelMade } from '../kernel-made-face.js';

export const MOST_PUSHED = 4294967295;

const TYPED = { f32: 'Float32Array', i32: 'Int32Array', u32: 'Uint32Array' } as const;

function tripsOf(term: KernelCapacityTerm, low: number, high: number): number {
  const span = high - low + (term.inclusive ? 1 : 0);
  return span <= 0 ? 0 : Math.ceil(span / term.step);
}

export function exactCapacity(
  cpu: GeneratedCpu,
  made: KernelMade,
  values: readonly CpuValue[],
): number {
  const init = cpu.F['$initPrivates'];
  let total = 0;
  for (const term of made.capacity ?? []) {
    init?.();
    const low = Number(cpu.F[term.low]!(...values));
    init?.();
    const high = Number(cpu.F[term.high]!(...values));
    total += term.pushes * tripsOf(term, low, high);
  }
  return total;
}

function pastLimit(k: KernelFace, made: KernelMade, capacity: number, limit: string): RangeError {
  return new RangeError(
    `${k.name}(): the array it grows with push, "${made.shown}", needs room for ` +
      `${String(capacity)} elements, the most its loops can push, and a length past ${limit} ` +
      `is not supported yet.`,
  );
}

export function checkedCapacity(k: KernelFace, made: KernelMade, capacity: number): number {
  if (capacity > MOST_PUSHED) throw pastLimit(k, made, capacity, String(MOST_PUSHED));
  return capacity;
}

export function allocatedFor<T>(
  k: KernelFace,
  made: KernelMade,
  capacity: number,
  allocate: () => T,
): T {
  if (made.grown !== true) return allocate();
  try {
    return allocate();
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    const held = made.struct === undefined ? TYPED[made.array!] : 'Array';
    throw pastLimit(k, made, capacity, `what one ${held} holds on this host`);
  }
}
