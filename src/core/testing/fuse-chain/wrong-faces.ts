import type { Lowered } from './types.js';

export function readsAtCounter(low: Lowered): Lowered {
  const fuse = low.face.fuse!;
  return {
    ...low,
    face: {
      ...low.face,
      fuse: {
        ...fuse,
        facts: fuse.facts.map((f) => ({
          ...f,
          arrays: f.arrays.map((a) =>
            a.access === 'read' ? { param: a.param, access: a.access, atI: true } : a,
          ),
        })),
      },
    },
  };
}

export function forgetsReduction(low: Lowered): Lowered {
  const fuse = low.face.fuse!;
  return {
    ...low,
    face: {
      ...low.face,
      fuse: {
        ...fuse,
        facts: fuse.facts.map(({ fold: _fold, ...f }) => ({ ...f, reduces: false })),
      },
    },
  };
}

export function forgetsLength(low: Lowered): Lowered {
  const fuse = low.face.fuse!;
  return {
    ...low,
    face: {
      ...low.face,
      fuse: { ...fuse, facts: fuse.facts.map(({ bare: _bare, ...f }) => f) },
    },
  };
}
