import type { ModuleDecl } from '../../core/ir/nodes.js';
import { compileModule } from '../../core/oracle.js';
import type { ConsoleSink } from '../../core/console.js';

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

/** The sink, with each event marked by the invocation the entry was called as, when the entry
 *  takes `global_invocation_id` (compute) or `position` (fragment, the pixel `[x, y, 0]`): the
 *  id a decoded GPU event carries (surface §66). */
function withInvocation(
  m: ModuleDecl,
  name: string,
  args: readonly unknown[],
  sink: ConsoleSink | undefined,
): ConsoleSink | undefined {
  if (!sink) return sink;
  const decl = m.funcs.find((f) => f.name === name);
  const at = decl?.params.findIndex(
    (p) => p.builtin === 'global_invocation_id' || p.builtin === 'position',
  );
  if (decl === undefined || at === undefined || at < 0) return sink;
  const v = args[at];
  if (!Array.isArray(v)) return sink;
  const n = v.map((x) => Math.max(0, Math.floor(Number(x))));
  const invocation =
    decl.params[at]!.builtin === 'position'
      ? ([n[0] ?? 0, n[1] ?? 0, 0] as const)
      : ([n[0] ?? 0, n[1] ?? 0, n[2] ?? 0] as const);
  return (e) => sink(e.invocation ? e : { ...e, invocation });
}
