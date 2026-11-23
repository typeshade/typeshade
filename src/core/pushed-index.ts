// Implements: Rule 8.23, the checked index of a grown array on the CPU tier (docs/language-design.md; traced in reqs/).
import type { CpuValue } from './cpu-runtime.js';
import { growingLimit, nextPushCount, pushedLength, startPushesAt } from './push-count.js';

export { nextPushCount, pushedLength, startPushesAt };

export class PastGrowth extends RangeError {
  readonly length: number;

  constructor(length: number) {
    super();
    this.length = length;
  }
}

function placed(xs: CpuValue[], index: number, limit: number, v: CpuValue | undefined): void {
  if (index >= limit - 1) throw new PastGrowth(index + 1);
  try {
    xs[index] = v as CpuValue;
  } catch (e) {
    throw e instanceof RangeError ? new PastGrowth(index + 1) : e;
  }
}

export function pushOnto(xs: CpuValue[], v: CpuValue): CpuValue {
  const n = pushedLength(xs);
  const limit = growingLimit(xs);
  if (limit !== undefined) {
    placed(xs, n, limit, v);
    startPushesAt(xs, n + 1);
    return (n + 1) as CpuValue;
  }
  if (n < xs.length) xs[n] = v;
  startPushesAt(xs, nextPushCount(n));
  return nextPushCount(n) as CpuValue;
}

function within(xs: CpuValue, k: CpuValue, site: CpuValue, room: number): number {
  const index = Number(k);
  const length = pushedLength(xs as unknown as object);
  if (index < 0 || index >= length + room)
    throw Object.assign(new RangeError(), { site: Number(site), index, length });
  return index;
}

export const PUSHED_BUILTINS: Readonly<Record<string, (...args: CpuValue[]) => CpuValue>> = {
  pushCount: (xs) => pushedLength(xs as unknown as object),
  pushedReadAt: (xs, k, site) => within(xs!, k!, site!, 0),
  pushedStoreAt: (xs, k, site) => {
    const index = within(xs!, k!, site!, 1);
    const array = xs as unknown as object;
    if (index === pushedLength(array)) {
      const limit = growingLimit(array);
      if (limit !== undefined) placed(xs as unknown as CpuValue[], index, limit, undefined);
      startPushesAt(array, index + 1);
    }
    return index;
  },
};
