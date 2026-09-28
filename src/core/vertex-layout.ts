// ═══ The vertex buffer a `@vertex` entry reads (Rule 6.8, change 0025) ═══
//
// One interleaved buffer, tightly packed: each `@location` input, a loose parameter or a field of
// a struct parameter, in the order written, at the offset the one before it ends. WebGPU needs an
// attribute's offset to be a multiple of 4 for a 32-bit format, which every format here is, so no
// padding is ever needed. `reflect().vertex`, `packModule()` and the manifest all read this one
// layout, so a host that packs by one of them binds by the others.

import {
  stageOf,
  type FuncDecl,
  type ModuleDecl,
  type StructDecl,
  type StructField,
} from './ir/nodes.js';
import type { ShaderType } from './ir/types.js';
import { typeKey } from './ir/types.js';

export interface GpuVertexAttr {
  readonly name: string;
  readonly location: number;
  readonly offset: number;
  /** The `GPUVertexFormat`: `float32x3`, `uint32`. An emulated `f64` is `float32x2`, its high
   *  and low halves. */
  readonly format: string;
  readonly type: string;
}

export interface GpuVertexLayout {
  readonly attributes: readonly GpuVertexAttr[];
  readonly arrayStride: number;
}

/** The layout of the module's first `@vertex` entry, or undefined when it reads no attribute. */
export function vertexLayoutOf(m: ModuleDecl): GpuVertexLayout | undefined {
  const vs = m.funcs.find((f) => stageOf(f) === 'vertex');
  return vs === undefined ? undefined : vertexLayoutOfEntry(vs, m.structs);
}

/** The layout of one `@vertex` entry's `@location` inputs, or undefined when it reads none. */
export function vertexLayoutOfEntry(
  vs: Pick<FuncDecl, 'params'>,
  structList: readonly StructDecl[],
): GpuVertexLayout | undefined {
  const structs = new Map(structList.map((s) => [s.name, s]));
  const attributes: GpuVertexAttr[] = [];
  let offset = 0;
  const add = (name: string, location: number, t: ShaderType): void => {
    const fmt = vertexFormat(t);
    if (fmt === undefined) return;
    attributes.push({ name, location, offset, format: fmt.format, type: typeKey(t) });
    offset += fmt.size;
  };
  for (const p of vs.params) {
    if (p.location !== undefined) {
      add(p.name, p.location, p.type);
      continue;
    }
    if (p.type.kind !== 'struct') continue;
    const decl = structs.get(p.type.name);
    if (decl === undefined) continue;
    for (const field of locatedFields(decl)) add(field.name, field.location!, field.type);
  }
  if (attributes.length === 0) return undefined;
  return { attributes, arrayStride: offset };
}

function locatedFields(decl: StructDecl): readonly StructField[] {
  return decl.fields.filter((f) => f.location !== undefined && !f.builtin);
}

const PREFIX = { f32: 'float32', i32: 'sint32', u32: 'uint32' } as const;

function vertexFormat(t: ShaderType): { format: string; size: number } | undefined {
  if (t.kind === 'scalar') {
    const prefix = PREFIX[t.scalar as keyof typeof PREFIX];
    return prefix === undefined ? undefined : { format: prefix, size: 4 };
  }
  // An emulated `f64` crosses as its two `f32` halves.
  if (t.kind === 'f64') return { format: 'float32x2', size: 8 };
  if (t.kind === 'vec') {
    const prefix = PREFIX[t.elem as keyof typeof PREFIX];
    if (prefix === undefined) return undefined;
    return { format: `${prefix}x${t.n}`, size: 4 * t.n };
  }
  return undefined;
}

export function vertexLayoutOfFunc(
  fn: FuncDecl,
  structs: readonly StructDecl[],
): GpuVertexLayout | undefined {
  return vertexLayoutOfEntry(fn, structs);
}
