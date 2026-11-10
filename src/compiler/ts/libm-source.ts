// The compile of the libm's source (change 0042, decision N14).
//
// The libm is written in `"use typeshade"` with the compiler-internal operations of
// `internal-ops.ts`. This is the one compile that lowers them. No public entry point reaches
// it: `scripts/bake-libm.ts` and the libm's tests call it. It emits no shader text, since no
// shader writer spells an internal operation.

import type { ModuleDecl } from '../../core/ir/nodes.js';
import { compileTsSource, type TsCompilerDiagnostic } from './source-file.js';
import { withInternalOps } from './internal-ops.js';
import { emittedStructDecls } from './structs.js';

/** What {@link compileLibmSource} returns: the module, and every diagnostic of the compile. */
export interface LibmCompile {
  readonly module: ModuleDecl;
  readonly diagnostics: readonly TsCompilerDiagnostic[];
}

/** Lower the libm source `source` to the IR, with the internal operations in force. */
export function compileLibmSource(source: string, fileName: string): LibmCompile {
  const r = withInternalOps(() => compileTsSource(source, { fileName, emit: false }));
  return {
    module: {
      consts: [...r.consts],
      structs: emittedStructDecls(r.structs),
      bindings: [...r.bindings],
      funcs: [...r.funcs],
    },
    diagnostics: r.diagnostics,
  };
}
