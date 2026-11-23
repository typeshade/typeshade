// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { CpuValue } from './cpu-runtime.js';
import { fuseSlot } from './fuse-scope.js';
import type { IncomingReads } from './host-failure.js';
import { callKernel, type KernelFace } from './host-kernel.js';
import { heldArgument } from './host-arity.js';
import { isResource } from './host-record.js';
import type { GeneratedCpu } from './host-entry.js';
import { fromShaderIn } from './host-values.js';
import { PastPushedLength } from './push-count.js';
import { isMadeParam, madeOf, type KernelMade } from './kernel-made-face.js';
import { filled, madeArray, NO_CLASSES, renamed, type Made } from './host-kernel-made/making.js';
import { callMadeOnResource } from './host-kernel-made/on-resource.js';

function sharedObject(
  k: KernelFace,
  made: KernelMade,
  args: readonly unknown[],
  v: CpuValue | undefined,
): unknown {
  const from = made.fillFrom;
  if (from === undefined) return fromShaderIn(made.struct!, v ?? made.zero!, k.P?.() ?? NO_CLASSES);
  const at = k.params
    .filter((p) => !isMadeParam(made, p.name))
    .findIndex((p) => p.name === from.param);
  return from.path.reduce((o, name) => (o as Record<string, unknown>)[name], args[at]);
}

function pushedWithin(k: KernelFace, made: KernelMade, pushed: unknown, capacity: number): number {
  const count = Number(pushed);
  if (!Number.isInteger(count) || count < 0 || count > capacity)
    throw new Error(
      `${k.name}(): the array it grows with push, "${made.shown}", reports ${String(pushed)} ` +
        `elements pushed and has room for ${String(capacity)}; the compiler reserved too few.`,
    );
  return count;
}

function result(
  k: KernelFace,
  made: KernelMade,
  making: { readonly array: Made; readonly v?: CpuValue },
  args: readonly unknown[],
  marks: Uint32Array | undefined,
  pushed: unknown,
): Made {
  const width = made.width ?? 1;
  const all = making.array;
  const kept =
    made.grown === true
      ? all.slice(0, pushedWithin(k, made, pushed, all.length / width) * width)
      : all;
  if (made.share === undefined) return kept;
  const elements = kept as unknown[];
  const one = made.grown === true ? elements[0] : sharedObject(k, made, args, making.v);
  return elements.map((own, i) => (marks !== undefined && marks[i] !== 0 ? own : one));
}

function explained(e: unknown, k: KernelFace, made: KernelMade): unknown {
  const site = e instanceof PastPushedLength ? made.checks?.[e.site] : undefined;
  if (site === undefined) return renamed(e, made);
  const [verb, noun] = site.write ? ['writes', 'A write'] : ['reads', 'A read'];
  const err = e as PastPushedLength;
  return new RangeError(
    `${k.name}(): "${site.text}" ${verb} index ${String(err.index)} of "${made.shown}", whose ` +
      `length is ${String(err.length)} there. ${noun} past the length is not supported yet.`,
  );
}

function onResource(taken: KernelFace['params'], args: readonly unknown[]): boolean {
  return args.some((a, i) => {
    if (isResource(a)) return true;
    const held = taken[i]?.k === 'array' ? heldArgument(a) : undefined;
    return held !== undefined && (isResource(held.array) || isResource(held.length));
  });
}

export function callMadeKernel(
  cpu: GeneratedCpu,
  k: KernelFace,
  argc: number,
  args: readonly unknown[],
  reads?: IncomingReads,
): unknown {
  const made = madeOf(k)!;
  const taken = k.params.filter((p) => !isMadeParam(made, p.name));
  if (fuseSlot.active !== undefined)
    throw new TypeError(
      `${k.name}(): returns the array it makes, "${made.shown}", and a call inside fuse() ` +
        `that makes its result is not supported yet. Call ${k.name}() outside fuse().`,
    );
  if (argc === taken.length && onResource(taken, args))
    return callMadeOnResource(cpu, k, made, args, reads);
  try {
    if (argc !== taken.length)
      throw new TypeError(
        `${k.name}() takes ${taken.length} argument${taken.length === 1 ? '' : 's'}; got ${argc}.`,
      );
    const making = madeArray(cpu, k, made, args);
    const n = making.n;
    const bound = n > 0 ? making.array : filled(k, made, 1, undefined);
    const marks = made.written === undefined ? undefined : new Uint32Array(Math.max(n, 1));
    let next = 0;
    const all = k.params.map((p) =>
      p.name === made.param
        ? bound
        : p.name === made.count
          ? n
          : p.name === made.written
            ? marks
            : args[next++],
    );
    return callKernel(cpu, k, all.length, all, reads).then(
      (pushed) => result(k, made, making, args, marks, pushed),
      (e: unknown) => Promise.reject(explained(e, k, made)),
    );
  } catch (e) {
    return Promise.reject(e instanceof PastPushedLength ? explained(e, k, made) : e);
  }
}
