import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import type { LinkedFile, LinkedProgram } from './link.js';
import { relatedSitesOf, setRelatedSites, usesOf, type DiagnosticSite } from './diagnostic.js';
import { attributeDecoratorsOf } from './attribute-types.js';
import { stageCallOf } from './stage-call.js';
import {
  mistakeKey,
  mistakesOf,
  reports,
  type Span,
  type Mistakes,
} from './program-refusals/mistakes.js';

// Why: one compile of a file as its own program serves every program above it, and an editor's
// next keystroke in the importing file asks for none, so the key holds hashes and not texts.
const OWN_PROGRAMS = new Map<string, Mistakes>();
const OWN_PROGRAMS_HELD = 1024;
const OWN_PROGRAMS_RUNNING = new Set<string>();

function hash53(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

interface ProgramError {
  readonly raised: TsCompilerDiagnostic;
  readonly mapped: TsCompilerDiagnostic;
}

const IDENTIFIER_WORDS = /[\p{ID_Start}_$][\p{ID_Continue}$\u200c\u200d]*/gu;
const IDENTIFIER = /^[\p{ID_Start}_$][\p{ID_Continue}$\u200c\u200d]*$/u;

function declaresModuleName(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isVariableDeclaration(node)
  );
}

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

export function locateProgramErrors(input: {
  readonly entry: ts.SourceFile;
  readonly linked: LinkedProgram;
  readonly linkedSource: ts.SourceFile;
  readonly roots: ReadonlySet<string>;
  readonly errors: readonly ProgramError[];
  readonly resolve: (from: string, specifier: string) => string | undefined;
  readonly ownProgram: (file: LinkedFile) => readonly TsCompilerDiagnostic[];
  readonly optionsKey: string;
}): TsCompilerDiagnostic[] {
  const { entry, linked, linkedSource, roots, errors } = input;
  const files = new Map(linked.files.map((f) => [f.name, f]));

  let renames: ReadonlyMap<string, string> | undefined;
  const written = (message: string): string => {
    if (renames === undefined) {
      const found = new Map<string, string>();
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
          const parent = node.parent as ts.Node & { readonly name?: ts.Node };
          if (parent.name !== node || !declaresModuleName(parent)) return;
          const m = linked.map(node.getStart(linkedSource), node.getEnd());
          const text = m?.file.sourceFile.text.slice(m.start, m.end);
          if (text !== undefined && text !== node.text && IDENTIFIER.test(text))
            found.set(node.text, text);
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(linkedSource);
      renames = found;
    }
    if (renames.size === 0) return message;
    return message.replace(IDENTIFIER_WORDS, (name) => renames!.get(name) ?? name);
  };

  const edges = programEdges(linked, input.resolve);
  const ownKeys = new Map<string, string>();
  const textHashes = new Map<string, string>();
  const textHash = (name: string): string => {
    let h = textHashes.get(name);
    if (h === undefined) {
      const text = files.get(name)?.sourceFile.text ?? '';
      h = `${hash53(text)}${hash53(text, 1)}`;
      textHashes.set(name, h);
    }
    return h;
  };
  const ownKey = (file: LinkedFile): string => {
    const had = ownKeys.get(file.name);
    if (had !== undefined) return had;
    const read: string[] = [];
    const seen = new Set<string>();
    const visit = (name: string): void => {
      if (seen.has(name)) return;
      seen.add(name);
      read.push(`${name}\u0001${textHash(name)}`);
      for (const e of edges(name)) {
        read.push(`${name}\u0002${e.to}`);
        visit(e.to);
      }
    };
    visit(file.name);
    const key = `${input.optionsKey}\u0003${read.join('\u0003')}`;
    ownKeys.set(file.name, key);
    return key;
  };
  const outermost = !OWN_PROGRAMS_RUNNING.has(entry.fileName);
  if (outermost) OWN_PROGRAMS_RUNNING.add(entry.fileName);
  const owns = (file: LinkedFile, key: string, site: Span, place: Span): boolean | undefined => {
    const id = ownKey(file);
    let own = OWN_PROGRAMS.get(id);
    if (own === undefined) {
      if (OWN_PROGRAMS_RUNNING.has(file.name)) return undefined;
      OWN_PROGRAMS_RUNNING.add(file.name);
      try {
        own = mistakesOf(input.ownProgram(file));
      } finally {
        OWN_PROGRAMS_RUNNING.delete(file.name);
      }
      OWN_PROGRAMS.set(id, own);
      if (OWN_PROGRAMS.size > OWN_PROGRAMS_HELD)
        OWN_PROGRAMS.delete(OWN_PROGRAMS.keys().next().value!);
    } else {
      // Why: a hit moves the entry last, so the oldest goes first past OWN_PROGRAMS_HELD.
      OWN_PROGRAMS.delete(id);
      OWN_PROGRAMS.set(id, own);
    }
    return reports(own, key, site, place, (name) => files.get(name)?.sourceFile.text);
  };

  try {
    const out: TsCompilerDiagnostic[] = [];
    const onUse = new Set<TsCompilerDiagnostic>();
    let ways: ReturnType<typeof importWays> | undefined;
    for (const error of errors) {
      const { raised } = error;
      const said = written(error.mapped.message);
      const mapped =
        said === error.mapped.message ? error.mapped : { ...error.mapped, message: said };
      const site = files.get(mapped.fileName);
      if (mapped.category !== 'error' || site === undefined || mapped.fileName === entry.fileName) {
        out.push(mapped);
        continue;
      }
      const key = mistakeKey(mapped.code, mapped.message);
      const chain: Place[] = [];
      for (const use of usesOf(raised)) {
        const m = linked.map(use.start, use.end);
        if (m === undefined || m.file === site) continue;
        const had = chain.find((c) => c.file === m.file);
        if (had === undefined) chain.push({ file: m.file, start: m.start, end: m.end, use: true });
        else Object.assign(had, { start: m.start, end: m.end });
      }
      const top = chain[chain.length - 1];
      ways ??= importWays(entry, linked, edges);
      for (const step of ways(top?.file.name ?? site.name, top?.start)) {
        if (step.file === site || chain.some((c) => c.file === step.file)) continue;
        chain.push(step);
      }
      const placeOf = (c: Place): Span => ({
        fileName: c.file.name,
        start: c.start,
        length: c.end - c.start,
      });
      const owner =
        owns(site, key, mapped, mapped) === true
          ? undefined
          : (chain.find(
              (c) =>
                c.file.name === entry.fileName || owns(c.file, key, mapped, placeOf(c)) === true,
            ) ?? chain.find((c) => c.use && roots.has(c.file.name)));
      if (owner === undefined) {
        out.push(mapped);
        continue;
      }
      const source = owner.file.sourceFile;
      const s = source.getLineAndCharacterOfPosition(owner.start);
      const e = source.getLineAndCharacterOfPosition(owner.end);
      const moved: TsCompilerDiagnostic = {
        ...mapped,
        fileName: owner.file.name,
        start: owner.start,
        length: owner.end - owner.start,
        line: s.line + 1,
        character: s.character + 1,
        endLine: e.line + 1,
        endCharacter: e.character + 1,
      };
      const related: DiagnosticSite = {
        fileName: mapped.fileName,
        start: mapped.start,
        length: mapped.length,
        line: mapped.line,
        character: mapped.character,
        endLine: mapped.endLine,
        endCharacter: mapped.endCharacter,
      };
      const same = out.find(
        (x) =>
          onUse.has(x) &&
          x.fileName === moved.fileName &&
          x.start === moved.start &&
          x.length === moved.length &&
          x.code === moved.code &&
          x.message === moved.message,
      );
      if (same !== undefined) {
        const sites = relatedSitesOf(same);
        if (
          !sites.some(
            (x) =>
              x.fileName === related.fileName &&
              x.start === related.start &&
              x.length === related.length,
          )
        )
          setRelatedSites(same, [...sites, related]);
        continue;
      }
      setRelatedSites(moved, [related]);
      if (owner.use) onUse.add(moved);
      out.push(moved);
    }
    return out;
  } finally {
    if (outermost) OWN_PROGRAMS_RUNNING.delete(entry.fileName);
  }
}

interface Place {
  readonly file: LinkedFile;
  readonly start: number;
  readonly end: number;
  readonly use: boolean;
}

interface Edge {
  readonly node: ts.ImportDeclaration | ts.ExportDeclaration;
  readonly to: string;
}

function programEdges(
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

function importWays(
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
