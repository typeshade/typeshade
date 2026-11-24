// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { FuncDecl, ModuleDecl, StructDecl } from '../../../core/ir/nodes.js';
import { lowerKernel } from '../../../core/passes/kernel-lower.js';
import { pruneUnreachedHelpers } from '../../../core/passes/kernel-prune.js';
import type { LowerOptions } from '../../../core/passes/kernel-lower-ir.js';
import type { KernelProof } from '../../../core/passes/parallel-loop.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { zeroOf } from '../../../core/cpu-runtime.js';
import type { KernelFace } from '../../../core/host-kernel.js';
import type { HostType } from '../../../core/host-values.js';
import {
  isMadeParam,
  madeOf,
  type KernelCapacityLoop,
  type KernelCapacityTerm,
  type KernelMade,
} from '../../../core/kernel-made-face.js';
import type { HostExport } from '../host-face-contracts.js';
import { hostTypeOf } from '../host-types.js';
import { madeArrayOf, type GrownLoop } from '../lower/made-array/registry.js';
import { grownChecks, type GrownSite } from '../lower/made-array/bounds.js';

type MadeShape = Pick<KernelMade, 'array' | 'width' | 'struct' | 'zero'>;

function madeShape(elem: ShaderType, structs: ReadonlyMap<string, StructDecl>): MadeShape {
  if (elem.kind === 'scalar') return { array: elem.scalar as 'f32' | 'i32' | 'u32' };
  if (elem.kind === 'vec') return { array: elem.elem as 'f32' | 'i32' | 'u32', width: elem.n };
  const struct = hostTypeOf(elem, structs);
  if ('none' in struct) throw new Error(`a made array of ${elem.kind} has no host type`);
  return { struct, zero: zeroOf(elem, structs) };
}

function paramsRead(f: FuncDecl, nodes: readonly unknown[]): string[] {
  const read = new Set<string>();
  const walk = (x: unknown): void => {
    if (typeof x !== 'object' || x === null) return;
    const node = x as { readonly op?: unknown; readonly name?: unknown };
    if (node.op === 'param' && typeof node.name === 'string') read.add(node.name);
    Object.values(x).forEach(walk);
  };
  walk(nodes);
  return f.params.map((p) => p.name).filter((name) => read.has(name));
}

export function grownChecked(f: FuncDecl): FuncDecl {
  const made = madeArrayOf(f);
  if (made?.grown !== true) return f;
  const checked = grownChecks(f, made.param);
  return checked.sites.length === 0 ? f : { ...f, body: checked.body };
}

function growingReason(shown: string): string {
  return (
    `it grows "${shown}" with push in a loop whose number of pushes the call cannot know ` +
    `before it runs, and only the CPU tier grows an array while it runs; a run that grows an ` +
    `array on WebGPU or WebGL2 is not supported yet`
  );
}

function checkReason(shown: string, first: GrownSite): string {
  return (
    `it ${first.write ? 'writes' : 'reads'} "${first.text}", an element of "${shown}" at an ` +
    `index the compiler cannot prove is below its length, and only the CPU tier checks such an ` +
    `index at the call`
  );
}

export function cpuOnly(
  face: Record<string, unknown>,
  reasons: readonly (string | undefined)[],
): void {
  const why = reasons.find((r) => r !== undefined);
  for (const key of ['gpu', 'gl', 'noWebgl2']) delete face[key];
  if (why !== undefined) face.noGpu = why;
}

export function lowerKernelFor(
  f: FuncDecl,
  m: ModuleDecl,
  proof: KernelProof,
  options: LowerOptions = {},
): ReturnType<typeof lowerKernel> {
  const plan = lowerKernel(f, m, proof, {
    ...options,
    ...(madeArrayOf(f)?.counted === true ? { exactTotal: true } : {}),
  });
  if ('noGpu' in plan) return plan;
  return {
    ...plan,
    module: pruneUnreachedHelpers(plan.module),
    ...(plan.subgroupModule !== undefined
      ? { subgroupModule: pruneUnreachedHelpers(plan.subgroupModule) }
      : {}),
  };
}

