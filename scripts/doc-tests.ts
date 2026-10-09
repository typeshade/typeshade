// ═══ The unit tests a documents-only pull request runs: the ones that can read a document ═══
//
// A pull request that changes nothing but documents (`change scope` in ci.yml) still has to run the
// unit tests that read them: the rules, the surface sections, the proposals, the changelog, the
// documentation snippets. A test that cannot touch the file system or another process reads no
// document, so a document change cannot change its result and a documents-only run skips it.
//
// A file is listed when it, or a module it imports, transitively:
//
//   - imports `node:fs`, `fs`, `node:fs/promises` or `node:child_process` (or their bare names);
//   - imports a module by a `?raw` or `?url` query, or a `.md`, `.json` or `.txt` file;
//   - imports a module whose name is not a string literal, which this reader cannot follow.
//
// The reader errs toward listing a file: a file listed that did not need it costs time, and a file
// left out that read a document would pass a documents-only change it should have failed.
// `src/doc-tests.test.ts` holds the known members on each side.
//
// Usage: `bun scripts/doc-tests.ts` prints one path per line, relative to the root; `--summary`
// prints the count of each side to stderr as well.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { testFiles } from './typescript-tests.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const IO = /^(?:node:)?(?:fs(?:\/promises)?|child_process)$/;
const DOCUMENT_IMPORT = /(?:\?(?:raw|url)$|\.(?:md|json|txt)$)/;

export type Reason =
  { kind: 'io'; name: string } | { kind: 'document'; specifier: string } | { kind: 'dynamic' };

function resolveRelative(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.mjs$/, '.mts'),
    base,
    `${base}.ts`,
    join(base, 'index.ts'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function importsOf(file: string): { specifiers: string[]; opaque: boolean } {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
  const specifiers: string[] = [];
  let opaque = false;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      specifiers.push(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteralLike(arg)) specifiers.push(arg.text);
      else opaque = true;
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteralLike(arg)) specifiers.push(arg.text);
      else opaque = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { specifiers, opaque };
}

/** The import graph of the test files, each module read once. */
export class Reader {
  private readonly direct = new Map<string, Reason | undefined>();
  private readonly edges = new Map<string, string[]>();

  private read(file: string): void {
    if (this.edges.has(file)) return;
    const { specifiers, opaque } = importsOf(file);
    let reason: Reason | undefined = opaque ? { kind: 'dynamic' } : undefined;
    const next: string[] = [];
    for (const s of specifiers) {
      if (IO.test(s)) reason ??= { kind: 'io', name: s };
      else if (DOCUMENT_IMPORT.test(s)) reason ??= { kind: 'document', specifier: s };
      else if (s.startsWith('.')) {
        const to = resolveRelative(file, s);
        if (to !== undefined) next.push(to);
      }
    }
    this.direct.set(file, reason);
    this.edges.set(file, next);
    for (const to of next) this.read(to);
  }

  /** Why `file` (an absolute path) can read a document, through its own imports or theirs. */
  reason(file: string): Reason | undefined {
    this.read(file);
    const seen = new Set<string>([file]);
    const queue = [file];
    while (queue.length > 0) {
      const at = queue.shift()!;
      const r = this.direct.get(at);
      if (r !== undefined) return r;
      for (const to of this.edges.get(at)!) {
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return undefined;
  }
}

/** Each test file, and whether a documents-only run keeps it. */
export function classify(root = ROOT): { file: string; reason: Reason | undefined }[] {
  const reader = new Reader();
  return testFiles(root).map((file) => ({ file, reason: reader.reason(join(root, file)) }));
}

if (import.meta.main) {
  const all = classify();
  const listed = all.filter((t) => t.reason !== undefined);
  if (listed.length === 0) {
    console.error('doc-tests: no test file reads a document; the reader is broken');
    process.exit(1);
  }
  for (const t of listed) console.log(relative(ROOT, join(ROOT, t.file)));
  if (process.argv.includes('--summary'))
    console.error(
      `doc-tests: ${listed.length} of ${all.length} test files can read a document; ` +
        `${all.length - listed.length} cannot`,
    );
}
