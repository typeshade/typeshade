import type { CpuValue } from './cpu-runtime.js';
import { treeIdentity, type TreeOp } from './kernel-tree.js';

export function identityValue(op: TreeOp, scalar: string, n: number): CpuValue {
  const one = treeIdentity(op, scalar) as number;
  return (n === 1 ? one : new Array<number>(n).fill(one)) as CpuValue;
}
