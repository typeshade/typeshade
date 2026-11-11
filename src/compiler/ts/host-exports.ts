// The names a host imports from a `"use typeshade"` file: its exports, read off the syntax. One
// definition for the host face (`host-face.ts`), which gives each its face, and for the front end,
// which keeps the `f32` result the host reads for a function whose calls decide its result
// (Rule 8.19; Amendment A5 of change 0134, "export는 f32 유지").

import ts from 'typescript';

/** A top-level declaration an export can name. */
export type HostDeclared =
  | ts.FunctionDeclaration
  | ts.VariableDeclaration
  | ts.EnumDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.ModuleDeclaration;

/** A name a host imports. */
export interface HostExport {
  /** The name a host imports. */
  readonly name: string;
  /** The declaration it names, when it names one of this file. */
  readonly decl?: HostDeclared;
  /** Why it has no declaration to read, when it has none: a re-export of another module, or a
   *  name this file does not declare. */
  readonly missing?: 'reexport' | 'unknown';
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((m) => m.kind === kind) ??
  false;

export function topLevelDeclarations(sf: ts.SourceFile): Map<string, HostDeclared> {
  const out = new Map<string, HostDeclared>();
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name)) out.set(d.name.text, d);
    } else if (
      (ts.isFunctionDeclaration(s) ||
        ts.isEnumDeclaration(s) ||
        ts.isClassDeclaration(s) ||
        ts.isInterfaceDeclaration(s) ||
        ts.isTypeAliasDeclaration(s) ||
        ts.isModuleDeclaration(s)) &&
      s.name !== undefined &&
      ts.isIdentifier(s.name)
    ) {
      // An overload signature and its implementation share a name; the body wins.
      if (!(ts.isFunctionDeclaration(s) && s.body === undefined)) out.set(s.name.text, s);
    }
  }
  return out;
}

/** The names a host imports from `sf`: an `export` modifier and an `export { … }` clause. The
 *  default export of the host import is the module's manifest (Rule 11.10), so the author's own
 *  has no host face. */
export function hostExportsOf(sf: ts.SourceFile): HostExport[] {
  const local = topLevelDeclarations(sf);
  const out: HostExport[] = [];
  const seen = new Set<string>();
  const add = (r: HostExport): void => {
    if (seen.has(r.name)) return;
    seen.add(r.name);
    out.push(r);
  };
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s)) {
      if (s.moduleSpecifier !== undefined || s.exportClause === undefined) {
        if (s.exportClause !== undefined && ts.isNamedExports(s.exportClause))
          for (const e of s.exportClause.elements) add({ name: e.name.text, missing: 'reexport' });
        continue;
      }
      if (ts.isNamedExports(s.exportClause))
        for (const e of s.exportClause.elements) {
          const localName = (e.propertyName ?? e.name).text;
          const decl = local.get(localName);
          add(decl ? { name: e.name.text, decl } : { name: e.name.text, missing: 'unknown' });
        }
      continue;
    }
    if (ts.isExportAssignment(s)) continue;
    if (!hasModifier(s, ts.SyntaxKind.ExportKeyword)) continue;
    const isDefault = hasModifier(s, ts.SyntaxKind.DefaultKeyword);
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name)) add({ name: d.name.text, decl: d });
      continue;
    }
    if (isDefault) continue;
    const name = (s as { name?: ts.Node }).name;
    if (name !== undefined && ts.isIdentifier(name)) {
      const decl = local.get(name.text);
      add(decl ? { name: name.text, decl } : { name: name.text, missing: 'unknown' });
    }
  }
  return out;
}

const exportedCache = new WeakMap<ts.SourceFile, ReadonlySet<ts.Node>>();

/** The declarations of `sf` a host imports, by any name (`export function g`, `export { g }`,
 *  `export { g as h }`). */
export function hostExportedDeclarations(sf: ts.SourceFile): ReadonlySet<ts.Node> {
  let set = exportedCache.get(sf);
  if (set === undefined) {
    set = new Set(hostExportsOf(sf).flatMap((r) => (r.decl === undefined ? [] : [r.decl])));
    exportedCache.set(sf, set);
  }
  return set;
}
