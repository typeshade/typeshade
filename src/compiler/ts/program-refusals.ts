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
//    starts from. Each file of the chain has a PLACE for the error: the site, in the site's
//    file; else the file's outermost use; else its re-export of the entry point that holds the
//    use; else its import of the file below.
// 2. The OWNER is the first file of the chain that reports the same mistake at the same place
//    when it is compiled as its own program: the same code and sentence as written, the same
//    site, at the same place. Two spans are the same when they end together and start together
//    or with only `export`, optionally `default`, and whitespace and comments between their
//    starts (`samePlace`). The file the compile starts from is its own program, so it owns
//    what reaches it. The program reports the error once, in the owner, at the owner's place.
//    The site is the error's related place when the error does not stand on it.
// 3. A document lists what is located in it. So the owner's document shows the error, and no
//    other document does: a mistake of a file in the middle of a chain of imports is not
//    reported again in each file above it.
// 4. Two errors that stand on one use with one code and one sentence are one diagnostic, which
//    keeps the site of each. On an import or a re-export they stay apart.
//
// So an error located in an imported file is one that file reports, at that place, when it is
// compiled on its own.
//
// A file's own program makes an instance of a generic declaration once, at the first call that
// asks for it. So when an imported file and the file the compile starts from both make the
// same refused instance, the imported file reports it, at its own call, and the program's own
// call adds nothing until that file is fixed (Rule 12.4).
//
// Known exception (#1212): an imported file that holds a struct and the fragment entry that
// takes it reports, on its own, the same sentence at the same place for another reason (it has
// no vertex stage). It owns the error, and the program that starts from another file shows it
// only in that imported file.

import ts from 'typescript';
import type { TsCompilerDiagnostic } from './source-file.js';
import type { LinkedFile, LinkedProgram } from './link.js';
import { relatedSitesOf, setRelatedSites, usesOf, type DiagnosticSite } from './diagnostic.js';
import { attributeDecoratorsOf } from './attribute-types.js';
import { stageCallOf } from './stage-call.js';

/** A span of a file. */
interface Span {
  readonly fileName: string;
  readonly start: number;
  readonly length: number;
}

/**
 * Whether two spans of one file are one node: the same span, or the same end with nothing but
 * `export`, optionally `default`, and whitespace and comments between the two starts. Two
 * programs map one node back to its file through different linked sources: the linker drops an imported declaration's
 * `export` and `default` with the whitespace after them, so a comment after them stays, and the
 * node maps from the token after it, where the file's own program reads it from `export`. Two
 * nested expressions are two places (`a + a` inside `b + (a + a)`).
 */
const samePlace = (a: Span, b: Span, textOf: (fileName: string) => string | undefined): boolean => {
  if (a.fileName !== b.fileName || a.start + a.length !== b.start + b.length) return false;
  if (a.start === b.start) return true;
  const between = textOf(a.fileName)?.slice(Math.min(a.start, b.start), Math.max(a.start, b.start));
  return between !== undefined && onlyExportBetween(between);
};

/** Whether `text` holds the modifiers `export` and `default` and nothing else but trivia, with
 *  `export` among them. */
function onlyExportBetween(text: string): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ true);
  scanner.setText(text);
  let exported = false;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.ExportKeyword) exported = true;
    else if (token !== ts.SyntaxKind.DefaultKeyword) return false;
  }
  return exported;
}

/** What makes two reports, by two programs, one mistake: the code and the sentence with each
 *  name as its file writes it, and one site (`samePlace`). */
const mistakeKey = (code: string | undefined, sentence: string): string =>
  [code ?? '', sentence].join('\u0000');

/** The mistakes a program's errors report: for each code and sentence, each site with the
 *  places the program reports it at. The site is the error's related place where the program
 *  reports it at a use, else where it stands. */
type Mistakes = ReadonlyMap<string, readonly { site: Span; places: readonly Span[] }[]>;

function mistakesOf(diagnostics: readonly TsCompilerDiagnostic[]): Mistakes {
  const out = new Map<string, { site: Span; places: Span[] }[]>();
  for (const d of diagnostics) {
    if (d.category !== 'error') continue;
    const related = relatedSitesOf(d);
    const key = mistakeKey(d.code, d.message);
    const list = out.get(key) ?? [];
    out.set(key, list);
    for (const site of related.length > 0 ? related : [d]) list.push({ site, places: [d] });
  }
  return out;
}

