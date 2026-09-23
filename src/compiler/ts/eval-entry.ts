import type { ModuleDecl } from '../../core/ir/nodes.js';
import { compileModule } from '../../core/oracle.js';
import type { ConsoleSink } from '../../core/console.js';

export function evalEntry(
  m: ModuleDecl,
  name: string,
  args: readonly unknown[] = [],
  consoleSink?: ConsoleSink,
): unknown {
  const cpu = compileModule(m, { gpuStubs: true, consoleSink });
  const fn = cpu.fns[name];
  if (!fn) throw new Error(`No function "${name}" in module`);
  return fn(...(args as never[]));
}
