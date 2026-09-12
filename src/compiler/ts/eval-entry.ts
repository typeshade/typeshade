import type { ModuleDecl } from '../../core/ir/nodes.js'
import { compileModule } from '../../core/oracle.js'

export function evalEntry(m: ModuleDecl, name: string, args: readonly unknown[] = []): unknown {
  const cpu = compileModule(m, { gpuStubs: true })
  const fn = cpu.fns[name]
  if (!fn) throw new Error(`No function "${name}" in module`)
  return fn(...(args as never[]))
}
