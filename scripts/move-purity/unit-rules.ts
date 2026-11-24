import ts from 'typescript';
import { isInertUnit } from './inert.js';
import { dirname } from 'node:path/posix';
import { finding, type Finding } from './findings.js';
import type { Keyer } from './binding-keys.js';
import { refOf } from './compare-units.js';
import type { Side } from './side-program.js';
import { isTestCall, testMoveFindings } from './test-moves.js';
import type { Unit } from './units.js';

export const fileClassOf = (path: string): string => {
  if (path.endsWith('.shade.ts')) return 'shade';
  if (path.endsWith('.test.ts')) return 'test';
  if (path.endsWith('.d.ts')) return 'dts';
  return 'source';
};

const nameOf = (unit: Unit): string => unit.names.join(', ') || '(unnamed)';

function locationReason(node: ts.Node): string | undefined {
  let reason: string | undefined;
  const visit = (current: ts.Node): void => {
    if (reason !== undefined) return;
    if (ts.isMetaProperty(current)) reason = 'import.meta';
    else if (ts.isIdentifier(current) && /^__(?:dirname|filename)$/.test(current.text)) {
      reason = current.text;
    } else if (
      ts.isCallExpression(current) &&
      current.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      reason = 'dynamic import';
    } else if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === 'require'
    ) {
      reason = 'require';
    } else if (
      (ts.isStringLiteralLike(current) ||
        ts.isTemplateHead(current) ||
        ts.isTemplateMiddle(current) ||
        ts.isTemplateTail(current)) &&
      /^\.\.?\//.test(current.text)
    ) {
      reason = `the relative path ${JSON.stringify(current.text)}`;
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
): Finding[] {
  const findings: Finding[] = [];
  for (const [from, to] of moved) {
    if (from.path === to.path) continue;
    const at = (kind: string, detail = ''): void => {
      findings.push(finding(kind, to.path, `${nameOf(to)}${detail}`, to.line));
    };
    if (fileClassOf(from.path) !== fileClassOf(to.path)) {
      at('file class changed', ` ${fileClassOf(from.path)} -> ${fileClassOf(to.path)}`);
    }
    if (fileClassOf(to.path) === 'test' && isTestCall(to.node)) {
      findings.push(...testMoveFindings(from, to, base, head));
    } else if (!isInertUnit(to.node)) at('active unit moved');
    if (dirname(from.path) !== dirname(to.path)) {
      const reason = locationReason(to.node);
      if (reason !== undefined) at('location-dependent unit moved', `: ${reason}`);
    }
  }
  return findings;
}

const REBOUND_CAP = 5;

export function reboundFindings(
  pairs: readonly (readonly [Unit, Unit])[],
  baseKeyer: Keyer,
  headKeyer: Keyer,
): Finding[] {
  const findings: Finding[] = [];
  for (const [from, to] of pairs) {
    const before = baseKeyer.unitBindings(from);
    const after = headKeyer.unitBindings(to);
    const length = Math.max(before.keys.length, after.keys.length);
    const differing = Array.from({ length }, (_, i) => i).filter(
      (i) => before.keys[i] !== after.keys[i],
    );
    if (differing.length === 0) continue;
    const parts = differing
      .slice(0, REBOUND_CAP)
      .map(
        (i) =>
          `${before.texts[i] ?? '?'} base ${before.keys[i] ?? 'none'} head ${after.keys[i] ?? 'none'}`,
      );
    if (differing.length > REBOUND_CAP) parts.push(`and ${differing.length - REBOUND_CAP} more`);
    const ref = refOf(to);
    findings.push(
      finding(
        'rebound',
        ref.path,
        `${ref.names.join(', ') || '(unnamed)'}: ${parts.join('; ')}`,
        ref.line,
      ),
    );
  }
  return findings;
}
