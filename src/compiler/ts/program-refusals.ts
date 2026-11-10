// === Where an error of a linked program stands (Rule 3.9, Rule 12.4, #1186) ===
//
// A program is the file a compile starts from and the shader files it imports. Some errors are
// true of the program and not of the file that holds what they name: an entry gives a field of
// an imported struct no location, or a call makes an instance of an imported generic function
// whose body refuses the type. The front end raises such an error at its SITE, the declaration
// or the expression it refuses, and records its USES, innermost first: the entry's parameter or
// result that takes the struct, the call or the type that makes the instance (`noteUse`).
//
// The rule:
//
// 1. The CHAIN of an error is the files that hold it, innermost first: the site's file, each
//    use's file, then each file on the way of imports from there up to the file the compile
//    starts from. The OWNER is the first file of the chain that reports the same mistake when
//    it is compiled as its own program: the same site, code and sentence as written. A file
//    the compile starts from is its own program, so it owns what reaches it.
// 2. The program reports the error once, in the owner: at the site when the owner holds the
//    site, else at the owner's outermost use, else on the owner's re-export of the entry point
//    that holds the use, else on the owner's import of the next file of the chain. The site is
//    the error's related place when the error does not stand on it.
// 3. A document lists what is located in it. So the owner's document shows the error, and no
//    other document does: a mistake of a file in the middle of a chain of imports is not
//    reported again in each file above it.
// 4. Two errors that stand on one use with one code and one sentence are one diagnostic, which
//    keeps the site of each. On an import or a re-export they stay apart.
//
// So an error located in an imported file is one that file reports when it is compiled on its
// own.

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import type { LinkedFile, LinkedProgram } from './link.js';
import {
  relatedSitesOf,
  setRelatedSites,
  setWrittenMessage,
  usesOf,
  writtenMessageOf,
  type DiagnosticSite,
} from './diagnostic.js';
import { attributeDecoratorsOf } from './attribute-types.js';
import { stageCallOf } from './stage-call.js';

/** What makes two reports, by two programs, the same mistake: the site in its own file, the
 *  code, and the sentence with each name as its file writes it. */
const mistakeKey = (
  site: { fileName: string; start: number; length: number },
  code: string | undefined,
  sentence: string,
): string => [site.fileName, site.start, site.length, code ?? '', sentence].join('\u0000');

/** The mistakes a program's diagnostics report: each error by its site, which is its related
 *  place where the program reports it at a use. */
function mistakesOf(diagnostics: readonly TsCompilerDiagnostic[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const d of diagnostics) {
    if (d.category !== 'error') continue;
    const related = relatedSitesOf(d);
    for (const site of related.length > 0 ? related : [d])
      out.add(mistakeKey(site, d.code, writtenMessageOf(d)));
  }
  return out;
}

/** The own programs the compile in progress has asked for, by file: one compile of a file as
 *  its own program serves every program above it. `undefined` between compiles. */
let OWN_PROGRAMS: Map<string, ReadonlySet<string>> | undefined;
/** The files whose own program is being compiled, outermost first. */
const OWN_PROGRAMS_RUNNING = new Set<string>();

/** One error of the linked program: as the front end raised it over the linked source, and
 *  mapped to the file and offsets its site was written at. */
interface ProgramError {
  readonly raised: TsCompilerDiagnostic;
  readonly mapped: TsCompilerDiagnostic;
}

/** Whether `statement` declares an entry point named `name`: a decorated function or a stage
 *  call. */
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

/**
 * Gives each error of a linked program its place by the rule at the head of this file, and
 * returns the program's diagnostics in the order they were raised.
 */
