// ═══ Host values: what a host call passes and gets back (Rule 8.21) ═══
//
// A host file that imports a `.shade.ts` calls its functions with plain JavaScript values, and
// the CPU tier (Rule 11.7) runs on the representation the oracle already has (`cpu-runtime.ts`):
// a scalar is a `number` or a `boolean`, a vector an array of its components, a matrix a flat
// column-major array, an `array<T, N>` an array, and a struct an object of its fields. This file
// is the boundary between the two. Each argument is checked against the parameter's type and
// copied into a fresh value, and each result is copied out again, so the call neither reads a
// value that does not fit nor hands back one that aliases an argument (Rule 8.8).
//
// It is runtime code: a module the Vite plugin generates imports it through `typeshade/runtime`,
// with the type of every parameter written into that module as a `HostType` literal. It imports
// nothing, so what an application ships for it is this file.

import type { CpuValue } from './cpu-runtime.js';

/** A scalar a host value carries as a `number`. */
export type HostNumber = 'f32' | 'f64' | 'i32' | 'u32';

/** The type of one parameter, one result, one field or one constant of a host call, as the
 *  generated module writes it. `s` is the TypeShade spelling, which a refusal names. */
export type HostType =
  | { readonly k: 'num'; readonly t: HostNumber; readonly s: string }
  | { readonly k: 'bool'; readonly s: string }
  | { readonly k: 'void'; readonly s: string }
  | {
      readonly k: 'vec';
      readonly n: number;
      readonly e: HostNumber | 'bool';
      readonly s: string;
    }
  | {
      readonly k: 'mat';
      readonly c: number;
      readonly r: number;
      readonly e: 'f32' | 'f64';
      readonly s: string;
    }
  | { readonly k: 'arr'; readonly n: number; readonly e: HostType; readonly s: string }
  | {
      readonly k: 'struct';
      readonly f: readonly (readonly [string, HostType])[];
      readonly s: string;
    };

const RANGE: Record<'i32' | 'u32', readonly [number, number]> = {
  i32: [-0x80000000, 0x7fffffff],
  u32: [0, 0xffffffff],
};

/** Why `v` is not a number of kind `t`, or undefined when it is one. */
function numberProblem(t: HostNumber, v: unknown): string | undefined {
  if (typeof v !== 'number') return `got ${describe(v)}`;
  if (t === 'f32' || t === 'f64') return undefined;
  const [lo, hi] = RANGE[t];
  if (!Number.isInteger(v) || v < lo || v > hi)
    return `got ${v}, which is not a whole number in the ${t} range`;
  return undefined;
}

