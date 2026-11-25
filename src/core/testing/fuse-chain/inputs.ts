import type { CpuValue } from '../../cpu-runtime.js';
import type { ShaderType } from '../../ir/index.js';
import { mulberry32, type ChainArray, type ChainCall, type ChainCorpus } from '../random-ir.js';

export interface Sizes {
  readonly n: number;
  readonly m: number;
}

export const lengthOf = (a: ChainArray, s: Sizes): number => s[a.length.of] * a.length.times;

export function tripsOf(call: ChainCall, s: Sizes): number {
  const length = s[call.over];
  return length <= call.start ? 0 : Math.ceil((length - call.start) / call.step);
}

export type ScalarOf = (
  kind: 'f32' | 'i32' | 'u32',
  rnd: () => number,
  boundary: boolean,
) => number;

export interface Inputs {
  readonly arrays: ReadonlyMap<string, readonly CpuValue[]>;
  readonly scalars: readonly (readonly CpuValue[])[];
}

function valueOf(
  t: ShaderType,
  c: ChainCorpus,
  rnd: () => number,
  boundary: boolean,
  scalarOf: ScalarOf,
): CpuValue {
  if (t.kind === 'scalar') return scalarOf(t.scalar as 'f32', rnd, boundary);
  if (t.kind === 'vec')
    return Array.from({ length: t.n }, () => scalarOf(t.elem as 'f32', rnd, boundary));
  if (t.kind === 'struct')
    return Object.fromEntries(
      c.module.structs
        .find((s) => s.name === t.name)!
        .fields.map((f) => [f.name, valueOf(f.type, c, rnd, boundary, scalarOf)]),
    );
  throw new Error(`no generated value of ${t.kind}`);
}

export function inputsOf(c: ChainCorpus, s: Sizes, variant: number, scalarOf: ScalarOf): Inputs {
  const rnd = mulberry32(c.seed * 7919 + s.n * 31 + s.m * 5 + variant);
  const boundary = variant % 2 === 1;
  const arrays = new Map<string, readonly CpuValue[]>();
  for (const a of c.arrays)
    arrays.set(
      a.id,
      Array.from({ length: lengthOf(a, s) }, () =>
        a.scratch ? (0 as CpuValue) : valueOf(a.elem, c, rnd, boundary, scalarOf),
      ),
    );
  const scalars = c.calls.map((call) =>
    call.args.flatMap((a) =>
      'scalar' in a ? [valueOf(a.scalar, c, rnd, boundary, scalarOf)] : [],
    ),
  );
  return { arrays, scalars };
}

export function withScratchContents(
  c: ChainCorpus,
  inputs: Inputs,
  variant: number,
  scalarOf: ScalarOf,
): Inputs {
  const rnd = mulberry32(c.seed * 104729 + variant);
  const arrays = new Map(inputs.arrays);
  for (const a of c.arrays)
    if (a.scratch)
      arrays.set(
        a.id,
        Array.from({ length: inputs.arrays.get(a.id)!.length }, () =>
          valueOf(a.elem, c, rnd, false, scalarOf),
        ),
      );
  return { arrays, scalars: inputs.scalars };
}

export function callArgs(
  c: ChainCorpus,
  j: number,
  inputs: Inputs,
  store?: ReadonlyMap<string, CpuValue>,
): CpuValue[] {
  let next = 0;
  return c.calls[j]!.args.map((a) =>
    'array' in a
      ? (store?.get(a.array) ?? (inputs.arrays.get(a.array) as unknown as CpuValue))
      : inputs.scalars[j]![next++]!,
  );
}
