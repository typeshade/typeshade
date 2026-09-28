import type { ModuleDecl } from '../../core/ir/nodes.js';
import { compileModule } from '../../core/oracle.js';
import { consoleInvocation, type ConsoleSink } from '../../core/console.js';

export function evalEntry(
  m: ModuleDecl,
  name: string,
  args: readonly unknown[] = [],
  consoleSink?: ConsoleSink,
): unknown {
  const cpu = compileModule(m, {
    gpuStubs: true,
    consoleSink: withInvocation(m, name, args, consoleSink),
  });
  const fn = cpu.fns[name];
  if (!fn) throw new Error(`No function "${name}" in module`);
  return fn(...(args as never[]));
}

/** The sink, with each event marked by the invocation the entry was called as
 *  ({@link consoleInvocation}). */
function withInvocation(
  m: ModuleDecl,
  name: string,
  args: readonly unknown[],
  sink: ConsoleSink | undefined,
): ConsoleSink | undefined {
  if (!sink) return sink;
  const decl = m.funcs.find((f) => f.name === name);
  const invocation = decl && consoleInvocation(decl, args);
  if (!invocation) return sink;
  return (e) => sink(e.invocation ? e : { ...e, invocation });
}
