// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type ts from 'typescript';
import type { FuncDecl } from '../../../../core/ir/nodes.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { grownAccesses } from './bounds.js';
import { nestTerms, once } from './nest.js';
import type { GrownTerm, MadeLowering, UnreadLoop } from './registry.js';
import type { Readable } from './readable.js';

export interface GrownCapacity {
  readonly terms: readonly GrownTerm[];
  readonly unread?: UnreadLoop;
  readonly open?: true;
}

export function grownCapacity(
  stub: FuncDecl,
  made: MadeLowering,
  r: Readable,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): GrownCapacity | undefined {
  const name = (made.decl.name as ts.Identifier).text;
  const writes = grownAccesses(stub.body, made.param).filter(
    (a) => a.mode === 'write' && !a.proven,
  );
  const nested = writes.find(
    (a) => a.loop !== undefined && (a.depth > 1 || !stub.body.includes(a.loop)),
  );
  const outside = writes.filter((a) => a.loop === undefined).length;
  const terms: GrownTerm[] =
    outside === 0
      ? []
      : [{ low: once(0), high: once(1), inclusive: false, step: 1, pushes: outside }];
  let unread: UnreadLoop | undefined;
  let open = nested !== undefined;
  const nest = nestTerms(
    {
      name,
      made,
      r,
      sourceFile,
      diagnostics,
      writesIn: (l) => writes.filter((a) => a.loop === l).length,
      defer: (loop) => {
        unread ??= loop;
      },
      open: () => {
        open = true;
      },
    },
    stub.body,
  );
  if (nest === undefined) return undefined;
  return {
    terms: open ? [] : [...terms, ...nest],
    ...(unread !== undefined ? { unread } : {}),
    ...(open ? { open: true as const } : {}),
  };
}
