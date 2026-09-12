import type { ModuleDecl } from '../../core/ir/nodes.js'
import { typeKey } from '../../core/ir/types.js'
import { emitModule } from '../../core/backends/wgsl.js'
import { emitGlslStages } from '../../core/backends/glsl.js'
import { vertexLayoutOf, type GpuVertexLayout } from './vertex-layout.js'

export interface PackBinding {
  readonly name: string
  readonly space: string
  readonly group: number
  readonly binding: number
  readonly access?: 'read' | 'read_write'
  readonly type: string
}

export interface PackEntry {
  readonly name: string
  readonly stage: string
}

export interface Pack {
  readonly wgsl: string
  readonly glsl?: { readonly vertex: string; readonly fragment: string }
  readonly bindings: readonly PackBinding[]
  readonly vertexLayout?: GpuVertexLayout
  readonly entries: readonly PackEntry[]
  readonly structs: readonly { readonly name: string; readonly fields: readonly { name: string; type: string }[] }[]
}

export function packModule(m: ModuleDecl): Pack {
  const wgsl = emitModule(m)
  const hasVs = m.funcs.some((f) => f.stage === 'vertex')
  const hasFs = m.funcs.some((f) => f.stage === 'fragment')
  let glsl: Pack['glsl']
  if (hasVs && hasFs) {
    try {
      glsl = emitGlslStages(m)
    } catch {
      glsl = undefined
    }
  }
  return {
    wgsl,
    glsl,
    bindings: m.bindings.map((b) => ({
      name: b.name,
      space: b.space,
      group: b.group,
      binding: b.binding,
      access: b.access,
      type: typeKey(b.type),
    })),
    vertexLayout: vertexLayoutOf(m),
    entries: m.funcs.filter((f) => f.stage).map((f) => ({ name: f.name, stage: f.stage! })),
    structs: m.structs.map((s) => ({
      name: s.name,
      fields: s.fields.map((f) => ({ name: f.name, type: typeKey(f.type) })),
    })),
  }
}

export function packJson(m: ModuleDecl): string {
  return JSON.stringify(packModule(m), null, 2)
}
