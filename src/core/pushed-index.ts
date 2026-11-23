import type { CpuValue } from './cpu-runtime.js';
import { pushedLength, startPushesAt } from './push-count.js';

export { pushedLength, startPushesAt };

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
    if (index === pushedLength(array)) startPushesAt(array, index + 1);
    return index;
  },
};
