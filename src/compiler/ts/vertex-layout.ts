import type { FuncDecl, ModuleDecl, StructDecl, StructField } from '../../core/ir/nodes.js'
import type { ShaderType } from '../../core/ir/types.js'
import { typeKey } from '../../core/ir/types.js'

export interface GpuVertexAttr {
  readonly name: string
  readonly location: number
  readonly offset: number
  readonly format: string
  readonly type: string
}

export interface GpuVertexLayout {
  readonly attributes: readonly GpuVertexAttr[]
  readonly arrayStride: number
}

export function vertexLayoutOf(m: ModuleDecl): GpuVertexLayout | undefined {
  const structs = new Map(m.structs.map((s) => [s.name, s]))
  const vs = m.funcs.find((f) => f.stage === 'vertex')
  if (!vs) return undefined
  const attributes: GpuVertexAttr[] = []
  let offset = 0
  for (const p of vs.params) {
    if (p.location !== undefined) {
      const fmt = vertexFormat(p.type)
      if (!fmt) continue
      attributes.push({ name: p.name, location: p.location, offset, format: fmt.format, type: typeKey(p.type) })
      offset += fmt.size
      continue
    }
    if (p.type.kind !== 'struct') continue
    const decl = structs.get(p.type.name)
    if (!decl) continue
    for (const field of locatedFields(decl)) {
      const fmt = vertexFormat(field.type)
      if (!fmt || field.location === undefined) continue
      attributes.push({
        name: field.name,
        location: field.location,
        offset,
        format: fmt.format,
        type: typeKey(field.type),
      })
      offset += fmt.size
    }
  }
  if (!attributes.length) return undefined
  return { attributes, arrayStride: offset }
}

function locatedFields(decl: StructDecl): readonly StructField[] {
  return decl.fields.filter((f) => f.location !== undefined && !f.builtin)
}

function vertexFormat(t: ShaderType): { format: string; size: number } | undefined {
  if (t.kind === 'scalar') {
    if (t.scalar === 'f32') return { format: 'float32', size: 4 }
    if (t.scalar === 'i32') return { format: 'sint32', size: 4 }
    if (t.scalar === 'u32') return { format: 'uint32', size: 4 }
    return undefined
  }
  if (t.kind === 'vec') {
    const prefix = t.elem === 'f32' ? 'float32' : t.elem === 'i32' ? 'sint32' : t.elem === 'u32' ? 'uint32' : undefined
    if (!prefix) return undefined
    return { format: `${prefix}x${t.n}`, size: 4 * t.n }
  }
  return undefined
}

export function vertexLayoutOfFunc(fn: FuncDecl, structs: readonly StructDecl[]): GpuVertexLayout | undefined {
  return vertexLayoutOf({ consts: [], structs: [...structs], bindings: [], funcs: [fn] })
}