export function madeFace(
  e: HostExport,
  f: FuncDecl,
  structs: ReadonlyMap<string, StructDecl>,
): HostExport {
  const made = madeArrayOf(f);
  if (made === undefined || e.kind !== 'kernel') return e;
  const cpuFn = (suffix: string, expr: NonNullable<typeof made.fill>): FuncDecl => ({
    name: `${f.name}__${suffix}`,
    params: f.params,
    ret: expr.type,
    body: [...made.prelude, { s: 'return', expr }],
    kernel: true,
  });
  const length = made.length === undefined ? undefined : cpuFn('length', made.length);
  const loopFns = (
    loop: GrownLoop,
    tag: string,
  ): { readonly record: KernelCapacityLoop; readonly funcs: FuncDecl[] } => {
    const low = cpuFn(`low${tag}`, loop.low);
    const high = cpuFn(`high${tag}`, loop.high);
    return {
      record: { low: low.name, high: high.name, inclusive: loop.inclusive, step: loop.step },
      funcs: [low, high],
    };
  };
  const bounds = (made.capacity ?? []).map((t, i) => {
    const head = loopFns(t, String(i));
    const inner = (t.inner ?? []).map((l, k) => loopFns(l, `${i}_${k}`));
    const when = t.when === undefined ? undefined : cpuFn(`when${i}`, t.when);
    const record: KernelCapacityTerm = {
      ...head.record,
      pushes: t.pushes,
      ...(inner.length > 0 ? { inner: inner.map((l) => l.record) } : {}),
      ...(when !== undefined ? { when: when.name } : {}),
    };
    return {
      record,
      funcs: [
        ...head.funcs,
        ...inner.flatMap((l) => l.funcs),
        ...(when !== undefined ? [when] : []),
      ],
    };
  });
  const capacity = bounds.map(({ record }) => record);
  const fill = made.fill === undefined ? undefined : cpuFn('fill', made.fill);
  const reads = paramsRead(f, [made.prelude, made.length, made.capacity, made.fill]);
  const sites = made.grown === true ? grownChecks(f, made.param).sites : [];
  const record: KernelMade = {
    param: made.param,
    count: made.count,
    shown: made.shown,
    ...madeShape(made.element, structs),
    ...(length !== undefined ? { length: length.name } : {}),
    ...(made.capacity !== undefined ? { capacity } : {}),
    ...(fill !== undefined ? { fill: fill.name } : {}),
    ...(made.grown === true ? { grown: true as const } : {}),
    ...(made.counted === true ? { counted: true as const } : {}),
    ...(made.growing === true ? { growing: true as const } : {}),
    ...(made.share !== undefined ? { share: made.share } : {}),
    ...(made.written !== undefined ? { written: made.written } : {}),
    ...(made.fillFrom !== undefined ? { fillFrom: made.fillFrom } : {}),
    ...(reads.length > 0 ? { reads } : {}),
    ...(sites.length > 0 ? { checks: sites } : {}),
  };
  const face: Record<string, unknown> = { ...e.face };
  delete face.fuse;
  if (made.growing === true || sites.length > 0)
    cpuOnly(face, [
      typeof face.noGpu === 'string' ? face.noGpu : undefined,
      made.growing === true ? growingReason(made.shown) : undefined,
      sites.length > 0 ? checkReason(made.shown, sites[0]!) : undefined,
    ]);
  return {
    ...e,
    face: { ...(face as unknown as typeof e.face), made: record } as typeof e.face,
    ranges: [
      ...e.ranges,
      ...(length !== undefined ? [length] : []),
      ...bounds.flatMap(({ funcs }) => funcs),
      ...(fill !== undefined ? [fill] : []),
    ],
  };
}

export const TYPED_NAME = {
  f32: 'Float32Array',
  i32: 'Int32Array',
  u32: 'Uint32Array',
  f64: 'Float64Array',
} as const;

export interface MadeView {
  readonly face: KernelFace;
  readonly result?: string;
  readonly onResource?: string;
  readonly plain: ReadonlySet<string>;
  readonly note: string;
}

function madeResult(made: KernelMade, print: (t: HostType) => string): readonly [string, string] {
  if (made.struct !== undefined) {
    const type = `${print(made.struct)}[]`;
    return [type, `a new ${type}`];
  }
  const typed = TYPED_NAME[made.array!];
  if (made.width === undefined) return [typed, `a new ${typed}`];
  return [
    typed,
    `a new ${typed} of the ${made.width} components of each element, one after another,`,
  ];
}

function madeBuffer(
  made: KernelMade,
  print: (t: HostType) => string,
  isClass: (name: string) => boolean,
): string | undefined {
  if (made.grown === true || made.share !== undefined) return undefined;
  if (made.struct === undefined) return `Buffer<${made.array!}>`;
  const name = print(made.struct);
  return isClass(name) ? `Buffer<${name}>` : undefined;
}

function onResourceNote(onResource: string | undefined): string {
  if (onResource === undefined)
    return 'a call on a resource, or inside fuse(), is not supported yet (Rules 8.21 and 8.23).';
  return `called on a resource, it returns a new ${onResource} at once, of the scalars for a vector, which the caller disposes, and a length of 0 throws a RangeError, since a Buffer of length 0 is not supported yet; a call inside fuse() is not supported yet (Rules 8.21 and 8.23).`;
}

export function madeView(
  face: KernelFace,
  print: (t: HostType) => string,
  isClass: (name: string) => boolean = () => false,
): MadeView {
  const made = madeOf(face);
  if (made === undefined) return { face, plain: new Set(), note: '' };
  const length = made.grown === true ? 'is the number of elements it pushes' : 'its arguments give';
  const [result, what] = madeResult(made, print);
  const onResource = madeBuffer(made, print, isClass);
  return {
    face: {
      ...face,
      params: face.params.filter((p) => !isMadeParam(made, p.name)),
      ...(made.grown === true ? { result: { k: 'void' as const, s: 'void' } } : {}),
    },
    result,
    ...(onResource !== undefined ? { onResource } : {}),
    plain: new Set(made.reads),
    note: ` It makes the array it returns, "${made.shown}", ${what} whose ${made.width === undefined ? 'length' : 'element count'} ${length}, and the caller owns it; ${onResourceNote(onResource)}`,
  };
}
