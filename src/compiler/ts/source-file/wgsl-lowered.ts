import { wgslBackend } from '../../../core/backends/wgsl.js';
import { emitModuleLowered } from '../../../core/emit.js';
import type { FuncDecl, ModuleDecl } from '../../../core/ir/nodes.js';
import type { CompileTsSourceResult } from '../source-file.js';
import { emittedStructDecls } from '../structs.js';

type Parts = Pick<
  CompileTsSourceResult,
  'consts' | 'structs' | 'bindings' | 'funcs' | 'overrides' | 'vars' | 'enables'
>;

const kept = new WeakMap<
  readonly FuncDecl[],
  { readonly parts: Parts; readonly lowered: ModuleDecl }
>();

export function emitWgslKept(parts: Parts): string {
  const emitted = emitModuleLowered(
    {
      consts: [...parts.consts],
      structs: emittedStructDecls(parts.structs),
      bindings: [...parts.bindings],
      funcs: [...parts.funcs],
      overrides: [...parts.overrides],
      vars: [...parts.vars],
      enables: parts.enables,
    },
    wgslBackend,
  );
  kept.set(parts.funcs, { parts, lowered: emitted.lowered });
  return emitted.code;
}

export function wgslLoweredOf(r: CompileTsSourceResult): ModuleDecl | undefined {
  const at = kept.get(r.funcs);
  if (at === undefined) return undefined;
  const same = (['consts', 'structs', 'bindings', 'overrides', 'vars', 'enables'] as const).every(
    (k) => at.parts[k] === r[k],
  );
  return same ? at.lowered : undefined;
}
