import type { CpuValue } from './cpu-runtime.js';
import { fuseSlot } from './fuse-scope.js';
import type { IncomingReads } from './host-failure.js';
import { callKernel, type KernelFace } from './host-kernel.js';
import { isResource } from './host-record.js';
import { runtimeCount, type GeneratedCpu } from './host-entry.js';
import { toShader } from './host-values.js';
import { madeOf, type KernelMade } from './kernel-made-face.js';

const ARRAYS = { f32: Float32Array, i32: Int32Array, u32: Uint32Array } as const;

function lengthsBefore(k: KernelFace, made: KernelMade, args: readonly unknown[]): CpuValue[] {
  let at = 0;
  return k.params.map((p) => {
    if (p.name === made.param) return { length: 0 } as unknown as CpuValue;
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
): Float32Array | Int32Array | Uint32Array {
  const values = lengthsBefore(k, made, args);
  const init = cpu.F['$initPrivates'];
  init?.();
  const n = Number(cpu.F[made.length]!(...values));
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(
      `${k.name}(): the array it returns, "${made.shown}", would have length ${String(n)}, ` +
        `and JavaScript throws a RangeError for it: a length is a whole number of 0 or more.`,
    );
  const array = new ARRAYS[made.array](n);
  if (made.fill !== undefined) {
    init?.();
    array.fill(Number(cpu.F[made.fill]!(...values)));
  }
  return array;
}

export function callMadeKernel(
  cpu: GeneratedCpu,
  k: KernelFace,
  argc: number,
  args: readonly unknown[],
  reads?: IncomingReads,
): Promise<unknown> {
  const made = madeOf(k)!;
  const at = k.params.findIndex((p) => p.name === made.param);
  const taken = k.params.length - 1;
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
    const array = madeArray(cpu, k, made, args);
    const bound = array.length > 0 ? array : new ARRAYS[made.array](1);
    const all = [...args.slice(0, at), bound, ...args.slice(at)];
    return callKernel(cpu, k, argc + 1, all, reads).then(
      () => array,
      (e: unknown) => Promise.reject(renamed(e, made)),
    );
  } catch (e) {
    return Promise.reject(e);
  }
}