/** Whether `mistakes` holds the mistake `key` at `site`, reported at `place`. */
const reports = (
  mistakes: Mistakes,
  key: string,
  site: Span,
  place: Span,
  textOf: (fileName: string) => string | undefined,
): boolean =>
  (mistakes.get(key) ?? []).some(
    (m) => samePlace(m.site, site, textOf) && m.places.some((at) => samePlace(at, place, textOf)),
  );

/**
 * The mistakes of each own program asked for, by what decides them: the file, the text of every
 * file its program reads with the imports between them, and the options. One compile of a file
 * as its own program serves every program above it, and a later compile whose files are the
 * same (an editor's next keystroke in the file that imports it) asks for none. The oldest entry
 * goes first past {@link OWN_PROGRAMS_HELD}.
 */
const OWN_PROGRAMS = new Map<string, Mistakes>();
const OWN_PROGRAMS_HELD = 1024;
/** The files whose own program is being compiled, outermost first. */
const OWN_PROGRAMS_RUNNING = new Set<string>();

/** A hash of `text` in 53 bits (cyrb53), for a cache key that does not hold the texts. */
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

/** One error of the linked program: as the front end raised it over the linked source, and
 *  mapped to the file and offsets its site was written at. */
interface ProgramError {
  readonly raised: TsCompilerDiagnostic;
  readonly mapped: TsCompilerDiagnostic;
}

/** Whether `node` is a declaration the linker may give an emitted name: a function, a class,
 *  an interface, a type alias, an enum, a namespace or a variable. */
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
  /** What else an own program's diagnostics depend on: the compile's options. */
  readonly optionsKey: string;
}): TsCompilerDiagnostic[] {
  const { entry, linked, linkedSource, roots, errors } = input;
  const files = new Map(linked.files.map((f) => [f.name, f]));

  // The sentence of each diagnostic as written: each name the linker emitted under another
  // spelling, read back as the file that declares it writes it. Only a declaration's own name
  // is read: the module has one namespace, so each emitted name has one declaration, and an
  // import's alias (`lum as l2`), which declares nothing of the module, never renames it.
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

  const edges = programEdges(linked, input.resolve);
  /** The key of `file`'s own program in {@link OWN_PROGRAMS}, once per file of this program. */
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
  // The entry file is the program being compiled: it is not compiled again to ask it.
  if (outermost) OWN_PROGRAMS_RUNNING.add(entry.fileName);
  /** Whether `file`, compiled as its own program, reports the mistake `key` of `site` at
   *  `place`. `undefined` for a file whose own program is being compiled further out: two files
   *  that import each other. */
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
      // The most recent last, so the oldest goes first.
      OWN_PROGRAMS.delete(id);
      OWN_PROGRAMS.set(id, own);
    }
    return reports(own, key, site, place, (name) => files.get(name)?.sourceFile.text);
  };

  try {
    const out: TsCompilerDiagnostic[] = [];
    /** The diagnostics that stand on a use, where a second one of the same sentence joins. */
    const onUse = new Set<TsCompilerDiagnostic>();
    let ways: ReturnType<typeof importWays> | undefined;
    for (const error of errors) {
      const { raised } = error;
      // The sentence names each declaration as its file writes it, never as the module emits it
      // (`lib_lum` for the `lum` of `lib.shade.ts` beside another `lum`): an emitted name is the
      // compiler's, and no author wrote it (docs/language-design.md §2.1).
      const said = written(error.mapped.message);
      const mapped =
        said === error.mapped.message ? error.mapped : { ...error.mapped, message: said };
      const site = files.get(mapped.fileName);
      // A warning, a span of text the linker wrote and what the entry file holds stay as they
      // are.
      if (mapped.category !== 'error' || site === undefined || mapped.fileName === entry.fileName) {
        out.push(mapped);
        continue;
      }
      const key = mistakeKey(mapped.code, mapped.message);
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
            ) ??
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
      const related: DiagnosticSite = {
        fileName: mapped.fileName,
        start: mapped.start,
        length: mapped.length,
        line: mapped.line,
        character: mapped.character,
        endLine: mapped.endLine,
        endCharacter: mapped.endCharacter,
      };
      // Only a diagnostic that stands on a use takes another in (sentence 4): `onUse` holds no
      // diagnostic on an import or a re-export, and a use never has an import's span.
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
/** An import or a re-export of one file of a linked program, and the file it names. */
interface Edge {
  readonly node: ts.ImportDeclaration | ts.ExportDeclaration;
  readonly to: string;
}

/** For a file of `linked`, its imports and re-exports of other files of the program, in the
 *  file's order. */
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
