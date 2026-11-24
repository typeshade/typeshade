import type { CpuValue } from './cpu-runtime.js';
import type { HostType, HostClasses } from './host-values/types.js';
import { toShader } from './host-values/to-shader.js';
export { toShader } from './host-values/to-shader.js';
export type { HostNumber, HostType, HostClasses } from './host-values/types.js';

export function fromShader(t: HostType, v: CpuValue): unknown {
  switch (t.k) {
    case 'num':
    case 'bool':
      return v;
    case 'key':
      return t.m[v as number];
    case 'void':
      return undefined;
    case 'vec':
    case 'mat': {
      if (!Array.isArray(v)) return Array.from(v as unknown as ArrayLike<number | boolean>);
      const out = new Array<unknown>(v.length);
      for (let i = 0; i < v.length; i++) out[i] = v[i];
      return out;
    }
    case 'arr':
      return Array.from(v as unknown as ArrayLike<CpuValue>, (x) => fromShader(t.e, x));
    case 'rec': {
      const xs = v as unknown as ArrayLike<CpuValue>;
      const out: Record<string, unknown> = {};
      t.m.forEach((name, i) => (out[name] = fromShader(t.e, xs[i]!)));
      return out;
    }
    case 'struct': {
      const o = v as unknown as Record<string, CpuValue>;
      const out: Record<string, unknown> = {};
      for (const [name, ft] of t.f) out[name] = fromShader(ft, o[name]!);
      return out;
    }
  }
}

export function fromShaderIn(t: HostType, v: CpuValue, classes: HostClasses): unknown {
  switch (t.k) {
    case 'arr':
      return Array.from(v as unknown as ArrayLike<CpuValue>, (x) => fromShaderIn(t.e, x, classes));
    case 'rec': {
      const xs = v as unknown as ArrayLike<CpuValue>;
      const out: Record<string, unknown> = {};
      t.m.forEach((name, i) => (out[name] = fromShaderIn(t.e, xs[i]!, classes)));
      return out;
    }
    case 'struct': {
      const proto = classes.get(t.s);
      const out = (proto === undefined ? {} : Object.create(proto)) as Record<string, unknown>;
      assignFields(out, t, v, classes);
      return out;
    }
    default:
      return fromShader(t, v);
  }
}

function assignFields(target: object, t: HostType, v: CpuValue, classes: HostClasses): void {
  if (t.k !== 'struct') return;
  const o = v as unknown as Record<string, CpuValue>;
  const out = target as Record<string, unknown>;
  for (const [name, ft] of t.f) out[name] = fromShaderIn(ft, o[name]!, classes);
}

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
