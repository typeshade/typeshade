import { noteDemand } from '../../use-inference.js';
import { noteFoldedRead } from '../../abstract-const.js';
import ts from 'typescript';
import { logicalTypeKey as typeKey } from '../../optional.js';
import type { Stmt } from '../../../../core/ir/nodes.js';
import type { ShaderType } from '../../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../../source-file.js';
import { authorTypeText, type LoweringScope } from '../../context.js';
import { foldConstNumber } from '../../loop-bound.js';
import { fitsTarget } from '../../lit-coerce.js';
import { keyTypeText, keysOf, sameKeys } from '../../key-types.js';
import { TS_CODES } from '../../codes.js';
import { lowerExpression } from '../expression.js';
import { lowerStatements } from '../statement.js';
import { fallsIntoABody } from '../../fallthrough.js';
import { pushDiag } from '../control.js';

export function lowerSwitch(
  node: ts.SwitchStatement,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt | undefined {
  const scrut = lowerExpression(node.expression, sourceFile, scope, diagnostics);
  if (scrut) noteDemand(scrut, 'int');
  if (!scrut) return undefined;
  const k = typeKey(scrut.type);
  if (k !== 'i32' && k !== 'u32') {
    pushDiag(
      diagnostics,
      sourceFile,
      node.expression,
      `switch scrutinee must be i32 or u32, got ${authorTypeText(scrut.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  const cases: { values: number[]; body: readonly Stmt[] }[] = [];
  const seen = new Set<number>();
  let pending: number[] = [];
  let defaultBody: readonly Stmt[] | undefined;
  let seenDefault = false;
  scope.enterSwitch();
  try {
    const clauses = node.caseBlock.clauses;
    for (const [index, clause] of clauses.entries()) {
      if (ts.isDefaultClause(clause)) {
        if (seenDefault) {
          pushDiag(
            diagnostics,
            sourceFile,
            clause,
            'Duplicate switch default; each switch may have only one default clause.',
            TS_CODES.SWITCH_CASE,
          );
          continue;
        }
        seenDefault = true;
      }
      if (fallsIntoABody(clauses, index)) {
        const isDefault = ts.isDefaultClause(clause);
        pushDiag(
          diagnostics,
          sourceFile,
          isDefault ? (clause.getFirstToken(sourceFile) ?? clause) : clause.expression,
          `${isDefault ? '"default:"' : `switch case ${clause.expression.getText(sourceFile)}`} ` +
            `falls through into the next case: TypeScript runs both bodies, and WGSL runs only ` +
            `this one. End it with "break", or repeat the shared statements in each case.`,
          TS_CODES.SWITCH_CASE,
        );
      }
      if (ts.isDefaultClause(clause)) {
        if (pending.length > 0) {
          pushDiag(
            diagnostics,
            sourceFile,
            clause,
            `switch case ${pending.map(String).join(', ')} sits above "default:" with no body ` +
              `of its own. A case that should do what the default does needs its own body; ` +
              `WGSL has no form for sharing the default's.`,
            TS_CODES.SWITCH_CASE,
          );
          pending = [];
        }
        if (clause.statements.length === 0 && index < clauses.length - 1) {
          pushDiag(
            diagnostics,
            sourceFile,
            clause,
            `"default:" has no body of its own and a clause follows it. In TypeScript it runs ` +
              `that clause's body; on both targets it runs nothing. Give the default its own ` +
              `body, or move it below the clause it should share.`,
            TS_CODES.SWITCH_CASE,
          );
          continue;
        }
        defaultBody = caseBody(clause.statements, sourceFile, scope, diagnostics);
        continue;
      }
      const value = caseValue(clause, k, scrut.type, sourceFile, scope, diagnostics);
      if (value === undefined) continue;
      if (seen.has(value)) {
        pushDiag(
          diagnostics,
          sourceFile,
          clause.expression,
          `Duplicate switch case ${String(value)}; each label may appear once.`,
          TS_CODES.SWITCH_CASE,
        );
        if (clause.statements.length > 0) pending = [];
        continue;
      }
      seen.add(value);
      if (clause.statements.length === 0) {
        pending.push(value);
        continue;
      }
      cases.push({
        values: [...pending, value],
        body: caseBody(clause.statements, sourceFile, scope, diagnostics),
      });
      pending = [];
    }
  } finally {
    scope.exitSwitch();
  }
  if (pending.length > 0) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `switch case ${pending.map(String).join(', ')} has no body: an empty case shares the ` +
        `body of the case below it, and there is none. Give it a body, or delete it.`,
      TS_CODES.SWITCH_CASE,
    );
  }
  return { s: 'switch', scrut, cases, defaultBody };
}

function caseValue(
  clause: ts.CaseClause,
  scrutKind: string,
  scrutType: ShaderType,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): number | undefined {
  const keys = keysOf(scrutType);
  const expr = lowerExpression(
    clause.expression,
    sourceFile,
    scope,
    diagnostics,
    keys !== undefined ? scrutType : undefined,
  );
  if (!expr) return undefined;
  const labelKeys = keysOf(expr.type);
  if (keys !== undefined && (labelKeys === undefined || !sameKeys(keys, labelKeys))) {
    pushDiag(
      diagnostics,
      sourceFile,
      clause.expression,
      `The switch is over ${keyTypeText(keys)}, so each case is one of its members, written ` +
        `as a string.`,
      TS_CODES.SWITCH_CASE,
    );
    return undefined;
  }
  if (keys === undefined && labelKeys !== undefined) {
    pushDiag(
      diagnostics,
      sourceFile,
      clause.expression,
      `A case of ${keyTypeText(labelKeys)} labels a switch over a number, and the two have no ` +
        `value in common.`,
      TS_CODES.SWITCH_CASE,
    );
    return undefined;
  }
  const value = foldConstNumber(expr, scope);
  if (value === undefined || !Number.isInteger(value)) {
    pushDiag(
      diagnostics,
      sourceFile,
      clause.expression,
      'switch case must be an integer constant: a literal or a module const.',
      TS_CODES.SWITCH_CASE,
    );
    return undefined;
  }
  if (!fitsTarget(value, scrutType)) {
    pushDiag(
      diagnostics,
      sourceFile,
      clause.expression,
      `switch case ${String(value)} does not fit a ${scrutKind} selector.`,
      TS_CODES.SWITCH_CASE,
    );
    return undefined;
  }
  if (scrutType.kind === 'scalar') noteFoldedRead(clause.expression, scrutType);
  return value;
}

function caseBody(
  statements: readonly ts.Statement[],
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Stmt[] {
  const body = lowerStatements(statements, sourceFile, scope, diagnostics);
  if (body.length > 0 && body[body.length - 1]!.s === 'break') body.pop();
  return body;
}
