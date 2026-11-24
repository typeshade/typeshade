import type { ChainAccess, ChainArray, ChainCorpus } from '../random-ir.js';
import type { ModelGroup } from './model.js';
import type { PlannedGroup } from './types.js';

export interface Stencil {
  readonly at: number;
  readonly array: ChainArray;
}

export function scratchStencil(c: ChainCorpus, model: readonly ModelGroup[]): Stencil | undefined {
  for (let at = 1; at < model.length; at++) {
    if (model[at]!.because !== 'read' || model[at - 1]!.calls.length !== 1) continue;
    const [p, q] = [model[at - 1]!.calls[0]!, model[at]!.calls[0]!];
    const array = c.arrays.find((a) => {
      if (!a.scratch) return false;
      const users = c.calls.flatMap((call, j) =>
        call.access.some((x) => x.array === a.id) ? [j] : [],
      );
      const by = (j: number): ChainAccess => c.calls[j]!.access.find((x) => x.array === a.id)!;
      return (
        users.length === 2 &&
        users.every((j) => j === p || j === q) &&
        by(p).writes === 'i' &&
        by(q).reads === 'shifted' &&
        !by(p).measures &&
        !by(q).measures
      );
    });
    if (array !== undefined) return { at, array };
  }
  return undefined;
}

export function contractAgainstFacts(
  groups: readonly PlannedGroup[],
  stencil: Stencil,
): PlannedGroup[] {
  const { at, array } = stencil;
  return [
    ...groups.slice(0, at - 1),
    { calls: [groups[at - 1]!.calls[0]!, groups[at]!.calls[0]!], contracted: [array] },
    ...groups[at]!.calls.slice(1).map((j) => ({ calls: [j] })),
    ...groups.slice(at + 1),
  ];
}
