// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import ts from 'typescript';
import type { Expr, FuncDecl, Stmt } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import { boolT, u32T } from '../../../../core/ir/types.js';
import { eachExpr, eachStmtExpr } from '../../../../core/ir/visit.js';
import { rangeOf, type ForStmt } from '../../../../core/passes/kernel-lower-ir.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { TS_CODES } from '../../codes.js';
import { makeDiagnostic } from '../../diagnostic.js';
import type { MadeLowering } from './registry.js';
import { hostReadable, notKnown, type Readable } from './readable.js';

export function loopText(loop: ts.IterationStatement, sourceFile: ts.SourceFile): string {
  if (ts.isDoStatement(loop)) return `do … while (${loop.expression.getText(sourceFile)})`;
  return sourceFile.text
    .slice(loop.getStart(sourceFile), loop.statement.getStart(sourceFile))
    .trim();
}

const u32 = (value: number): Expr => ({ op: 'lit', type: u32T, value });

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

function trips(loop: ForStmt): Expr | undefined {
  const range = rangeOf(loop);
  if (range === undefined || loop.counted?.op !== 'add') return undefined;
  const t: ShaderType = range.type;
  if (t.kind !== 'scalar' || (t.scalar !== 'u32' && t.scalar !== 'i32')) return undefined;
  const lit = (value: number): Expr => ({ op: 'lit', type: t, value });
  const up = range.cop === '<' || range.cop === '<=';
  const [low, high] = up ? [range.start, range.bound] : [range.bound, range.start];
  const inclusive = range.cop === '<=' || range.cop === '>=';
  const sub: Expr = { op: 'binop', type: t, bop: '-', a: high, b: low };
  const span: Expr = inclusive ? { op: 'binop', type: t, bop: '+', a: sub, b: lit(1) } : sub;
  const step = Math.abs(loop.counted.step);
  const count: Expr =
    step === 1
      ? span
      : {
          op: 'binop',
          type: t,
          bop: '/',
          a: { op: 'binop', type: t, bop: '+', a: span, b: lit(step - 1) },
          b: lit(step),
        };
  return {
    op: 'select',
    type: u32T,
    cond: { op: 'compare', type: boolT, cop: inclusive ? '<=' : '<', a: low, b: high },
    ifTrue: t.scalar === 'u32' ? count : { op: 'call', type: u32T, fn: 'u32', args: [count] },
    ifFalse: u32(0),
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
): Expr | undefined {
  const name = (made.decl.name as ts.Identifier).text;
  let total: Expr = u32(0);
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
    const count = trips(st);
    if (count === undefined)
      return say(
        `${shown} pushes onto "${name}", and its trip count is no count from a start to a ` +
          `bound by a constant whole step, so the call cannot reserve room for "${name}" ` +
          `before it runs; that is not supported yet.`,
      );
    const range = rangeOf(st)!;
    if (!hostReadable(range.start, r) || !hostReadable(range.bound, r))
      return say(notKnown(`${shown} pushes onto "${name}", and its start or bound`));
    const each: Expr =
      pushes === 1 ? count : { op: 'binop', type: u32T, bop: '*', a: count, b: u32(pushes) };
    total = total.op === 'lit' ? each : { op: 'binop', type: u32T, bop: '+', a: total, b: each };
  }
  return total;
}
