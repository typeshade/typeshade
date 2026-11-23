// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { FuncDecl, Stmt } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import { eachExpr, eachStmtExpr } from '../../../../core/ir/visit.js';
import { rangeOf, type ForStmt } from '../../../../core/passes/kernel-lower-ir.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { TS_CODES } from '../../codes.js';
import { makeDiagnostic } from '../../diagnostic.js';
import type { GrownTerm, MadeLowering } from './registry.js';
import { hostReadable, notKnown, type Readable } from './readable.js';

export function loopText(loop: ts.IterationStatement, sourceFile: ts.SourceFile): string {
  if (ts.isDoStatement(loop)) return `do … while (${loop.expression.getText(sourceFile)})`;
  return sourceFile.text
    .slice(loop.getStart(sourceFile), loop.statement.getStart(sourceFile))
    .trim();
}

function pushesIn(st: Stmt, param: string): number {
  let count = 0;
  const visit = (s: Stmt): void =>
    eachStmtExpr(
      s,
      (e) =>
        eachExpr(e, (x) => {
          if (
            x.op === 'call' &&
            x.fn === 'push' &&
            x.args[0]?.op === 'param' &&
            x.args[0].name === param
          )
            count++;
        }),
      visit,
    );
  visit(st);
  return count;
}

function counted(loop: ForStmt, pushes: number): GrownTerm | undefined {
  const range = rangeOf(loop);
  if (range === undefined || loop.counted?.op !== 'add') return undefined;
  const t: ShaderType = range.type;
  if (t.kind !== 'scalar' || (t.scalar !== 'u32' && t.scalar !== 'i32')) return undefined;
  const up = range.cop === '<' || range.cop === '<=';
  const [low, high] = up ? [range.start, range.bound] : [range.bound, range.start];
  return {
    low,
    high,
    inclusive: range.cop === '<=' || range.cop === '>=',
    step: Math.abs(loop.counted.step),
    pushes,
  };
}

function loopNodeAt(
  loop: Stmt,
  decl: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
): ts.IterationStatement | undefined {
  const body = decl.parent.parent.parent;
  if (!ts.isBlock(body) || loop.span === undefined) return undefined;
  return body.statements.find(
    (s): s is ts.IterationStatement =>
      ts.isIterationStatement(s, false) && s.getStart(sourceFile) === loop.span!.start,
  );
}

export function grownCapacity(
  stub: FuncDecl,
  made: MadeLowering,
  r: Readable,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): readonly GrownTerm[] | undefined {
  const name = (made.decl.name as ts.Identifier).text;
  const terms: GrownTerm[] = [];
  for (const st of stub.body) {
    if (st.s !== 'for') continue;
    const pushes = pushesIn(st, made.param);
    if (pushes === 0) continue;
    const node = loopNodeAt(st, made.decl, sourceFile);
    const shown = node === undefined ? 'a loop' : `"${loopText(node, sourceFile)}"`;
    const say = (message: string): undefined => {
      diagnostics.push(
        makeDiagnostic(sourceFile, node ?? made.decl, message, TS_CODES.UNSUPPORTED),
      );
      return undefined;
    };
    const term = counted(st, pushes);
    if (term === undefined)
      return say(
        `${shown} pushes onto "${name}", and its trip count is no count from a start to a ` +
          `bound by a constant whole step, so the call cannot reserve room for "${name}" ` +
          `before it runs; that is not supported yet.`,
      );
    const range = rangeOf(st)!;
    if (!hostReadable(range.start, r) || !hostReadable(range.bound, r))
      return say(notKnown(`${shown} pushes onto "${name}", and its start or bound`));
    terms.push(term);
  }
  return terms;
}
