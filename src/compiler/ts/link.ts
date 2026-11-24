// Implements: Rule 3.9, Rule 3.2 (docs/language-design.md; traced in reqs/).

import ts from 'typescript';
import { declaresEntry, stageCallOf } from './stage-call.js';
import { GLSL_ES300_RESERVED, WGSL_RESERVED } from '../../core/reserved-words.js';
import { TS_CODES } from './codes.js';
import { makeDiagnostic, syntaxDiagnostics } from './diagnostic.js';
import { findUseTypeshadeDirective, isUseTypeshadeDirective } from './directive.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import {
  normalizeSourcePath,
  isRelativeSpecifier,
  packageKey,
  packageOf,
  resolveRelativeSpecifier,
  resolveSpecifier,
  type Resolution,
} from './specifier.js';
import { unknownNameSentence } from './unknown-names.js';

export interface ImportHooks {
  readonly readDocument?: (fileName: string) => string | undefined;
  readonly resolveImport?: (fromFile: string, specifier: string) => string | undefined;
}

export function hasModuleReference(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (s) =>
      ts.isImportDeclaration(s) ||
      (ts.isExportDeclaration(s) && s.moduleSpecifier !== undefined) ||
      (ts.isImportEqualsDeclaration(s) && ts.isExternalModuleReference(s.moduleReference)),
  );
}

export interface LinkedFile {
  readonly name: string;
  readonly sourceFile: ts.SourceFile;
  readonly kept: boolean;
}

export interface LinkedExport {
  readonly name: string;
  readonly emitted: string;
  readonly file: string;
}

export interface MappedSpan {
  readonly file: LinkedFile;
  readonly start: number;
  readonly end: number;
}

export interface LinkedProgram {
  readonly fatal: boolean;
  readonly diagnostics: readonly TsCompilerDiagnostic[];
  readonly fileName: string;
  readonly source: string;
  readonly files: readonly LinkedFile[];
  readonly exports: readonly LinkedExport[];
  map(start: number, end: number): MappedSpan | undefined;
  readonly silenced: readonly SilencedUse[];
}

export interface SilencedUse {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly name: string;
}

export interface LinkRoot {
  readonly fileName: string;
  readonly text: string;
}

interface ProgramFile {
  readonly name: string;
  readonly sf: ts.SourceFile;
  readonly root: boolean;
  readonly pkg: string | undefined;
  readonly imports: ProgramFile[];
}

interface Unit {
  readonly file: ProgramFile;
  readonly stmt: ts.Statement;
  readonly names: readonly ts.Identifier[];
  readonly fixedName: 'entry point' | 'binding' | 'override' | undefined;
  readonly refs: Set<Unit>;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface Piece {
  readonly at: number;
  readonly length: number;
  readonly file: ProgramFile | undefined;
  readonly from: number;
  readonly anchor?: { readonly start: number; readonly end: number };
}

const ENTRY_DECORATORS = new Set(['vertex', 'fragment', 'compute']);

const isRefused = (d: TsCompilerDiagnostic): boolean => d.code === TS_CODES.IMPORT;

function wordOf(text: string): string {
  const word = text.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '');
  if (word === '') return 'module';
  return /^[0-9]/.test(word) ? `m${word}` : word;
}

function stemOf(file: Pick<ProgramFile, 'name' | 'pkg'>): string {
  const base = file.name
    .slice(file.name.lastIndexOf('/') + 1)
    .replace(/(\.shade)?\.[mc]?tsx?$/, '');
  return file.pkg === undefined ? wordOf(base) : `${wordOf(file.pkg)}_${wordOf(base)}`;
}

function beginsWithDirective(fileName: string, text: string): boolean {
  const probe = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  return findUseTypeshadeDirective(probe) !== undefined;
}

function pureAliasSpecifier(sf: ts.SourceFile): string | undefined {
  const [directive, star] = sf.statements;
  return sf.statements.length === 2 &&
    directive !== undefined &&
    isUseTypeshadeDirective(directive) &&
    star !== undefined &&
    ts.isExportDeclaration(star) &&
    !star.isTypeOnly &&
    star.exportClause === undefined &&
    star.attributes === undefined &&
    star.assertClause === undefined &&
    star.moduleSpecifier !== undefined &&
    ts.isStringLiteral(star.moduleSpecifier)
    ? star.moduleSpecifier.text
    : undefined;
}

function shownPath(file: string): string {
  const at = file.indexOf('node_modules/');
  return at > 0 && file[at - 1] !== '/' ? file : at >= 0 ? file.slice(at) : file;
}

function topStatementOf(node: ts.Node): ts.Statement | undefined {
  let n: ts.Node = node;
  while (n.parent !== undefined && !ts.isSourceFile(n.parent)) n = n.parent;
  return n.parent !== undefined && ts.isSourceFile(n.parent) ? (n as ts.Statement) : undefined;
}

function isTopLevelDeclaration(decl: ts.Node): boolean {
  if (ts.isVariableDeclaration(decl) || ts.isBindingElement(decl)) {
    const stmt = topStatementOf(decl);
    return stmt !== undefined && ts.isVariableStatement(stmt);
  }
  return decl.parent !== undefined && ts.isSourceFile(decl.parent);
}

function declaredNames(stmt: ts.Statement): ts.Identifier[] {
  if (
    (ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt) ||
      ts.isModuleDeclaration(stmt)) &&
    stmt.name !== undefined &&
    ts.isIdentifier(stmt.name)
  ) {
    return [stmt.name];
  }
  if (ts.isVariableStatement(stmt)) {
    const out: ts.Identifier[] = [];
    const visit = (name: ts.BindingName): void => {
      if (ts.isIdentifier(name)) out.push(name);
      else for (const e of name.elements) if (!ts.isOmittedExpression(e)) visit(e.name);
    };
    for (const d of stmt.declarationList.declarations) visit(d.name);
    return out;
  }
  return [];
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);

