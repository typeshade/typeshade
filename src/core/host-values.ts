// Implements: Rule 8.21

import type { CpuValue } from './cpu-runtime.js';
import type { HostType, HostClasses } from './host-values/types.js';
import { toShader } from './host-values/to-shader.js';
import { fromShader, fromShaderIn, assignFields } from './host-values/from-shader.js';
export { fromShader, fromShaderIn } from './host-values/from-shader.js';
export { toShader } from './host-values/to-shader.js';
export type { HostNumber, HostType, HostClasses } from './host-values/types.js';

interface ClassCpu {
  readonly F: Readonly<Record<string, ((...a: CpuValue[]) => CpuValue) | undefined>>;
  readonly $: { readonly inout: { readonly values: readonly CpuValue[] } };
}

export interface MemberSpec {
  readonly n: string;
  readonly fn?: string;
  readonly p: readonly (readonly [string, HostType])[];
  readonly r?: HostType;
  readonly o?: HostType;
  readonly c?: 1;
  readonly w?: 1;
  readonly s?: 1;
  readonly z?: CpuValue;
}

export function callMember(
  m: ClassCpu,
  classes: HostClasses,
  spec: MemberSpec,
  self: object | undefined,
  args: ArrayLike<unknown>,
): unknown {
  arity(spec.n, spec.p.length, args.length);
  const values: CpuValue[] = [];
  if (spec.o !== undefined && spec.c === undefined)
    values.push(toShader(spec.n, 'this', spec.o, self));
  for (let i = 0; i < spec.p.length; i++) {
    const [name, t] = spec.p[i]!;
    values.push(toShader(spec.n, name, t, args[i]));
  }
  m.F['$initPrivates']?.();
  const result = spec.fn === undefined ? spec.z! : m.F[spec.fn]!(...values);
  if (spec.c !== undefined) {
    assignFields(self!, spec.o!, result, classes);
    return undefined;
  }
  if (spec.w !== undefined) assignFields(self!, spec.o!, m.$.inout.values[0]!, classes);
  if (spec.s !== undefined) return self;
  return spec.r === undefined ? undefined : fromShaderIn(spec.r, result, classes);
}

export function constantOf(t: HostType, v: CpuValue): unknown {
  const deepFreeze = (x: unknown): unknown => {
    if (typeof x === 'object' && x !== null) {
      for (const k of Object.keys(x)) deepFreeze((x as Record<string, unknown>)[k]);
      Object.freeze(x);
    }
    return x;
  };
  return deepFreeze(fromShader(t, v));
}

export function arity(fn: string, expected: number, got: number): void {
  if (got !== expected)
    throw new TypeError(
      `${fn}() takes ${expected} argument${expected === 1 ? '' : 's'}; got ${got}.`,
    );
}

export function notCallable(name: string, reason: string): () => never {
  return () => {
    throw new TypeError(`${name} cannot be called from host code: ${reason}`);
  };
}
