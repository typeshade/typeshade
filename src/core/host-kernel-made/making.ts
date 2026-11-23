// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { CpuValue } from '../cpu-runtime.js';
import type { KernelFace, KernelParam } from '../host-kernel.js';
import { heldArgument } from '../host-arity.js';
import { isResource } from '../host-record.js';
import { flatWidth, runtimeCount, type GeneratedCpu } from '../host-entry.js';
import { fromShaderIn, toShader } from '../host-values.js';
import type { KernelMade } from '../kernel-made-face.js';
import { lengthOf, residentState } from '../resident.js';

const ARRAYS = { f32: Float32Array, i32: Int32Array, u32: Uint32Array } as const;
export const NO_CLASSES: ReadonlyMap<string, object> = new Map();

export type Made = Float32Array | Int32Array | Uint32Array | unknown[];

export function filled(k: KernelFace, made: KernelMade, n: number, v: CpuValue | undefined): Made {
  if (made.struct !== undefined) {
    const classes = k.P?.() ?? NO_CLASSES;
    return Array.from({ length: n }, () => fromShaderIn(made.struct!, v ?? made.zero!, classes));
  }
  const width = made.width ?? 1;
  const array = new ARRAYS[made.array!](n * width);
  if (v === undefined) return array;
  if (width === 1) array.fill(Number(v));
  else for (let i = 0; i < n; i++) array.set(v as unknown as number[], i * width);
  return array;
}

function measuredResource(k: KernelFace, made: KernelMade, p: KernelParam, v: unknown): CpuValue {
  if (p.k === 'array') {
    const array = heldArgument(v)?.array ?? v;
    const state = residentState(array);
    if (state === undefined)
      return { length: Number((array as { length?: unknown }).length ?? 0) } as unknown as CpuValue;
    const e = p.layout.e;
    const width = flatWidth(e)?.n ?? (e.k === 'm' ? e.c * e.r : 1);
    return {
      length: Math.floor((lengthOf(state) * state.components) / width),
    } as unknown as CpuValue;
  }
  if (made.reads?.includes(p.name) === true)
    throw new TypeError(
      `${k.name}(): parameter "${p.name}" is a resource, and the length or the fill value of the ` +
        `array it returns, "${made.shown}", reads it; a call on a resource that reads them from a ` +
        `resource is not supported yet. Pass "${p.name}" as plain data.`,
    );
  return 0 as CpuValue;
}

function lengthsBefore(k: KernelFace, made: KernelMade, args: readonly unknown[]): CpuValue[] {
  let at = 0;
  return k.params.map((p) => {
    if (p.name === made.param || p.name === made.written)
      return { length: 0 } as unknown as CpuValue;
    if (p.name === made.count) return 0 as CpuValue;
    const v = args[at++];
    if (isResource(v) || (p.k === 'array' && isResource(heldArgument(v)?.array)))
      return measuredResource(k, made, p, v);
    if (p.k === 'value') return toShader(k.name, p.name, p.type, v) as CpuValue;
    if (p.k === 'array') {
      let length = 0;
      try {
        length = runtimeCount(p.layout, v, '');
      } catch {
        length = 0;
      }
      return { length } as unknown as CpuValue;
    }
    return 0 as CpuValue;
  });
}

export function renamed(e: unknown, made: KernelMade): unknown {
  if (!(e instanceof TypeError)) return e;
  const text = e.message
    .split(`parameter "${made.param}"`)
    .join(`the array it returns, "${made.shown}",`);
  return text === e.message ? e : new TypeError(text);
}

export function madeArray(
  cpu: GeneratedCpu,
  k: KernelFace,
  made: KernelMade,
  args: readonly unknown[],
): { readonly array: Made; readonly n: number; readonly v?: CpuValue } {
  const values = lengthsBefore(k, made, args);
  const init = cpu.F['$initPrivates'];
  init?.();
  const n = Number(cpu.F[made.length]!(...values));
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(
      `${k.name}(): the array it returns, "${made.shown}", would have length ${String(n)}, ` +
        `and JavaScript throws a RangeError for it: a length is a whole number of 0 or more.`,
    );
  if (made.fill === undefined) return { array: filled(k, made, n, undefined), n };
  init?.();
  const v = cpu.F[made.fill]!(...values);
  return { array: filled(k, made, n, v), n, v };
}
