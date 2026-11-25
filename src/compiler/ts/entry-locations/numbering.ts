import type { FuncDecl } from '../../../core/ir/nodes.js';
import { hasRefusedIoParam } from '../lower/function-signature.js';

export type Param = FuncDecl['params'][number];

export const isAttributed = (p: Param): boolean =>
  p.type.kind === 'struct' ||
  p.builtin !== undefined ||
  p.location !== undefined ||
  hasRefusedIoParam(p);

export interface Demand {
  readonly location: number;
  readonly where: string;
}

export function take(held: Set<number>): number {
  let n = 0;
  while (held.has(n)) n++;
  held.add(n);
  return n;
}
