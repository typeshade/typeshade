// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { cpuOnly } from './host-face/made.js';
import { routeOf } from './lower/made-array/route.js';
import type { GrownTerm, MadeArray } from './lower/made-array/registry.js';
import { madeOf } from '../../core/kernel-made-face.js';
import { facesOf } from './growing-load.js';
import {
  ELEMENT_PROGRAMS,
  FOR_PROGRAMS,
  HEADER,
  NEST_PROGRAMS,
  WHILE_PROGRAMS,
} from './growing-programs/index.js';

const base = {
  param: 'out',
  count: 'out_length',
  shown: 'out',
  element: { kind: 'scalar', scalar: 'u32' },
  grown: true,
  prelude: [],
  form: 'const out: u32[] = []',
  lengthText: '',
} as unknown as MadeArray;

const term = {} as GrownTerm;
const deferred = { message: 'a message', node: {} as never };

describe('the route of a function that grows an array is decided in one place (change 0114, A12)', () => {
  it('gives Route 1 first: a capacity with no open loop stays as it was', () => {
    const route = routeOf({ ...base, capacity: [term] }, false);
    expect(route).toEqual({ made: { ...base, capacity: [term] } });
  });

  it('gives Route 2 next: countable gives counted, with or without a capacity', () => {
    for (const made of [
      { ...base, capacity: [term] },
      { ...base, open: true as const },
      { ...base, deferred },
    ]) {
      const route = routeOf(made as MadeArray, true);
      expect('made' in route && route.made.counted).toBe(true);
      expect('made' in route && route.made.growing).toBeUndefined();
      expect('made' in route && 'open' in route.made).toBe(false);
      expect('made' in route && 'deferred' in route.made).toBe(false);
    }
  });

  it('gives Route 3 last: an open function that is not countable grows', () => {
    const route = routeOf({ ...base, open: true }, false);
    expect(route).toMatchObject({ made: { growing: true } });
    expect('made' in route && route.made.counted).toBeUndefined();
    expect('made' in route && route.made.capacity).toBeUndefined();
  });

  it('keeps the refusal of a nested header that nothing can read, until Route 3 reads it', () => {
    expect(routeOf({ ...base, deferred, open: true }, false)).toEqual({ refused: deferred });
  });

  it('never sets counted and growing on one function, for every program of the forms', () => {
    const programs = [...WHILE_PROGRAMS, ...FOR_PROGRAMS, ...NEST_PROGRAMS, ...ELEMENT_PROGRAMS];
    const faces = facesOf(HEADER + programs.map((p) => p.source).join('\n'));
    const routes = programs.map((p) => {
      const made = madeOf(faces.get(p.name)!)!;
      expect(made.counted === true && made.growing === true).toBe(false);
      return made.growing === true ? 3 : made.counted === true ? 2 : 1;
    });
    expect(new Set(routes)).toEqual(new Set([1, 2, 3]));
  });

  it('takes Route 2, not Route 3, for the loops a count pass serves', () => {
    const faces = facesOf(HEADER + NEST_PROGRAMS.find((p) => p.name === 'inside')!.source);
    expect(madeOf(faces.get('inside')!)).toMatchObject({ counted: true });
    expect(madeOf(faces.get('inside')!)!.growing).toBeUndefined();
    expect(faces.get('inside')!.gpu).toBeDefined();
  });
});

describe('a loop that does not touch the grown array keeps Route 2 (change 0114, A12, Route 3)', () => {
  const twin = (inner: string): string =>
    `${HEADER}export function twin(n: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    ${inner}
    for (let j: u32 = 0; j < n; j++) {
      out.push(j);
    }
  }
  return out;
}`;

  it('keeps counted and the GPU plan with a while that pushes nothing', () => {
    const k = facesOf(twin('let spare: u32 = 0; while (spare < 3) { spare++; }')).get('twin')!;
    expect(madeOf(k)).toMatchObject({ counted: true });
    expect(madeOf(k)!.growing).toBeUndefined();
    expect(k.gpu).toBeDefined();
  });

  it('takes Route 3 when that while pushes', () => {
    const k = facesOf(twin('let spare: u32 = 0; while (spare < 3) { out.push(spare); spare++; }'));
    expect(madeOf(k.get('twin')!)).toMatchObject({ growing: true });
    expect(madeOf(k.get('twin')!)!.counted).toBeUndefined();
  });
});

describe('why a function has no GPU tier, in the order of the reasons (change 0114, A12, section 3.3)', () => {
  const face = (): Record<string, unknown> => ({
    gpu: {},
    gl: {},
    noWebgl2: 'webgl2 reason',
    noGpu: 'the proof',
    keep: 1,
  });

  it('names the reason of the proof before the other two', () => {
    const f = face();
    cpuOnly(f, ['the proof', 'the growing reason', 'the check reason']);
    expect(f).toEqual({ keep: 1, noGpu: 'the proof' });
  });

  it('names the growing reason when the proof gives none', () => {
    const f = face();
    cpuOnly(f, [undefined, 'the growing reason', 'the check reason']);
    expect(f).toEqual({ keep: 1, noGpu: 'the growing reason' });
  });

  it('names the check reason when it is the only one', () => {
    const f = face();
    cpuOnly(f, [undefined, undefined, 'the check reason']);
    expect(f).toEqual({ keep: 1, noGpu: 'the check reason' });
  });
});
