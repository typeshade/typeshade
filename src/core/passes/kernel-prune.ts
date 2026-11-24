import type { ModuleDecl } from '../ir/index.js';
import { reachFrom } from './stage-bindings.js';

export function pruneUnreachedHelpers(m: ModuleDecl): ModuleDecl {
  const entries = m.funcs.filter((f) => f.stage !== undefined);
  const reached = reachFrom(m, entries).fns;
  return { ...m, funcs: m.funcs.filter((f) => f.stage !== undefined || reached.has(f.name)) };
}