/** A short description of a value that did not fit, for the refusal. */
function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `an array of length ${v.length}`;
  if (ArrayBuffer.isView(v)) return `a ${v.constructor.name}`;
  if (typeof v === 'object') return 'an object';
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`;
  return `${typeof v} ${String(v)}`;
}

/** An `ArrayLike` of length `n`, or why `v` is not one. */
function listOf(v: unknown, n: number): ArrayLike<unknown> | string {
  if (typeof v !== 'object' || v === null || typeof (v as { length?: unknown }).length !== 'number')
    return `got ${describe(v)}`;
  const xs = v as ArrayLike<unknown>;
  if (xs.length !== n)
    return Array.isArray(v) ? `got ${describe(v)}` : `got ${describe(v)} of length ${xs.length}`;
  return xs;
}

/** A refusal: thrown out of {@link toShader} and unwound to the call, which names the function
 *  and the parameter. `path` is where inside the value it went wrong (`.pos[1]`). */
class Misfit {
  constructor(
    readonly path: string,
    readonly problem: string,
  ) {}
}

/** The `n` elements of `xs`, the components of a vector or a matrix, as a new array of scalars
 *  of kind `e`: each is read once, in order, and the first that does not fit is refused, with the
 *  reason the descent gives for a scalar. The kind is decided once, before the loop (#410), and
 *  the loops differ in nothing else, so what is read of `xs` is the same for every kind, and an
 *  accessor that changes `xs` as it is read, or a `Proxy` that reports its reads, is served as
 *  it was. */
function copyList(
  xs: ArrayLike<unknown>,
  n: number,
  e: HostNumber | 'bool',
  path: string,
): CpuValue {
  const out = new Array<number | boolean>(n);
  if (e === 'f32') {
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      if (typeof x !== 'number') throw new Misfit(`${path}[${i}]`, `got ${describe(x)}`);
      out[i] = Math.fround(x);
    }
  } else if (e === 'bool') {
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      if (typeof x !== 'boolean') throw new Misfit(`${path}[${i}]`, `got ${describe(x)}`);
      out[i] = x;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      const p = numberProblem(e, x);
      if (p !== undefined) throw new Misfit(`${path}[${i}]`, p);
      out[i] = x as number;
    }
  }
  return out as CpuValue;
}

function convertIn(t: HostType, v: unknown, path: string): CpuValue {
  switch (t.k) {
    case 'num': {
      const p = numberProblem(t.t, v);
      if (p !== undefined) throw new Misfit(path, p);
      // A buffer write of an `f32` rounds; so does the argument (Rule 8.21).
      return t.t === 'f32' ? Math.fround(v as number) : (v as number);
    }
    case 'bool':
      if (typeof v !== 'boolean') throw new Misfit(path, `got ${describe(v)}`);
      return v;
    case 'void':
      throw new Misfit(path, 'void takes no value');
    case 'vec':
    case 'mat': {
      const n = t.k === 'vec' ? t.n : t.c * t.r;
      const xs = listOf(v, n);
      if (typeof xs === 'string') throw new Misfit(path, xs);
      return copyList(xs, n, t.e, path);
    }
    case 'arr': {
      const xs = listOf(v, t.n);
      if (typeof xs === 'string') throw new Misfit(path, xs);
      const out: CpuValue[] = [];
      for (let i = 0; i < t.n; i++) out.push(convertIn(t.e, xs[i], `${path}[${i}]`));
      return out as unknown as CpuValue;
    }
    case 'struct': {
      if (typeof v !== 'object' || v === null || Array.isArray(v))
        throw new Misfit(path, `got ${describe(v)}`);
      const o = v as Record<string, unknown>;
      const out: Record<string, CpuValue> = {};
      for (const [name, ft] of t.f) {
        if (!(name in o)) throw new Misfit(`${path}.${name}`, 'the field is missing');
        out[name] = convertIn(ft, o[name], `${path}.${name}`);
      }
      return out as unknown as CpuValue;
    }
  }
}

/** Whether `x` is a scalar of kind `e` as {@link convertIn} takes one: a boolean for `bool`, a
 *  number for a float, a whole number in range for an integer. */
function scalarFits(e: HostNumber | 'bool', x: unknown): boolean {
  if (e === 'bool') return typeof x === 'boolean';
  if (typeof x !== 'number') return false;
  if (e === 'f32' || e === 'f64') return true;
  const [lo, hi] = RANGE[e];
  return Number.isInteger(x) && x >= lo && x <= hi;
}

/** {@link convertIn}'s value for a scalar that fits, computed without its descent; undefined for
 *  any other value, which the descent then checks, converts or refuses (#410). A scalar has no
 *  property to read, so what the descent does is all that is done. An array does not come here:
 *  a host may hand over one that changes as it is read, or answers a `Proxy`'s traps, and a
 *  second reading of it, by the descent, after this one declined, would be seen. */
function convertQuick(t: HostType, v: unknown): CpuValue | undefined {
  switch (t.k) {
    case 'num':
      if (t.t === 'f32') return typeof v === 'number' ? Math.fround(v) : undefined;
      return scalarFits(t.t, v) ? (v as number) : undefined;
    case 'bool':
      return typeof v === 'boolean' ? v : undefined;
    default:
      return undefined;
  }
}

/**
 * Check one argument of a host call against its parameter's type and copy it into the value
 * the CPU tier runs on (Rule 8.21). An `ArrayLike` of the right length (a `Float32Array`, an
 * array) becomes a fresh array, and an `f32` is rounded as a buffer write rounds it.
 *
 * @throws `TypeError` naming the function, the parameter and its TypeShade type, when the
 *   value does not fit.
 */
export function toShader(fn: string, param: string, t: HostType, v: unknown): CpuValue {
  const quick = convertQuick(t, v);
  if (quick !== undefined) return quick;
  try {
    return convertIn(t, v, '');
  } catch (e) {
    if (!(e instanceof Misfit)) throw e;
    const at = e.path === '' ? '' : `at ${e.path}, `;
    throw new TypeError(`${fn}(): parameter "${param}" (${t.s}): ${at}${e.problem}.`);
  }
}

/** Copy a result of the CPU tier out to the host: a fresh array or object at every level, so
 *  it aliases no argument and nothing the module keeps (Rule 8.21). */
export function fromShader(t: HostType, v: CpuValue): unknown {
  switch (t.k) {
    case 'num':
    case 'bool':
      return v;
    case 'void':
      return undefined;
    case 'vec':
    case 'mat': {
      if (!Array.isArray(v)) return Array.from(v as unknown as ArrayLike<number | boolean>);
      // What `Array.from` makes of an array, element by element, without its iterator.
      const out = new Array<unknown>(v.length);
      for (let i = 0; i < v.length; i++) out[i] = v[i];
      return out;
    }
    case 'arr':
      return Array.from(v as unknown as ArrayLike<CpuValue>, (x) => fromShader(t.e, x));
    case 'struct': {
      const o = v as unknown as Record<string, CpuValue>;
      const out: Record<string, unknown> = {};
      for (const [name, ft] of t.f) out[name] = fromShader(ft, o[name]!);
      return out;
    }
  }
}

/** A module constant as a host value: a copy, frozen at every level, so the host cannot write
 *  the value the module's own functions read. */
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

/** Refuse a call with the wrong number of arguments, which a JavaScript caller can make. */
export function arity(fn: string, expected: number, got: number): void {
  if (got !== expected)
    throw new TypeError(
      `${fn}() takes ${expected} argument${expected === 1 ? '' : 's'}; got ${got}.`,
    );
}

/** The value of an export that has no host face (Rule 8.20): the host view declares it `never`,
 *  so a call is a type error at the host's own line, and this refuses one that `tsc` did not
 *  see with the same reason. */
export function notCallable(name: string, reason: string): () => never {
  return () => {
    throw new TypeError(`${name} cannot be called from host code: ${reason}`);
  };
}
