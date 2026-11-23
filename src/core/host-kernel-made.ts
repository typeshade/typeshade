// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { CpuValue } from './cpu-runtime.js';
import { fuseSlot } from './fuse-scope.js';
import type { IncomingReads } from './host-failure.js';
import { callKernel, type KernelFace } from './host-kernel.js';
import { isResource } from './host-record.js';
import { runtimeCount, type GeneratedCpu } from './host-entry.js';
import { fromShaderIn, toShader } from './host-values.js';
import { isMadeParam, madeOf, type KernelMade } from './kernel-made-face.js';

const ARRAYS = { f32: Float32Array, i32: Int32Array, u32: Uint32Array } as const;
const NO_CLASSES: ReadonlyMap<string, object> = new Map();

type Made = Float32Array | Int32Array | Uint32Array | unknown[];

function filled(k: KernelFace, made: KernelMade, n: number, v: CpuValue | undefined): Made {
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

function lengthsBefore(k: KernelFace, made: KernelMade, args: readonly unknown[]): CpuValue[] {
  let at = 0;
  return k.params.map((p) => {
    if (p.name === made.param) return { length: 0 } as unknown as CpuValue;
    if (p.name === made.count) return 0 as CpuValue;
    const v = args[at++];
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

function renamed(e: unknown, made: KernelMade): unknown {
  if (!(e instanceof TypeError)) return e;
  const text = e.message
    .split(`parameter "${made.param}"`)
    .join(`the array it returns, "${made.shown}",`);
  return text === e.message ? e : new TypeError(text);
}

function madeArray(
  cpu: GeneratedCpu,
  k: KernelFace,
  made: KernelMade,
  args: readonly unknown[],
): { readonly array: Made; readonly n: number } {
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
  return { array: filled(k, made, n, cpu.F[made.fill]!(...values)), n };
}

export function callMadeKernel(
  cpu: GeneratedCpu,
  k: KernelFace,
  argc: number,
  args: readonly unknown[],
  reads?: IncomingReads,
): Promise<unknown> {
  const made = madeOf(k)!;
  const taken = k.params.filter((p) => !isMadeParam(made, p.name)).length;
  if (fuseSlot.active !== undefined)
    throw new TypeError(
      `${k.name}(): returns the array it makes, "${made.shown}", and a call inside fuse() ` +
        `that makes its result is not supported yet. Call ${k.name}() outside fuse().`,
    );
  try {
    if (argc !== taken)
      throw new TypeError(
        `${k.name}() takes ${taken} argument${taken === 1 ? '' : 's'}; got ${argc}.`,
      );
    const resource = args.findIndex(isResource);
    if (resource >= 0)
      throw new TypeError(
        `${k.name}(): returns the array it makes, "${made.shown}", and a call of it on a ` +
          `resource is not supported yet. Pass plain data and await the call.`,
      );
    const { array, n } = madeArray(cpu, k, made, args);
    const bound = n > 0 ? array : filled(k, made, 1, undefined);
    let next = 0;
    const all = k.params.map((p) =>
      p.name === made.param ? bound : p.name === made.count ? n : args[next++],
    );
    const width = made.width ?? 1;
    return callKernel(cpu, k, all.length, all, reads).then(
      (pushed) =>
        made.grown === true ? array.slice(0, Math.min(Number(pushed), n) * width) : array,
      (e: unknown) => Promise.reject(renamed(e, made)),
    );
  } catch (e) {
    return Promise.reject(e);
  }
}