function fixedNameOf(stmt: ts.Statement): Unit['fixedName'] {
  if (ts.isFunctionDeclaration(stmt)) {
    // Why: a decorator on a function declaration is not TypeScript's grammar, so the parser
    // leaves it among the modifiers rather than where `getDecorators` looks.
    for (const m of stmt.modifiers ?? []) {
      if (!ts.isDecorator(m)) continue;
      const e = ts.isCallExpression(m.expression) ? m.expression.expression : m.expression;
      if (ts.isIdentifier(e) && ENTRY_DECORATORS.has(e.text)) return 'entry point';
    }
    return undefined;
  }
  if (!ts.isVariableStatement(stmt)) return undefined;
  const stage = stageCallOf(stmt);
  if (stage !== undefined) return declaresEntry(stage.callee) ? 'entry point' : undefined;
  const declared = hasModifier(stmt, ts.SyntaxKind.DeclareKeyword);
  for (const d of stmt.declarationList.declarations) {
    const t = d.type;
    if (
      t !== undefined &&
      ts.isTypeReferenceNode(t) &&
      ts.isIdentifier(t.typeName) &&
      t.typeName.text === 'override'
    ) {
      return 'override';
    }
    const init = d.initializer;
    if (
      init !== undefined &&
      ts.isCallExpression(init) &&
      ts.isIdentifier(init.expression) &&
      (init.expression.text === 'uniform' || init.expression.text === 'storage')
    ) {
      return 'binding';
    }
    const brand =
      t !== undefined && ts.isTypeOperatorNode(t) && t.operator === ts.SyntaxKind.UniqueKeyword;
    if (declared && t !== undefined && !brand) return 'binding';
  }
  return undefined;
}

function isUse(id: ts.Identifier): boolean {
  const p = id.parent;
  if (p === undefined) return false;
  if (ts.isPropertyAccessExpression(p)) return p.name !== id;
  if (ts.isQualifiedName(p)) return p.right !== id;
  if (ts.isShorthandPropertyAssignment(p)) return true;
  if (ts.isBindingElement(p)) return p.name !== id && p.propertyName !== id;
  if (
    ts.isPropertyAssignment(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isPropertySignature(p) ||
    ts.isMethodDeclaration(p) ||
    ts.isMethodSignature(p) ||
    ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p) ||
    ts.isEnumMember(p) ||
    ts.isParameter(p) ||
    ts.isVariableDeclaration(p) ||
    ts.isFunctionDeclaration(p) ||
    ts.isFunctionExpression(p) ||
    ts.isClassDeclaration(p) ||
    ts.isClassExpression(p) ||
    ts.isInterfaceDeclaration(p) ||
    ts.isTypeAliasDeclaration(p) ||
    ts.isEnumDeclaration(p) ||
    ts.isModuleDeclaration(p) ||
    ts.isTypeParameterDeclaration(p) ||
    ts.isImportSpecifier(p) ||
    ts.isExportSpecifier(p) ||
    ts.isNamespaceImport(p) ||
    ts.isNamespaceExport(p) ||
    ts.isImportClause(p) ||
    ts.isImportEqualsDeclaration(p) ||
    ts.isLabeledStatement(p) ||
    ts.isBreakOrContinueStatement(p)
  ) {
    return (p as { name?: ts.Node }).name !== id;
  }
  return true;
}

function identifiersIn(node: ts.Node, out: ts.Identifier[] = []): ts.Identifier[] {
  if (ts.isIdentifier(node)) out.push(node);
  ts.forEachChild(node, (child) => void identifiersIn(child, out));
  return out;
}

