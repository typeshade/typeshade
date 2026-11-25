import ts from 'typescript';
import type { LinkedFile, LinkedProgram } from '../link.js';
import { attributeDecoratorsOf } from '../attribute-types.js';
import { stageCallOf } from '../stage-call.js';

function declaresEntry(statement: ts.Statement, name: string): boolean {
  if (stageCallOf(statement)?.declaration.name.text === name) return true;
  if (!ts.isFunctionDeclaration(statement) || statement.name?.text !== name) return false;
  return attributeDecoratorsOf(statement).some((d) => {
    const e = ts.isCallExpression(d.expression) ? d.expression.expression : d.expression;
    return (
      ts.isIdentifier(e) && (e.text === 'vertex' || e.text === 'fragment' || e.text === 'compute')
    );
  });
}

export interface Place {
  readonly file: LinkedFile;
  readonly start: number;
  readonly end: number;
  readonly use: boolean;
}

interface Edge {
  readonly node: ts.ImportDeclaration | ts.ExportDeclaration;
  readonly to: string;
}

export function programEdges(
  linked: LinkedProgram,
  resolve: (from: string, specifier: string) => string | undefined,
): (from: string) => readonly Edge[] {
  const byName = new Map(linked.files.map((f) => [f.name, f]));
  const edges = new Map<string, Edge[]>();
  return (from) => {
    let out = edges.get(from);
    if (out !== undefined) return out;
    out = [];
    edges.set(from, out);
    for (const st of byName.get(from)?.sourceFile.statements ?? []) {
      if (!ts.isImportDeclaration(st) && !ts.isExportDeclaration(st)) continue;
      const specifier = st.moduleSpecifier;
      if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
      const to = resolve(from, specifier.text);
      if (to !== undefined && byName.has(to)) out.push({ node: st, to });
    }
    return out;
  };
}

export function importWays(
  entry: ts.SourceFile,
  linked: LinkedProgram,
  targets: (from: string) => readonly Edge[],
): (file: string, at: number | undefined) => Place[] {
  const byName = new Map(linked.files.map((f) => [f.name, f]));
  const above = new Map<string, string>();
  const queue = [entry.fileName];
  for (let i = 0; i < queue.length; i++) {
    for (const t of targets(queue[i]!)) {
      if (t.to === entry.fileName || above.has(t.to)) continue;
      above.set(t.to, queue[i]!);
      queue.push(t.to);
    }
  }
  const names = (
    from: string,
    name: string,
    file: string,
    entryName: string,
    seen = new Set<string>(),
  ): boolean => {
    if (seen.has(`${from}\u0000${name}`)) return false;
    seen.add(`${from}\u0000${name}`);
    if (from === file && name === entryName) return true;
    for (const t of targets(from)) {
      if (!ts.isExportDeclaration(t.node)) continue;
      const clause = t.node.exportClause;
      if (clause === undefined) {
        if (names(t.to, name, file, entryName, seen)) return true;
      } else if (ts.isNamedExports(clause)) {
        for (const el of clause.elements)
          if (
            el.name.text === name &&
            names(t.to, (el.propertyName ?? el.name).text, file, entryName, seen)
          )
            return true;
      }
    }
    return false;
  };
  return (file, at) => {
    const source = byName.get(file)?.sourceFile;
    const holder =
      at === undefined
        ? undefined
        : source?.statements.find((st) => st.getStart(source) <= at && at < st.getEnd());
    const held =
      holder === undefined
        ? undefined
        : (stageCallOf(holder)?.declaration.name.text ??
          (ts.isFunctionDeclaration(holder) ? holder.name?.text : undefined));
    const entryName =
      holder !== undefined && held !== undefined && declaresEntry(holder, held) ? held : undefined;
    const out: Place[] = [];
    for (let below = file; ;) {
      const upper = above.get(below);
      const upperFile = upper === undefined ? undefined : byName.get(upper);
      if (upper === undefined || upperFile === undefined) return out;
      const into = targets(upper).filter((t) => t.to === below);
      let node: ts.Node | undefined;
      if (entryName !== undefined) {
        for (const t of into) {
          if (!ts.isExportDeclaration(t.node)) continue;
          const clause = t.node.exportClause;
          if (clause === undefined || !ts.isNamedExports(clause)) continue;
          const named = clause.elements.find((el) =>
            names(below, (el.propertyName ?? el.name).text, file, entryName),
          );
          if (named !== undefined) {
            node = named.propertyName ?? named.name;
            break;
          }
        }
      }
      node ??= into[0]!.node.moduleSpecifier!;
      const text = upperFile.sourceFile;
      out.push({ file: upperFile, start: node.getStart(text), end: node.getEnd(), use: false });
      below = upper;
    }
  };
}
