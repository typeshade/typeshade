// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { FuncDecl, StructDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { zeroOf } from '../../../core/cpu-runtime.js';
import type { KernelFace } from '../../../core/host-kernel.js';
import type { HostType } from '../../../core/host-values.js';
import { isMadeParam, madeOf, type KernelMade } from '../../../core/kernel-made-face.js';
import type { HostExport } from '../host-face-contracts.js';
import { hostTypeOf } from '../host-types.js';
import { madeArrayOf } from '../lower/made-array/registry.js';

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
  const length = cpuFn('length', made.length);
  const fill = made.fill === undefined ? undefined : cpuFn('fill', made.fill);
  const reads = paramsRead(f, [made.prelude, made.length, made.fill]);
  const record: KernelMade = {
    param: made.param,
    count: made.count,
    shown: made.shown,
    ...madeShape(made.element, structs),
    length: length.name,
    ...(fill !== undefined ? { fill: fill.name } : {}),
    ...(made.grown === true ? { grown: true as const } : {}),
    ...(made.share !== undefined ? { share: made.share } : {}),
    ...(made.written !== undefined ? { written: made.written } : {}),
    ...(made.fillFrom !== undefined ? { fillFrom: made.fillFrom } : {}),
    ...(reads.length > 0 ? { reads } : {}),
  };
  const face: Record<string, unknown> = { ...e.face };
  delete face.gl;
  delete face.fuse;
  return {
    ...e,
    face: {
      ...(face as unknown as typeof e.face),
      noWebgl2: `it makes the array it returns, "${made.shown}", which the WebGL2 tier does not support yet`,
      made: record,
    } as typeof e.face,
    ranges: [...e.ranges, length, ...(fill !== undefined ? [fill] : [])],
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
