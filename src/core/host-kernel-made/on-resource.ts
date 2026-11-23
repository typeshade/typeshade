// Implements: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { IncomingReads } from '../host-failure.js';
import { callKernel, type KernelFace, type KernelParam } from '../host-kernel.js';
import { heldArgument } from '../host-arity.js';
import { argumentOwner, isResource, resources } from '../host-record.js';
import type { GeneratedCpu } from '../host-entry.js';
import type { KernelMade } from '../kernel-made-face.js';
import { callDefault, defaultOwner, inferOwner, type CallOwner } from '../owner.js';
import { handleOf, ResidentArrayState } from '../resident.js';
import { madeArray, NO_CLASSES, renamed } from './making.js';

interface MadeBuffer {
  readonly value: unknown;
  dispose(): void;
}

function notYet(k: KernelFace, made: KernelMade, why: string): TypeError {
  return new TypeError(
    `${k.name}(): returns the array it ${made.grown === true ? 'grows with push' : 'makes'}, ` +
      `"${made.shown}", ${why}, and a call of it on a resource that does so is not supported ` +
      `yet. Pass plain data and await the call.`,
  );
}

function refusedForm(
  k: KernelFace,
  made: KernelMade,
  params: readonly KernelParam[],
  args: readonly unknown[],
): TypeError | undefined {
  if (made.grown === true)
    return notYet(k, made, 'whose length is the number of elements it pushes, known after the run');
  if (made.share !== undefined)
    return notYet(k, made, 'whose elements the run does not write share one object');
  if (made.struct !== undefined && k.P?.().get(made.struct.s) === undefined)
    return notYet(k, made, `of ${made.struct.s}, which is no class the module exports`);
  const plain = params.findIndex(
    (p, i) => p.k === 'array' && p.writes && !isResource(heldArgument(args[i])?.array ?? args[i]),
  );
  if (plain >= 0)
    return notYet(k, made, `and writes the plain array of parameter "${params[plain]!.name}"`);
  return undefined;
}

function ownerOfCall(
  k: KernelFace,
  params: readonly KernelParam[],
  args: readonly unknown[],
): CallOwner {
  return inferOwner(
    `${k.name}()`,
    params.flatMap((p, i): [string, CallOwner | undefined][] => {
      const held = p.k === 'array' ? heldArgument(args[i]) : undefined;
      if (held === undefined) return [[`parameter "${p.name}"`, argumentOwner(args[i])]];
      return [
        [`parameter "${p.name}"`, argumentOwner(held.array)],
        [`"${p.name}.length"`, argumentOwner(held.length, `${k.name}(): "${p.name}.length"`)],
      ];
    }),
    undefined,
    callDefault(),
  );
}

function newBuffer(
  k: KernelFace,
  made: KernelMade,
  host: unknown,
  n: number,
  owner: CallOwner,
): MadeBuffer {
  if (made.struct !== undefined) {
    const make = resources.structs;
    if (make === undefined)
      throw new TypeError(
        `${k.name}(): returns ${made.struct.s}s, whose Buffer is a resource of typeshade/runtime; import typeshade/runtime to call it on a resource.`,
      );
    const param = k.params.find((p) => p.name === made.param) as KernelParam & { k: 'array' };
    const proto = (k.P?.() ?? NO_CLASSES).get(made.struct.s)!;
    const r = make(param.layout, proto, `Buffer<${made.struct.s}>`, n, owner);
    r.fill(host as unknown[]);
    const value = r.value as { dispose(): void };
    return { value, dispose: () => value.dispose() };
  }
  const state = new ResidentArrayState(host);
  if (owner !== defaultOwner) state.ownedBy = owner;
  const value = owner.result?.(state) ?? handleOf(state);
  return { value, dispose: () => (value as { dispose(): void }).dispose() };
}

export function callMadeOnResource(
  cpu: GeneratedCpu,
  k: KernelFace,
  made: KernelMade,
  args: readonly unknown[],
  reads: IncomingReads,
): unknown {
  const params = k.params.filter((p) => p.name !== made.param && p.name !== made.count);
  const refused = refusedForm(k, made, params, args);
  if (refused !== undefined) throw refused;
  const owner = ownerOfCall(k, params, args);
  const making = madeArray(cpu, k, made, args);
  if (making.n === 0)
    throw new RangeError(
      `${k.name}(): the array it returns, "${made.shown}", would have length 0, and a call on a ` +
        `resource returns it as a Buffer, of which a length of 0 is not supported yet (Rule 11.8). ` +
        `Pass plain data for an empty result.`,
    );
  const result = newBuffer(k, made, making.array, making.n, owner);
  let next = 0;
  const all = k.params.map((p) =>
    p.name === made.param ? result.value : p.name === made.count ? making.n : args[next++],
  );
  try {
    callKernel(cpu, k, all.length, all, reads);
  } catch (e) {
    result.dispose();
    throw renamed(e, made);
  }
  return result.value;
}
