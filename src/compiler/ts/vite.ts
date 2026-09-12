// Vite plugin surface. No vite import — the host's Vite accepts this object.
import { compileTsSource } from './source-file.js'
import { packModule } from './pack.js'
import type { ModuleDecl } from '../../core/ir/nodes.js'

export interface TypeshadeViteOptions {
  readonly filter?: RegExp
}

export function typeshadeVite(options: TypeshadeViteOptions = {}) {
  const filter = options.filter ?? /\.shade\.ts$/
  return {
    name: 'typeshade',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!filter.test(id)) return null
      const r = compileTsSource(code, { fileName: id, requireDirective: true })
      const errors = r.diagnostics.filter((d) => d.category === 'error')
      if (errors.length) {
        throw new Error(errors.map((d) => `${d.fileName}:${d.line}:${d.character} ${d.message}`).join('\n'))
      }
      const structs =
        'structs' in r
          ? ((r as { structs?: { decl: ModuleDecl['structs'][number] }[] }).structs ?? []).map((s) => s.decl)
          : []
      const bindings = 'bindings' in r ? ((r as { bindings?: ModuleDecl['bindings'] }).bindings ?? []) : []
      const m: ModuleDecl = {
        consts: [...r.consts],
        structs,
        bindings: [...bindings],
        funcs: [...r.funcs],
      }
      return {
        code: `export default ${JSON.stringify(packModule(m))};\n`,
        map: null,
      }
    },
  }
}
