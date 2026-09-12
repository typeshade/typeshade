import type { ModuleDecl } from '../../core/ir/nodes.js'
import { emitGlslStages } from '../../core/backends/glsl.js'
import { compileTsSource, type TsCompilerDiagnostic } from './source-file.js'
import { packModule } from './pack.js'
import { evalEntry } from './eval-entry.js'

export function compile(source: string): {
  readonly diagnostics: readonly TsCompilerDiagnostic[]
  readonly module: ModuleDecl
  readonly wgsl?: string
  readonly glsl?: { readonly vertex: string; readonly fragment: string }
  readonly eval: (name: string, args?: readonly unknown[]) => unknown
} {
  const r = compileTsSource(source)
  const module: ModuleDecl = {
    consts: [...r.consts],
    structs: r.structs.map((s) => s.decl),
    bindings: [...r.bindings],
    funcs: [...r.funcs],
  }
  let glsl: { readonly vertex: string; readonly fragment: string } | undefined
  try {
    glsl = emitGlslStages(module)
  } catch {
    glsl = undefined
  }
  return {
    diagnostics: r.diagnostics,
    module,
    wgsl: r.wgsl ?? packModule(module).wgsl,
    glsl,
    eval: (name, args = []) => evalEntry(module, name, args),
  }
}
