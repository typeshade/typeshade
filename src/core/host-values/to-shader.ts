import type { CpuValue } from '../cpu-runtime.js';
import { resourceProbes } from '../resource-probe.js';
import type { HostNumber, HostType } from './types.js';

const RANGE: Record<'i32' | 'u32', readonly [number, number]> = {
  i32: [-0x80000000, 0x7fffffff],
  u32: [0, 0xffffffff],
};

function numberProblem(t: HostNumber, v: unknown): string | undefined {
  if (typeof v !== 'number') return `got ${describe(v)}`;
  if (t === 'f32' || t === 'f64') return undefined;
  const [lo, hi] = RANGE[t];
  if (!Number.isInteger(v) || v < lo || v > hi)
    return `got ${v}, which is not a whole number in the ${t} range`;
  return undefined;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `an array of length ${v.length}`;
  if (ArrayBuffer.isView(v)) return `a ${v.constructor.name}`;
  if (typeof v === 'object') return 'an object';
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`;
  return `${typeof v} ${String(v)}`;
}

function listOf(v: unknown, n: number): ArrayLike<unknown> | string {
  if (typeof v !== 'object' || v === null || typeof (v as { length?: unknown }).length !== 'number')
    return `got ${describe(v)}`;
  const xs = v as ArrayLike<unknown>;
  if (xs.length !== n)
    return Array.isArray(v) ? `got ${describe(v)}` : `got ${describe(v)} of length ${xs.length}`;
  return xs;
}

class Misfit {
  constructor(
    readonly path: string,
    readonly problem: string,
  ) {}
}

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
      return t.t === 'f32' ? Math.fround(v as number) : (v as number);
    }
    case 'bool':
      if (typeof v !== 'boolean') throw new Misfit(path, `got ${describe(v)}`);
      return v;
    case 'key': {
      const id = typeof v === 'string' ? t.m.indexOf(v) : -1;
      if (id < 0) throw new Misfit(path, `got ${describe(v)}, which is not one of ${t.s}`);
      return id;
    }
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
    case 'rec': {
      if (typeof v !== 'object' || v === null || Array.isArray(v))
        throw new Misfit(path, `got ${describe(v)}`);
      const o = v as Record<string, unknown>;
      const extra = Object.keys(o).find((name) => !t.m.includes(name));
      if (extra !== undefined)
        throw new Misfit(
          `${path}.${extra}`,
          `the key is none of ${t.m.map((m) => JSON.stringify(m)).join(' | ')}`,
        );
      const out: CpuValue[] = [];
      for (const name of t.m) {
        if (!(name in o)) throw new Misfit(`${path}.${name}`, 'the key is missing');
        out.push(convertIn(t.e, o[name], `${path}.${name}`));
      }
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

function scalarFits(e: HostNumber | 'bool', x: unknown): boolean {
  if (e === 'bool') return typeof x === 'boolean';
  if (typeof x !== 'number') return false;
  if (e === 'f32' || e === 'f64') return true;
  const [lo, hi] = RANGE[e];
  return Number.isInteger(x) && x >= lo && x <= hi;
}

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

function resourceKind(v: unknown): 'Buffer' | 'Uniform' | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  for (const probe of resourceProbes) {
    const kind = probe(v);
    if (kind !== undefined) return kind;
  }
  return undefined;
}

function resourceRefusal(
  fn: string,
  param: string,
  t: HostType,
  given: 'Buffer' | 'Uniform',
): string {
  const head = `${fn}(): parameter "${param}" (${t.s}) takes no ${given} here; pass plain data`;
  return t.k === 'mat' && t.e === 'f64'
    ? `${head}: a matrix of f64 takes plain data only (change 0138, Amendment A13, Q12).`
    : `${head} (change 0138, R2; Amendment A10, Q-C).`;
}

export function toShader(fn: string, param: string, t: HostType, v: unknown): CpuValue {
  const quick = convertQuick(t, v);
  if (quick !== undefined) return quick;
  try {
    return convertIn(t, v, '');
  } catch (e) {
    if (!(e instanceof Misfit)) throw e;
    const given = resourceKind(v);
    if (given !== undefined) throw new TypeError(resourceRefusal(fn, param, t, given));
    const at = e.path === '' ? '' : `at ${e.path}, `;
    throw new TypeError(`${fn}(): parameter "${param}" (${t.s}): ${at}${e.problem}.`);
  }
}
