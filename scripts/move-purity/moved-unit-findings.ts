import { dirname } from 'node:path/posix';
import ts from 'typescript';
import { fileClassOf } from './file-class.js';
import { finding, type Finding } from './finding.js';
import type { Side } from './side-program.js';
import { testMoveFindings } from './test-moves.js';
import { isTestCall } from './test-calls.js';
import type { Unit } from './units.js';

function titleOf(node: ts.Statement): string {
  const call = ts.isExpressionStatement(node) ? node.expression : undefined;
  const first = call !== undefined && ts.isCallExpression(call) ? call.arguments[0] : undefined;
  if (first === undefined) return '(untitled)';
  return ts.isStringLiteralLike(first) ? first.text : first.getText(node.getSourceFile());
}

const nameOf = (unit: Unit): string => unit.names.join(', ') || '(unnamed)';

const isRelative = (text: string): boolean => /^\.\.?\//.test(text);

function dynamicSpecifierReason(call: ts.CallExpression): string | undefined {
  const first = call.arguments[0];
  if (first === undefined || !ts.isStringLiteralLike(first)) return 'a dynamic specifier';
  return isRelative(first.text)
    ? `the relative specifier ${JSON.stringify(first.text)}`
    : undefined;
}

export function locationReason(node: ts.Node, directoryChanged: boolean): string | undefined {
  let reason: string | undefined;
  const visit = (current: ts.Node): void => {
    if (reason !== undefined) return;
    if (ts.isMetaProperty(current)) reason = 'import.meta';
    else if (ts.isIdentifier(current) && current.text === '__filename') reason = current.text;
    else if (directoryChanged) {
      if (ts.isIdentifier(current) && current.text === '__dirname') reason = current.text;
      else if (
        ts.isCallExpression(current) &&
        (current.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(current.expression) && current.expression.text === 'require'))
      ) {
        reason = dynamicSpecifierReason(current);
      } else if (
        (ts.isStringLiteralLike(current) ||
          ts.isTemplateHead(current) ||
          ts.isTemplateMiddle(current) ||
          ts.isTemplateTail(current)) &&
        isRelative(current.text)
      ) {
        reason = `the relative path ${JSON.stringify(current.text)}`;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return reason;
}

export function movedUnitFindings(
  moved: readonly (readonly [Unit, Unit])[],
  base: Side,
  head: Side,
  listed: ReadonlySet<string>,
  allowTestMoves: boolean,
): Finding[] {
  const findings: Finding[] = [];
  for (const [from, to] of moved) {
    if (from.path === to.path) continue;
    const at = (kind: string, detail = ''): void => {
      findings.push(finding(kind, to.path, `${nameOf(to)}${detail}`, to.line));
    };
    if (from.path.split('/')[0] !== to.path.split('/')[0]) {
      at('unit moved across top-level directories', ` ${from.path} -> ${to.path}`);
    }
    if (fileClassOf(from.path) !== fileClassOf(to.path)) {
      at('file class changed', ` ${fileClassOf(from.path)} -> ${fileClassOf(to.path)}`);
    }
    if (fileClassOf(to.path) === 'test' && isTestCall(to.node)) {
      if (allowTestMoves) findings.push(...testMoveFindings(from, to, base, head, listed));
      else {
        const detail = `${titleOf(to.node)} (pure moves of tests need --allow-test-moves)`;
        findings.push(finding('test code moved', to.path, detail, to.line));
      }
    }
    const location = locationReason(to.node, dirname(from.path) !== dirname(to.path));
    if (location !== undefined) at('location-dependent unit moved', `: ${location}`);
  }
  return findings;
}
