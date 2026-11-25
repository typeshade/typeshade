import ts from 'typescript';
import type { CompileTsSourceResult } from '../../compiler/ts/source-file.js';
import { abstractConstTableOf } from '../../compiler/ts/symbols.js';
import { spellShaderType } from './spell-type.js';

export function abstractConstLine(
  node: ts.Node,
  defs: readonly ts.DefinitionInfo[],
  uri: string,
  sourceFile: ts.SourceFile,
  analysis: CompileTsSourceResult,
  checker: () => ts.TypeChecker | undefined,
  declaring: CompileTsSourceResult | undefined,
): string | undefined {
  if (!ts.isIdentifier(node) || defs.length === 0) return undefined;
  const declaredIn = (result: CompileTsSourceResult | undefined) =>
    (result === undefined ? undefined : abstractConstTableOf(result.sourceFile))?.decls.find((d) =>
      defs.some((def) => def.fileName === d.fileName && def.textSpan.start === d.start),
    );
  const table = abstractConstTableOf(analysis.sourceFile);
  const decl = declaredIn(analysis) ?? declaredIn(declaring);
  if (decl === undefined) return undefined;
  const name = node.text;
  const start = node.getStart(sourceFile);
  const access =
    ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
      ? node.parent
      : undefined;
  if (decl.fileName !== uri || start !== decl.start) {
    const spans = [node, ...(access !== undefined ? [access] : [])].map((n) => {
      const at = n.getStart(sourceFile);
      return { start: at, length: n.getEnd() - at };
    });
    const read = table?.reads.find((r) =>
      spans.some((s) => s.start === r.start && s.length === r.length),
    );
    if (read?.type != null) {
      const type = spellShaderType(read.type);
      const left = access?.expression;
      const viaImport =
        left !== undefined &&
        (checker()
          ?.getSymbolAtLocation(left)
          ?.declarations?.some((d) => ts.isNamespaceImport(d)) ??
          false);
      const owner =
        left === undefined || viaImport
          ? undefined
          : ts.isPropertyAccessExpression(left)
            ? left.name.text
            : left.getText(sourceFile);
      if (decl.keyword === 'const')
        return owner === undefined ? `const ${name}: ${type}` : `const ${owner}.${name}: ${type}`;
      return owner === undefined
        ? `(property) ${name}: ${type}`
        : `(property) ${owner}.${name}: ${type}`;
    }
  }
  const types = decl.integerWritten ? 'i32, u32, f32 or f64' : 'f32 or f64';
  const parent = node.parent;
  const alias =
    (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) && parent.name === node;
  return `${alias ? '(alias) ' : ''}${decl.keyword} ${name} = ${decl.written} (${types} where it is read)`;
}