function suggestedFile(specifier: string): string {
  const last = specifier.split('/').filter(Boolean).pop() ?? specifier;
  const stem = last
    .replace(/^[@#]/, '')
    .replace(/\.[mc]?[jt]sx?$/, '')
    .replace(/\.shade$/, '');
  return `./${stem}.shade.ts`;
}

export function linkProgram(roots: readonly LinkRoot[], hooks: ImportHooks): LinkedProgram {
  const diagnostics: TsCompilerDiagnostic[] = [];
  const refuse = (sf: ts.SourceFile, node: ts.Node, message: string): void => {
    diagnostics.push(makeDiagnostic(sf, node, message, TS_CODES.IMPORT));
  };
  let fatal = false;

  const files = new Map<string, ProgramFile>();
  const order: ProgramFile[] = [];
  const resolved = new Map<string, string>();
  const refusedImports = new Set<ts.Node>();
  const notShader = new Set<string>();

  const manifests = new Map<string, string | undefined>();
  const readDocument = hooks.readDocument;
  const read =
    readDocument === undefined
      ? undefined
      : (fileName: string): string | undefined => {
          if (fileName !== 'package.json' && !fileName.endsWith('/package.json')) {
            return readDocument(fileName);
          }
          if (!manifests.has(fileName)) manifests.set(fileName, readDocument(fileName));
          return manifests.get(fileName);
        };
  const byPackageKey = new Map<string, ProgramFile>();

  const parse = (
    fileName: string,
    text: string,
    root: boolean,
    pkg: string | undefined = undefined,
  ): ProgramFile => {
    const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const file: ProgramFile = { name: fileName, sf, root, pkg, imports: [] };
    files.set(fileName, file);
    order.push(file);
    const syntax = syntaxDiagnostics(sf);
    if (syntax.length > 0) {
      diagnostics.push(...syntax);
      fatal = true;
    }
    return file;
  };

  const suggestedModule = (r: Extract<Resolution, { kind: 'no-main' }>): string | undefined => {
    const candidates = [
      ...(r.main === undefined ? [] : [r.main]),
      'index.shade.ts',
      'src/index.shade.ts',
    ];
    for (const candidate of candidates) {
      const file = resolveRelativeSpecifier(
        `${r.root}package.json`,
        `./${candidate.replace(/^\.\//, '')}`,
      );
      if (file === undefined || !file.startsWith(r.root)) continue;
      const text = read?.(file);
      if (text !== undefined && beginsWithDirective(file, text)) {
        return `${r.name}/${file.slice(r.root.length)}`;
      }
    }
    return undefined;
  };

  const refusal = (specifier: string, r: Exclude<Resolution, { kind: 'file' }>): string => {
    switch (r.kind) {
      case 'import-map':
        return (
          `"${specifier}" names a package's own import map, which a shader module does not ` +
          `read. Import the file by a relative path.`
        );
      case 'not-a-name':
        return (
          `"${specifier}" is not a relative path or a package name. A shader module imports a ` +
          `file of its program by a relative path, such as "${suggestedFile(specifier)}", or a ` +
          `package by its name.`
        );
      case 'no-package':
        return read === undefined
          ? `"${specifier}" was not read: this compile has no readDocument. Pass compile() a ` +
              `readDocument that returns the file's text.`
          : `Cannot find the package "${r.name}" (looked in node_modules from "${r.from}" up).`;
      case 'not-exported':
        return (
          `"${r.name}" does not export "${r.subpath}": its package.json "exports" names no ` +
          `module for it.`
        );
      case 'no-main': {
        const example = suggestedModule(r);
        return (
          `"${r.name}" has no module to import by its name alone: its package.json has no ` +
          `"exports". ` +
          (example === undefined
            ? `Import one of its files by its path in the package, "${r.name}/<path>".`
            : `Import one of its files, such as "${example}".`)
        );
      }
    }
  };

  const follow = (
    from: ProgramFile,
    at: ts.Node,
    specifier: string,
    declaration: ts.Node,
  ): ProgramFile | undefined => {
    const fail = (message: string): undefined => {
      refuse(from.sf, at, message);
      refusedImports.add(declaration);
      return undefined;
    };
    let target: string | undefined;
    if (hooks.resolveImport === undefined) {
      const resolution = resolveSpecifier(from.name, specifier, read);
      if (resolution.kind !== 'file') return fail(refusal(specifier, resolution));
      target = resolution.file;
    } else {
      target = hooks.resolveImport(from.name, specifier);
      if (target === undefined) {
        const resolution = resolveSpecifier(from.name, specifier, read);
        return fail(
          resolution.kind === 'file'
            ? `Cannot find the shader module "${specifier}".`
            : refusal(specifier, resolution),
        );
      }
    }
    target = normalizeSourcePath(target);
    const pkg = packageOf(target, read);
    const key = pkg === undefined ? undefined : packageKey(pkg);
    const known = files.get(target) ?? (key === undefined ? undefined : byPackageKey.get(key));
    if (known !== undefined) {
      resolved.set(`${from.name}\0${specifier}`, known.name);
      return known;
    }
    const viaPackage = !isRelativeSpecifier(specifier);
    const notAShader = (): undefined =>
      fail(
        viaPackage
          ? `"${specifier}" resolves to "${shownPath(target)}", which does not begin with ` +
              `"use typeshade". A package publishes its shader modules under the "typeshade" ` +
              `condition of "exports".`
          : `"${specifier}" is not a shader module: it does not begin with "use typeshade". A ` +
              `shader module imports only another shader module.`,
      );
    if (notShader.has(target)) return notAShader();
    if (read === undefined) {
      return fail(
        `"${specifier}" was not read: this compile has no readDocument. Pass compile() a ` +
          `readDocument that returns the file's text.`,
      );
    }
    const text = read(target);
    if (text === undefined) {
      return fail(
        `Cannot find the shader module "${specifier}" (looked for "${viaPackage ? shownPath(target) : target}").`,
      );
    }
    if (!beginsWithDirective(target, text)) {
      notShader.add(target);
      return notAShader();
    }
    const file = parse(target, text, false, pkg?.name);
    if (key !== undefined) byPackageKey.set(key, file);
    resolved.set(`${from.name}\0${specifier}`, target);
    visit(file);
    return file;
  };

  const visit = (file: ProgramFile): void => {
    for (const s of file.sf.statements) {
      if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
        const specifier = s.moduleSpecifier.text;
        const clause = s.importClause;
        if (clause === undefined) {
          refuse(
            file.sf,
            s,
            `This import names nothing, and importing a shader module does nothing else. ` +
              `Import the names you use: import { name } from "${specifier}".`,
          );
          refusedImports.add(s);
          continue;
        }
        if (clause.name !== undefined) {
          refuse(
            file.sf,
            clause.name,
            `A shader module has no default export. Import the names you use: ` +
              `import { name } from "${specifier}".`,
          );
          if (clause.namedBindings === undefined) {
            refusedImports.add(s);
            continue;
          }
        }
        const target = follow(file, s.moduleSpecifier, specifier, s);
        if (target !== undefined) file.imports.push(target);
      } else if (
        ts.isExportDeclaration(s) &&
        s.moduleSpecifier !== undefined &&
        ts.isStringLiteral(s.moduleSpecifier)
      ) {
        const target = follow(file, s.moduleSpecifier, s.moduleSpecifier.text, s);
        if (target !== undefined) file.imports.push(target);
      } else if (
        ts.isImportEqualsDeclaration(s) &&
        ts.isExternalModuleReference(s.moduleReference)
      ) {
        const e = s.moduleReference.expression;
        const specifier = ts.isStringLiteral(e) ? e.text : 'the file';
        refuse(
          file.sf,
          s,
          `A shader module is imported by an import declaration at the top of the file: ` +
            `import { name } from "${specifier}".`,
        );
        refusedImports.add(s);
      }
    }
  };

  for (const root of roots) {
    const fileName = normalizeSourcePath(root.fileName);
    if (!files.has(fileName)) parse(fileName, root.text, true);
  }
  for (const file of [...order]) if (file.root) visit(file);

  const entry = order[0]!;
  const whole = new Set(order.filter((f) => f.root));
  let aliasTarget: ProgramFile | undefined;
  let alias = entry;
  const aliases = new Set<ProgramFile>();
  while (!aliases.has(alias)) {
    aliases.add(alias);
    const specifier = pureAliasSpecifier(alias.sf);
    if (specifier === undefined) {
      if (alias !== entry) {
        aliasTarget = alias;
        whole.add(alias);
      }
      break;
    }
    const name = resolved.get(`${alias.name}\0${specifier}`);
    const target = name === undefined ? undefined : files.get(name);
    if (target === undefined) break;
    alias = target;
  }
  const linkedFileName = `${entry.name}.linked.ts`;
  const linkedFiles = (kept: ReadonlySet<ProgramFile>): LinkedFile[] =>
    order.map((f) => ({ name: f.name, sourceFile: f.sf, kept: kept.has(f) }));
  if (fatal) {
    return {
      fatal,
      diagnostics,
      fileName: linkedFileName,
      source: '',
      files: linkedFiles(new Set()),
      exports: [],
      map: () => undefined,
      silenced: [],
    };
  }

  const byName = new Map<string, ts.SourceFile>();
  for (const f of order) byName.set(f.name, f.sf);
  const lookup = (name: string): ts.SourceFile | undefined =>
    byName.get(name) ?? byName.get(name.replace(/\\/g, '/'));
  const host: ts.CompilerHost = {
    getSourceFile: (name) => lookup(name),
    getDefaultLibFileName: () => 'typeshade-no-lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => '',
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => lookup(name) !== undefined,
    readFile: (name) => lookup(name)?.text,
    resolveModuleNameLiterals: (literals, containingFile) =>
      literals.map((literal) => {
        const target = resolved.get(`${containingFile}\0${literal.text}`);
        return target === undefined
          ? { resolvedModule: undefined }
          : {
              resolvedModule: {
                resolvedFileName: target,
                extension: ts.Extension.Ts,
                isExternalLibraryImport: false,
              },
            };
      }),
  };
  const program = ts.createProgram({
    rootNames: order.map((f) => f.name),
    options: {
      noLib: true,
      noEmit: true,
      types: [],
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      experimentalDecorators: true,
    },
    host,
  });
  const checker = program.getTypeChecker();
  const fileOfSf = new Map<ts.SourceFile, ProgramFile>();
  for (const f of order) fileOfSf.set(program.getSourceFile(f.name) ?? f.sf, f);
  for (const f of order) fileOfSf.set(f.sf, f);

  const resolveAlias = (symbol: ts.Symbol): ts.Symbol | undefined => {
    if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
    const target = checker.getAliasedSymbol(symbol);
    const decl = target.declarations?.[0];
    if (decl === undefined) return undefined;
    if (!fileOfSf.has(decl.getSourceFile())) return undefined;
    return target;
  };
  const isModuleSymbol = (symbol: ts.Symbol): boolean =>
    symbol.declarations?.some((d) => ts.isSourceFile(d)) ?? false;

  const units: Unit[] = [];
  const unitOfStatement = new Map<ts.Statement, Unit>();
  for (const f of order) {
    for (const stmt of f.sf.statements) {
      const names = declaredNames(stmt);
      if (names.length === 0) continue;
      const unit: Unit = { file: f, stmt, names, fixedName: fixedNameOf(stmt), refs: new Set() };
      units.push(unit);
      unitOfStatement.set(stmt, unit);
    }
  }
  const overloadsOf = new Map<Unit, readonly Unit[]>();
  {
    const groups = new Map<string, Unit[]>();
    for (const u of units) {
      if (!ts.isFunctionDeclaration(u.stmt) || u.names.length !== 1) continue;
      const k = `${u.file.name}\0${u.names[0]!.text}`;
      groups.set(k, [...(groups.get(k) ?? []), u]);
    }
    for (const group of groups.values()) {
      for (const u of group) {
        overloadsOf.set(u, group);
        for (const other of group) if (other !== u) u.refs.add(other);
      }
    }
  }
  const unitsOf = (symbol: ts.Symbol): Unit[] => {
    const out: Unit[] = [];
    for (const d of symbol.declarations ?? []) {
      const stmt = topStatementOf(d);
      const u = stmt === undefined ? undefined : unitOfStatement.get(stmt);
      if (u !== undefined && !out.includes(u)) out.push(u);
    }
    return out;
  };
  const topNameOf = (symbol: ts.Symbol): { unit: Unit; name: string } | undefined => {
    for (const d of symbol.declarations ?? []) {
      if (!isTopLevelDeclaration(d)) continue;
      const stmt = topStatementOf(d);
      const unit = stmt === undefined ? undefined : unitOfStatement.get(stmt);
      const name = (d as { name?: ts.Node }).name;
      if (unit !== undefined && name !== undefined && ts.isIdentifier(name)) {
        return { unit, name: name.text };
      }
    }
    return undefined;
  };

  const silenced: SilencedUse[] = [];
  const silence = (f: ProgramFile, id: ts.Identifier): void => {
    silenced.push({ file: f.name, start: id.getStart(f.sf), end: id.getEnd(), name: id.text });
  };
  const deadAliases = new Set<ts.Symbol>();
  for (const f of order) {
    for (const s of f.sf.statements) {
      if (!ts.isImportDeclaration(s) || s.importClause === undefined) continue;
      const clause = s.importClause;
      const bound: ts.Identifier[] = [];
      if (clause.name !== undefined) bound.push(clause.name);
      const nb = clause.namedBindings;
      if (nb !== undefined) {
        if (ts.isNamespaceImport(nb)) bound.push(nb.name);
        else for (const e of nb.elements) bound.push(e.name);
      }
      const whole = refusedImports.has(s);
      for (const id of bound) {
        const sym = checker.getSymbolAtLocation(id);
        if (sym === undefined) continue;
        if (whole || id === clause.name) deadAliases.add(sym);
      }
    }
  }

  const exportedNames = (moduleSpecifier: ts.Expression): string[] => {
    const moduleSymbol = checker.getSymbolAtLocation(moduleSpecifier);
    if (moduleSymbol === undefined) return [];
    return checker
      .getExportsOfModule(moduleSymbol)
      .map((e) => e.name)
      .filter((n) => n !== 'default');
  };
  for (const f of order) {
    for (const s of f.sf.statements) {
      let specifiers: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[] = [];
      let moduleSpecifier: ts.Expression | undefined;
      if (
        ts.isImportDeclaration(s) &&
        !refusedImports.has(s) &&
        s.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(s.importClause.namedBindings)
      ) {
        specifiers = s.importClause.namedBindings.elements;
        moduleSpecifier = s.moduleSpecifier;
      } else if (
        ts.isExportDeclaration(s) &&
        !refusedImports.has(s) &&
        s.moduleSpecifier !== undefined &&
        s.exportClause !== undefined &&
        ts.isNamedExports(s.exportClause)
      ) {
        specifiers = s.exportClause.elements;
        moduleSpecifier = s.moduleSpecifier;
      }
      if (moduleSpecifier === undefined || specifiers.length === 0) continue;
      const exported = exportedNames(moduleSpecifier);
      const specText = (moduleSpecifier as ts.StringLiteral).text;
      const targetFile = files.get(resolved.get(`${f.name}\0${specText}`) ?? '');
      for (const spec of specifiers) {
        const imported = (spec.propertyName ?? spec.name).text;
        if (exported.includes(imported)) continue;
        const declaresIt =
          targetFile?.sf.statements.some((t) =>
            declaredNames(t).some((n) => n.text === imported),
          ) ?? false;
        refuse(
          f.sf,
          spec.propertyName ?? spec.name,
          declaresIt
            ? `"${specText}" declares "${imported}" and does not export it. Export it there, or ` +
                `declare what you need in this file.`
            : unknownNameSentence(`"${specText}" has no export "${imported}".`, imported, [
                exported,
              ]),
        );
        const sym = checker.getSymbolAtLocation(spec.name);
        if (sym !== undefined) deadAliases.add(sym);
      }
    }
  }

  const isArraySize = (id: ts.Identifier): boolean => {
    const size = id.parent;
    const arrayType = size.parent;
    return (
      ts.isTypeReferenceNode(arrayType) &&
      ts.isIdentifier(arrayType.typeName) &&
      arrayType.typeName.text === 'array' &&
      arrayType.typeArguments?.[1] === size
    );
  };
  const moduleValues = new Map<ProgramFile, Map<string, ts.Symbol>>();
  const importsTypeOnly = (symbol: ts.Symbol, seen = new Set<ts.Symbol>()): boolean => {
    if ((symbol.flags & ts.SymbolFlags.Alias) === 0 || seen.has(symbol)) return false;
    seen.add(symbol);
    const decl = symbol.declarations?.[0];
    if (decl === undefined) return false;
    if (ts.isTypeOnlyImportOrExportDeclaration(decl)) return true;
    // Why: `import { N } from "./c"` and `export { N } from "./c"` name a module, whose export
    // of `N` may come through an `export *`, which leaves no alias symbol to walk.
    const spec = ts.isImportSpecifier(decl) || ts.isExportSpecifier(decl) ? decl : undefined;
    const from =
      spec === undefined
        ? undefined
        : ts.isImportSpecifier(spec)
          ? spec.parent.parent.parent.moduleSpecifier
          : spec.parent.parent.moduleSpecifier;
    if (spec === undefined || from === undefined) {
      const next = checker.getImmediateAliasedSymbol(symbol);
      return next !== undefined && importsTypeOnly(next, seen);
    }
    const module = checker.getSymbolAtLocation(from);
    const name = (spec.propertyName ?? spec.name).text;
    return module !== undefined && exportedTypeOnly(module, name, seen) === true;
  };
  const exportedTypeOnly = (
    module: ts.Symbol,
    name: string,
    seen: Set<ts.Symbol>,
  ): boolean | undefined => {
    if (seen.has(module)) return true;
    seen.add(module);
    const own = module.exports?.get(ts.escapeLeadingUnderscores(name));
    if (own !== undefined) return importsTypeOnly(own, seen);
    let typeOnly: boolean | undefined;
    const sf = module.declarations?.find(ts.isSourceFile);
    for (const st of sf?.statements ?? []) {
      if (!ts.isExportDeclaration(st) || st.exportClause !== undefined) continue;
      const target = st.moduleSpecifier && checker.getSymbolAtLocation(st.moduleSpecifier);
      if (target === undefined) continue;
      if (!checker.getExportsOfModule(target).some((e) => e.name === name)) continue;
      const via = st.isTypeOnly ? true : exportedTypeOnly(target, name, seen);
      if (via === false) return false;
      if (via === true) typeOnly = true;
    }
    return typeOnly;
  };
  const sizeValueOf = (
    f: ProgramFile,
    id: ts.Identifier,
  ): { unit: Unit; name: string } | 'refused' | undefined => {
    let values = moduleValues.get(f);
    if (values === undefined) {
      values = new Map();
      // Why: an import's binding is an alias, which `getSymbolsInScope` lists only when asked for.
      const flags = ts.SymbolFlags.Value | ts.SymbolFlags.Alias;
      for (const s of checker.getSymbolsInScope(f.sf, flags)) values.set(s.name, s);
      moduleValues.set(f, values);
    }
    const local = values.get(id.text);
    if (local === undefined || importsTypeOnly(local)) return undefined;
    const symbol = resolveAlias(local);
    if (symbol === undefined) return 'refused';
    for (const d of symbol.declarations ?? []) {
      if (ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d)) continue;
      const stmt = topStatementOf(d);
      const unit = stmt === undefined ? undefined : unitOfStatement.get(stmt);
      const name = (d as { name?: ts.Node }).name;
      if (unit !== undefined && name !== undefined && ts.isIdentifier(name)) {
        return { unit, name: name.text };
      }
    }
    return undefined;
  };

  const written = new Set<string>();
  const globalsOf = new Map<ts.Statement, Map<string, ts.Identifier[]>>();
  interface Use {
    readonly id: ts.Identifier;
    readonly span?: ts.Node;
    readonly unit: Unit;
    readonly name: string;
  }
  const usesOf = new Map<ProgramFile, Use[]>();
  const unresolvedSizes: { readonly file: ProgramFile; readonly id: ts.Identifier }[] = [];
  for (const f of order) {
    const uses: Use[] = [];
    usesOf.set(f, uses);
    for (const stmt of f.sf.statements) {
      if (
        ts.isImportDeclaration(stmt) ||
        (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier !== undefined) ||
        ts.isImportEqualsDeclaration(stmt)
      ) {
        continue;
      }
      const from = unitOfStatement.get(stmt);
      const g = new Map<string, ts.Identifier[]>();
      globalsOf.set(stmt, g);
      for (const id of identifiersIn(stmt)) {
        written.add(id.text);
        if (!isUse(id)) continue;
        const p = id.parent;
        if (isArraySize(id)) {
          const size = sizeValueOf(f, id);
          if (size === 'refused') {
            silence(f, id);
            continue;
          }
          if (size !== undefined) {
            uses.push({ id, unit: size.unit, name: size.name });
            from?.refs.add(size.unit);
            continue;
          }
          unresolvedSizes.push({ file: f, id });
          continue;
        }
        let symbol = ts.isShorthandPropertyAssignment(p)
          ? checker.getShorthandAssignmentValueSymbol(p)
          : checker.getSymbolAtLocation(id);
        if (symbol === undefined) {
          const list = g.get(id.text) ?? [];
          list.push(id);
          g.set(id.text, list);
          continue;
        }
        if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
          if (deadAliases.has(symbol)) {
            silence(f, id);
            continue;
          }
          const target = resolveAlias(symbol);
          if (target === undefined) {
            silence(f, id);
            continue;
          }
          symbol = target;
        }
        if (isModuleSymbol(symbol)) {
          const member =
            ts.isPropertyAccessExpression(p) && p.expression === id
              ? p.name
              : ts.isQualifiedName(p) && p.left === id
                ? p.right
                : undefined;
          const memberSymbol =
            member === undefined ? undefined : checker.getSymbolAtLocation(member);
          const target = memberSymbol === undefined ? undefined : resolveAlias(memberSymbol);
          const top = target === undefined ? undefined : topNameOf(target);
          if (member === undefined || top === undefined) {
            refuse(
              f.sf,
              member === undefined ? id : p,
              `"${id.text}" is a module namespace, read one name at a time ` +
                `(${id.text}.name). It is not a value.`,
            );
            silence(f, id);
            continue;
          }
          uses.push({ id, span: p, unit: top.unit, name: top.name });
          from?.refs.add(top.unit);
          continue;
        }
        const top = topNameOf(symbol);
        if (top !== undefined) {
          uses.push({ id, unit: top.unit, name: top.name });
          from?.refs.add(top.unit);
          continue;
        }
        for (const u of unitsOf(symbol)) from?.refs.add(u);
      }
    }
  }

  interface ExportRef {
    readonly name: string;
    readonly unit: Unit;
    readonly declared: string;
    readonly at: ts.Node;
  }
  const entryExports: ExportRef[] = [];
  const addExport = (name: string, symbol: ts.Symbol | undefined, at: ts.Node): void => {
    if (symbol === undefined || name === 'default') return;
    const target = resolveAlias(symbol);
    const top = target === undefined ? undefined : topNameOf(target);
    if (top === undefined || entryExports.some((e) => e.name === name)) return;
    entryExports.push({ name, unit: top.unit, declared: top.name, at });
  };
  for (const s of entry.sf.statements) {
    if (ts.isExportDeclaration(s)) {
      if (refusedImports.has(s)) continue;
      if (s.exportClause === undefined) {
        const moduleSymbol =
          s.moduleSpecifier === undefined
            ? undefined
            : checker.getSymbolAtLocation(s.moduleSpecifier);
        if (moduleSymbol === undefined) continue;
        for (const e of checker.getExportsOfModule(moduleSymbol)) addExport(e.name, e, s);
      } else if (ts.isNamedExports(s.exportClause)) {
        for (const e of s.exportClause.elements) {
          addExport(e.name.text, checker.getSymbolAtLocation(e.propertyName ?? e.name), e);
          if (s.moduleSpecifier === undefined) {
            const local = checker.getExportSpecifierLocalTargetSymbol(e);
            addExport(e.name.text, local, e);
          }
        }
      }
      continue;
    }
    if (!hasModifier(s, ts.SyntaxKind.ExportKeyword)) continue;
    if (hasModifier(s, ts.SyntaxKind.DefaultKeyword)) continue;
    for (const n of declaredNames(s)) addExport(n.text, checker.getSymbolAtLocation(n), n);
  }

  const kept = new Set<Unit>();
  const work: Unit[] = [];
  const keep = (u: Unit): void => {
    if (kept.has(u)) return;
    kept.add(u);
    work.push(u);
  };
  for (const u of units) if (whole.has(u.file)) keep(u);
  for (const e of entryExports) keep(e.unit);
  while (work.length > 0) for (const r of work.pop()!.refs) keep(r);
  const keptFiles = new Set<ProgramFile>();
  for (const u of kept) keptFiles.add(u.file);
  for (const f of whole) keptFiles.add(f);
  const globals = new Map<ProgramFile, Map<string, ts.Identifier[]>>();
  for (const f of keptFiles) {
    const g = new Map<string, ts.Identifier[]>();
    for (const stmt of f.sf.statements) {
      const unit = unitOfStatement.get(stmt);
      if (unit !== undefined && !kept.has(unit)) continue;
      for (const [name, ids] of globalsOf.get(stmt) ?? [])
        g.set(name, [...(g.get(name) ?? []), ...ids]);
    }
    globals.set(f, g);
  }

  const emitted = new Map<string, string>();
  const key = (f: ProgramFile, name: string): string => `${f.name}\0${name}`;
  const taken = new Set<string>();
  const fresh = (stem: string, name: string): string => {
    const base = `${stem}_${name}`;
    let candidate = base;
    for (let i = 2; ; i++) {
      if (
        !taken.has(candidate) &&
        !written.has(candidate) &&
        !WGSL_RESERVED.has(candidate) &&
        !GLSL_ES300_RESERVED.has(candidate)
      ) {
        return candidate;
      }
      candidate = `${base}_${i}`;
    }
  };
  const owner = new Map<string, ProgramFile>();
  const dropped = new Set<Unit>();
  for (const aliases of [false, true])
    for (const f of order) {
      if (!keptFiles.has(f)) continue;
      const called = new Set<string>();
      for (const [other, g] of globals) if (other !== f) for (const n of g.keys()) called.add(n);
      for (const u of units) {
        if (u.file !== f || !kept.has(u)) continue;
        if (ts.isTypeAliasDeclaration(u.stmt) !== aliases) continue;
        for (const id of u.names) {
          const k = key(f, id.text);
          if (emitted.has(k)) continue;
          const clash = taken.has(id.text);
          const hides = called.has(id.text);
          if (!clash && !hides) {
            emitted.set(k, id.text);
            taken.add(id.text);
            owner.set(id.text, f);
            continue;
          }
          if (u.fixedName !== undefined) {
            if (clash) {
              const first = owner.get(id.text)!;
              diagnostics.push(
                makeDiagnostic(
                  f.sf,
                  id,
                  `${u.fixedName === 'binding' ? 'Binding' : u.fixedName === 'override' ? 'Override' : 'Entry point'} "${id.text}" is ` +
                    `declared in both "${first.name}" and "${f.name}". A program is one module, ` +
                    `and the host knows ${u.fixedName === 'binding' ? 'a' : 'an'} ${u.fixedName} ` +
                    `by its name; rename one.`,
                  TS_CODES.DUPLICATE_SYMBOL,
                ),
              );
              dropped.add(u);
            } else {
              for (const [other, g] of globals) {
                if (other === f) continue;
                for (const use of g.get(id.text) ?? []) {
                  diagnostics.push(
                    makeDiagnostic(
                      other.sf,
                      use,
                      `Unknown identifier "${id.text}". Declare it in this file, or import it ` +
                        `from another shader module.`,
                      TS_CODES.UNKNOWN_NAME,
                    ),
                  );
                }
              }
            }
            emitted.set(k, id.text);
            taken.add(id.text);
            continue;
          }
          const name = fresh(stemOf(f), id.text);
          emitted.set(k, name);
          taken.add(name);
          owner.set(name, f);
        }
      }
    }
  const emittedName = (unit: Unit, name: string): string =>
    emitted.get(key(unit.file, name)) ?? name;
  for (const [f, uses] of usesOf) {
    for (const use of uses) if (dropped.has(use.unit)) silence(f, use.id);
  }

  const keepsExport = new Set<Unit>();
  const exportList: { readonly text: string; readonly at: ts.Node }[] = [];
  for (const e of entryExports) {
    const name = emittedName(e.unit, e.declared);
    const declares = e.unit.names.some((n) => n.text === e.declared);
    if (e.unit.file === entry) {
      if (name !== e.name || !hasModifier(e.unit.stmt, ts.SyntaxKind.ExportKeyword)) {
        exportList.push({ text: `export { ${name} as ${e.name} };`, at: e.at });
      }
      continue;
    }
    if (
      name === e.name &&
      declares &&
      hasModifier(e.unit.stmt, ts.SyntaxKind.ExportKeyword) &&
      !hasModifier(e.unit.stmt, ts.SyntaxKind.DefaultKeyword)
    ) {
      for (const u of overloadsOf.get(e.unit) ?? [e.unit]) keepsExport.add(u);
    } else {
      exportList.push({ text: `export { ${name} as ${e.name} };`, at: e.at });
    }
  }
  const dropsExport = new Set<Unit>();
  for (const e of entryExports) {
    if (e.unit.file !== entry) continue;
    if (emittedName(e.unit, e.declared) !== e.name) {
      for (const u of overloadsOf.get(e.unit) ?? [e.unit]) dropsExport.add(u);
    }
  }

  const carries = (f: ProgramFile, stmt: ts.Statement): boolean => {
    if (
      isUseTypeshadeDirective(stmt) ||
      ts.isImportDeclaration(stmt) ||
      ts.isImportEqualsDeclaration(stmt) ||
      (ts.isExportDeclaration(stmt) && (stmt.moduleSpecifier !== undefined || f !== entry)) ||
      (ts.isExportAssignment(stmt) && f !== entry && f !== aliasTarget)
    ) {
      return false;
    }
    const unit = unitOfStatement.get(stmt);
    return unit === undefined || (kept.has(unit) && !dropped.has(unit));
  };

  const editsOf = (f: ProgramFile): Edit[] => {
    const edits: Edit[] = [];
    const localNames = new Map<ts.Symbol, string>();
    const ownNames = new Set(
      units.filter((u) => u.file === f).flatMap((u) => u.names.map((n) => n.text)),
    );
    for (const stmt of f.sf.statements) {
      if (!carries(f, stmt)) continue;
      for (const id of identifiersIn(stmt)) {
        const parent = id.parent;
        if (!(
          (ts.isVariableDeclaration(parent) ||
            ts.isParameter(parent) ||
            ts.isBindingElement(parent) ||
            ts.isFunctionDeclaration(parent)) &&
          parent.name === id
        ))
          continue;
        const symbol = checker.getSymbolAtLocation(id);
        if (symbol === undefined || topNameOf(symbol) !== undefined || localNames.has(symbol))
          continue;
        if (ownNames.has(id.text) || owner.get(id.text) === undefined || owner.get(id.text) === f)
          continue;
        const name = fresh(stemOf(f), id.text);
        taken.add(name);
        localNames.set(symbol, name);
      }
    }
    for (const stmt of f.sf.statements) {
      if (!carries(f, stmt)) continue;
      for (const id of identifiersIn(stmt)) {
        const parent = id.parent;
        const symbol = ts.isShorthandPropertyAssignment(parent)
          ? checker.getShorthandAssignmentValueSymbol(parent)
          : checker.getSymbolAtLocation(id);
        const name = symbol === undefined ? undefined : localNames.get(symbol);
        if (name === undefined) continue;
        edits.push({
          start: id.getStart(f.sf),
          end: id.getEnd(),
          text:
            ts.isShorthandPropertyAssignment(parent) ||
            (ts.isBindingElement(parent) &&
              parent.name === id &&
              parent.propertyName === undefined &&
              ts.isObjectBindingPattern(parent.parent))
              ? `${id.text}: ${name}`
              : name,
        });
      }
    }
    for (const stmt of f.sf.statements) {
      if (!carries(f, stmt)) continue;
      const unit = unitOfStatement.get(stmt);
      if (unit !== undefined) {
        const dropExport =
          (f !== entry && !keepsExport.has(unit)) || (f === entry && dropsExport.has(unit));
        if (dropExport) {
          const modifiers = ts.canHaveModifiers(stmt) ? (ts.getModifiers(stmt) ?? []) : [];
          for (const m of modifiers) {
            if (m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword) {
              let end = m.getEnd();
              while (end < f.sf.text.length && /[ \t]/.test(f.sf.text[end]!)) end++;
              edits.push({ start: m.getStart(f.sf), end, text: '' });
            }
          }
        }
        for (const id of unit.names) {
          const name = emittedName(unit, id.text);
          if (name !== id.text)
            edits.push({ start: id.getStart(f.sf), end: id.getEnd(), text: name });
        }
      }
      if (
        ts.isExportDeclaration(stmt) &&
        stmt.exportClause &&
        ts.isNamedExports(stmt.exportClause)
      ) {
        for (const e of stmt.exportClause.elements) {
          const local = checker.getExportSpecifierLocalTargetSymbol(e);
          const top = local === undefined ? undefined : topNameOf(local);
          if (top === undefined) continue;
          const name = emittedName(top.unit, top.name);
          const written = e.propertyName ?? e.name;
          if (name === written.text) continue;
          edits.push(
            e.propertyName === undefined
              ? { start: e.getStart(f.sf), end: e.getEnd(), text: `${name} as ${e.name.text}` }
              : { start: written.getStart(f.sf), end: written.getEnd(), text: name },
          );
        }
      }
    }
    for (const size of unresolvedSizes) {
      const stmt = size.file === f ? topStatementOf(size.id) : undefined;
      if (stmt === undefined || !carries(f, stmt)) continue;
      const name = fresh(stemOf(f), size.id.text);
      taken.add(name);
      edits.push({ start: size.id.getStart(f.sf), end: size.id.getEnd(), text: name });
    }
    for (const use of usesOf.get(f) ?? []) {
      const stmt = topStatementOf(use.id);
      if (stmt === undefined || !carries(f, stmt) || ts.isExportDeclaration(stmt)) continue;
      const name = emittedName(use.unit, use.name);
      const node = use.span ?? use.id;
      if (use.span === undefined && name === use.id.text) continue;
      const p = use.id.parent;
      const text =
        ts.isShorthandPropertyAssignment(p) && use.span === undefined
          ? `${use.id.text}: ${name}`
          : name;
      edits.push({ start: node.getStart(f.sf), end: node.getEnd(), text });
    }
    edits.sort((a, b) => a.start - b.start || b.end - a.end);
    const out: Edit[] = [];
    for (const e of edits) {
      const last = out[out.length - 1];
      if (last !== undefined && e.start < last.end) continue;
      out.push(e);
    }
    return out;
  };

  const pieces: Piece[] = [];
  let text = '';
  const write = (s: string, file: ProgramFile | undefined, anchor?: Piece['anchor']): void => {
    if (s.length === 0) return;
    pieces.push({
      at: text.length,
      length: s.length,
      file,
      from: 0,
      ...(anchor ? { anchor } : {}),
    });
    text += s;
  };
  const copy = (f: ProgramFile, from: number, to: number): void => {
    if (to <= from) return;
    pieces.push({ at: text.length, length: to - from, file: f, from });
    text += f.sf.text.slice(from, to);
  };
  const editsByFile = new Map<ProgramFile, Edit[]>();
  for (const f of keptFiles) editsByFile.set(f, editsOf(f));
  const writeStatement = (f: ProgramFile, stmt: ts.Statement): void => {
    const start = stmt.getStart(f.sf);
    const end = stmt.getEnd();
    let at = start;
    for (const e of editsByFile.get(f) ?? []) {
      if (e.start < start || e.end > end) continue;
      copy(f, at, e.start);
      if (e.text.length > 0) write(e.text, f, { start: e.start, end: e.end });
      at = e.end;
    }
    copy(f, at, end);
    write('\n', f, { start: end, end });
  };

  const entryDirective = findUseTypeshadeDirective(entry.sf);
  write('"use typeshade";\n', entry, {
    start: entryDirective?.getStart(entry.sf) ?? 0,
    end: entryDirective?.getEnd() ?? 0,
  });
  const isBinding = (stmt: ts.Statement): boolean =>
    unitOfStatement.get(stmt)?.fixedName === 'binding';
  for (const f of order) {
    if (!keptFiles.has(f)) continue;
    for (const stmt of f.sf.statements) {
      if (isBinding(stmt) && carries(f, stmt)) writeStatement(f, stmt);
    }
  }
  const placed = new Set<ProgramFile>();
  const place = (f: ProgramFile): void => {
    if (placed.has(f)) return;
    placed.add(f);
    for (const dep of f.imports) place(dep);
    if (!keptFiles.has(f)) return;
    for (const stmt of f.sf.statements) {
      if (!isBinding(stmt) && carries(f, stmt)) writeStatement(f, stmt);
    }
  };
  for (const f of order) if (f.root && f !== entry) place(f);
  place(entry);
  for (const item of exportList) {
    write(`${item.text}\n`, entry, { start: item.at.getStart(entry.sf), end: item.at.getEnd() });
  }

  const pieceAt = (offset: number): Piece | undefined => {
    let lo = 0;
    let hi = pieces.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const p = pieces[mid]!;
      if (offset < p.at) hi = mid - 1;
      else if (offset >= p.at + p.length) lo = mid + 1;
      else return p;
    }
    return undefined;
  };
  const linkedOf = new Map<ProgramFile, LinkedFile>();
  const all = linkedFiles(keptFiles);
  for (const [i, f] of order.entries()) linkedOf.set(f, all[i]!);
  const map = (start: number, end: number): MappedSpan | undefined => {
    const first = pieceAt(start) ?? pieceAt(start - 1);
    if (first === undefined || first.file === undefined) return undefined;
    const from =
      first.anchor !== undefined
        ? first.anchor.start
        : first.from + Math.min(start - first.at, first.length);
    const endOf = (p: Piece, offset: number): number =>
      p.anchor !== undefined ? p.anchor.end : p.from + Math.min(offset - p.at, p.length);
    let to = from;
    if (end > start) {
      const last = pieceAt(end - 1);
      to =
        last !== undefined && last.file === first.file
          ? endOf(last, end)
          : endOf(first, first.at + first.length);
    }
    return { file: linkedOf.get(first.file)!, start: from, end: Math.max(from, to) };
  };

  diagnostics.sort((a, b) => Number(isRefused(b)) - Number(isRefused(a)));

  return {
    fatal: false,
    diagnostics,
    fileName: linkedFileName,
    source: text,
    files: all,
    exports: entryExports.map((e) => ({
      name: e.name,
      emitted: emittedName(e.unit, e.declared),
      file: e.unit.file.name,
    })),
    map,
    silenced,
  };
}