export function locateProgramErrors(input: {
  /** The file the compile starts from. */
  readonly entry: ts.SourceFile;
  readonly linked: LinkedProgram;
  /** The linked source, as parsed. */
  readonly linkedSource: ts.SourceFile;
  /** The files the compile starts from and keeps whole: the entry and `compileTsSources`'s
   *  other roots. */
  readonly roots: ReadonlySet<string>;
  readonly errors: readonly ProgramError[];
  readonly resolve: (from: string, specifier: string) => string | undefined;
  /** The diagnostics of `file` compiled as its own program. */
  readonly ownProgram: (file: LinkedFile) => readonly TsCompilerDiagnostic[];
}): TsCompilerDiagnostic[] {
  const { entry, linked, linkedSource, roots, errors } = input;
  const files = new Map(linked.files.map((f) => [f.name, f]));

  // The sentence of each diagnostic as written: the names the linker emitted under another
  // spelling, read back off the linked source.
  let renames: ReadonlyMap<string, string> | undefined;
  const written = (message: string): string => {
    if (renames === undefined) {
      const found = new Map<string, string>();
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
          const m = linked.map(node.getStart(linkedSource), node.getEnd());
          const text = m?.file.sourceFile.text.slice(m.start, m.end);
          if (text !== undefined && text !== node.text && /^[A-Za-z_$][\w$]*$/.test(text))
            found.set(node.text, text);
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(linkedSource);
      renames = found;
    }
    if (renames.size === 0) return message;
    return message.replace(/[A-Za-z_$][\w$]*/g, (name) => renames!.get(name) ?? name);
  };

  const outermost = OWN_PROGRAMS === undefined;
  if (outermost) {
    OWN_PROGRAMS = new Map();
    // The entry file is the program being compiled: it is not compiled again to ask it.
    OWN_PROGRAMS_RUNNING.add(entry.fileName);
  }
  const cache = OWN_PROGRAMS!;
  /** Whether `file`, compiled as its own program, reports the mistake `key`. `undefined` for a
   *  file whose own program is being compiled further out: two files that import each other. */
  const owns = (file: LinkedFile, key: string): boolean | undefined => {
    let own = cache.get(file.name);
    if (own === undefined) {
      if (OWN_PROGRAMS_RUNNING.has(file.name)) return undefined;
      OWN_PROGRAMS_RUNNING.add(file.name);
      try {
        own = mistakesOf(input.ownProgram(file));
      } finally {
        OWN_PROGRAMS_RUNNING.delete(file.name);
      }
      cache.set(file.name, own);
    }
    return own.has(key);
  };

  try {
    const out: TsCompilerDiagnostic[] = [];
    /** The diagnostics that stand on a use, where a second one of the same sentence joins. */
    const onUse = new Set<TsCompilerDiagnostic>();
    let ways: ReturnType<typeof importWays> | undefined;
    for (const { raised, mapped } of errors) {
      setWrittenMessage(mapped, written(mapped.message));
      const site = files.get(mapped.fileName);
      // A warning, a span of text the linker wrote and what the entry file holds stay as they
      // are.
      if (mapped.category !== 'error' || site === undefined || mapped.fileName === entry.fileName) {
        out.push(mapped);
        continue;
      }
      const key = mistakeKey(mapped, mapped.code, writtenMessageOf(mapped));
      // The chain after the site: each use's file with its outermost use, innermost first.
      const chain: Place[] = [];
      for (const use of usesOf(raised)) {
        const m = linked.map(use.start, use.end);
        if (m === undefined || m.file === site) continue;
        const had = chain.find((c) => c.file === m.file);
        if (had === undefined) chain.push({ file: m.file, start: m.start, end: m.end, use: true });
        else Object.assign(had, { start: m.start, end: m.end });
      }
      // Then each file on the way of imports up to the entry file, with the re-export or the
      // import that brings the file below it.
      const top = chain[chain.length - 1];
      ways ??= importWays(entry, linked, input.resolve);
      for (const step of ways(top?.file.name ?? site.name, top?.start)) {
        if (step.file === site || chain.some((c) => c.file === step.file)) continue;
        chain.push(step);
      }
      const owner =
        owns(site, key) === true
          ? undefined
          : (chain.find((c) => c.file.name === entry.fileName || owns(c.file, key) === true) ??
            // No file of the chain owns it: a use in another file the compile starts from.
            chain.find((c) => c.use && roots.has(c.file.name)));
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
      setWrittenMessage(moved, writtenMessageOf(mapped));
      const related: DiagnosticSite = {
        fileName: mapped.fileName,
        start: mapped.start,
        length: mapped.length,
        line: mapped.line,
        character: mapped.character,
        endLine: mapped.endLine,
        endCharacter: mapped.endCharacter,
      };
      const same = !owner.use
        ? undefined
        : out.find(
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
    if (outermost) {
      OWN_PROGRAMS = undefined;
      OWN_PROGRAMS_RUNNING.delete(entry.fileName);
    }
  }
}

/** A file of an error's chain, with where the error stands when that file owns it. */
interface Place {
  readonly file: LinkedFile;
  readonly start: number;
  readonly end: number;
  /** Whether the place is a use the front end recorded, and not an import or a re-export. */
  readonly use: boolean;
}

/**
 * For the entry file of `linked`: the function that gives, for a file of the program, the files
 * on the way of imports from it up to the entry file, nearest first, each with the place that
 * brings in the file below it. The place is the name of a re-export that names the entry point
 * which holds `at`, through any re-exports between (`fs` in
 * `export { fs } from "./frag.shade.ts"`); else the module specifier of the file's first import
 * or re-export of the file below. The way is the shortest one, the first in each file's order.
 * A file the entry file does not reach has no way.
 */
function importWays(
  entry: ts.SourceFile,
  linked: LinkedProgram,
  resolve: (from: string, specifier: string) => string | undefined,
): (file: string, at: number | undefined) => Place[] {
  const byName = new Map(linked.files.map((f) => [f.name, f]));
  type Edge = { node: ts.ImportDeclaration | ts.ExportDeclaration; to: string };
  const edges = new Map<string, Edge[]>();
  const targets = (from: string): Edge[] => {
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
  // The file each file is first reached from, breadth first from the entry file.
  const above = new Map<string, string>();
  const queue = [entry.fileName];
  for (let i = 0; i < queue.length; i++) {
    for (const t of targets(queue[i]!)) {
      if (t.to === entry.fileName || above.has(t.to)) continue;
      above.set(t.to, queue[i]!);
      queue.push(t.to);
    }
  }
  /** Whether the name `name` that `from` exports is the entry point `entryName` of `file`,
   *  declared there or re-exported on the way. */
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
    // The entry point that holds `at`, when one does.
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
