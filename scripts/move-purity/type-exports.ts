import ts from 'typescript';
import { finding, type Finding } from './finding.js';
import type { Side } from './side-program.js';

function resolved(side: Side, symbol: ts.Symbol): ts.Symbol {
  let current = symbol;
  for (let step = 0; step < 32 && current.flags & ts.SymbolFlags.Alias; step += 1) {
    current = side.checker.getAliasedSymbol(current);
  }
  return current;
}

export function typeReexportFindings(side: Side, paths: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const path of paths) {
    const source = side.sourceOf(path);
    for (const statement of source?.statements ?? []) {
      if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (clause === undefined || !ts.isNamedExports(clause)) continue;
      for (const element of clause.elements) {
        if (element.isTypeOnly) continue;
        const symbol = side.checker.getExportSpecifierLocalTargetSymbol(element);
        const imported =
          symbol !== undefined &&
          (statement.moduleSpecifier || symbol.flags & ts.SymbolFlags.Alias);
        if (!imported) continue;
        const target = resolved(side, symbol);
        const known =
          target.flags !== ts.SymbolFlags.Alias && (target.declarations?.length ?? 0) > 0;
        if (known && (target.flags & ts.SymbolFlags.Value) === 0) {
          findings.push(finding('type re-exported without type path', path, element.name.text));
        }
      }
    }
  }
  return findings;
}
