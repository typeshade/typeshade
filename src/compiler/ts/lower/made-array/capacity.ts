// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type ts from 'typescript';
import type { FuncDecl } from '../../../../core/ir/nodes.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { TS_CODES } from '../../codes.js';
import { diagnosticAtSpan } from '../../diagnostic.js';
import { describeRead } from '../../kernel-loops.js';
import { grownAccesses } from './bounds.js';
import { nestTerms, once } from './nest.js';
import type { GrownTerm, MadeLowering } from './registry.js';
import type { Readable } from './readable.js';

export function grownCapacity(
  stub: FuncDecl,
  made: MadeLowering,
  r: Readable,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): readonly GrownTerm[] | undefined {
  const name = (made.decl.name as ts.Identifier).text;
  const writes = grownAccesses(stub.body, made.param).filter(
    (a) => a.mode === 'write' && !a.proven,
  );
  const nested = writes.find(
    (a) => a.loop !== undefined && (a.depth > 1 || !stub.body.includes(a.loop)),
  );
  if (nested !== undefined) {
    const text = describeRead(stub, { first: nested })?.text ?? name;
    diagnostics.push(
      diagnosticAtSpan(
        sourceFile,
        nested.at,
        made.decl,
        `"${text}" writes an element of "${name}" inside a loop that is no for loop at the top ` +
          `level of "${stub.name}", at an index the compiler cannot prove is below its length, ` +
          `and that is not supported yet. Index it by the counter of a loop up to ${name}.length.`,
        TS_CODES.UNSUPPORTED,
        'error',
      ),
    );
    return undefined;
  }
  const outside = writes.filter((a) => a.loop === undefined).length;
  const terms: GrownTerm[] =
    outside === 0
      ? []
      : [{ low: once(0), high: once(1), inclusive: false, step: 1, pushes: outside }];
  const nest = nestTerms(
    {
      name,
      made,
      r,
      sourceFile,
      diagnostics,
      writesIn: (l) => writes.filter((a) => a.loop === l).length,
    },
    stub.body,
  );
  return nest === undefined ? undefined : [...terms, ...nest];
}
