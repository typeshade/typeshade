// ═══ The unit tests a TypeScript leg runs: the ones that load TypeScript ═══
//
// CI's `typescript-versions` job runs the unit suite again on the newest 5.x and on 6.0, because
// the editors that load the language service ship those versions and a newer TypeScript has moved
// what this repository reads (TS2454 on workgroup memory from 5.7, #247; the printed types the API
// surface snapshot reads, on 5.7 and on 6.0). A test file that never loads `typescript` gives the
// same result on every version, so a leg that runs it again finds nothing `check` did not.
//
// This script lists the test files of `vitest.config.ts` that can load TypeScript, so a leg runs
// only those. A file is listed when it, or a module it imports, transitively:
//
//   - imports `typescript` or `typescript-eslint` (a subpath counts);
//   - imports a `.shade` module, which the TypeShade plugin compiles through `compile()`;
//   - imports a module whose name is not a string literal, which this reader cannot follow;
//   - starts a child process, which could run `tsc` or `compile()` out of sight.
//
// The reader errs toward listing a file: a file listed that did not need it costs time, and a file
// left out that needed it hides a version's break. `src/typescript-tests.test.ts` holds the
// known members on each side, so a reader that stopped finding imports cannot pass as one that
// lists nothing.
//
// Usage: `bun scripts/typescript-tests.ts` prints one path per line, relative to the root;
// `--summary` prints the count of each side to stderr as well.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The packages that are TypeScript, whatever their version. */
const TYPESCRIPT = /^(?:typescript|typescript-eslint)(?:\/|$)/;
/** The patterns `vitest.config.ts` includes. */
const INCLUDE = /^(?:src|examples)\/.*\.test\.ts$/;
const CHILD_PROCESS = /^(?:node:)?child_process$/;

/** Why a module can load TypeScript, or `undefined` when it cannot. */
export type Reason =
  | { kind: 'package'; name: string }
  | { kind: 'shade'; specifier: string }
  | { kind: 'dynamic' }
  | { kind: 'process' };

/** The test files `vitest run` finds, relative to the root. */
export function testFiles(root = ROOT): string[] {
  return execFileSync(
    'git',
    ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter((f) => INCLUDE.test(f) && existsSync(join(root, f)))
    .sort();
}

/** The module a relative specifier names, as a `.ts` file, or `undefined` past the tree. */
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

/** A module's imports, and whether it has a dynamic import whose name is not a string literal. */
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
      if (TYPESCRIPT.test(s)) reason ??= { kind: 'package', name: s };
      else if (CHILD_PROCESS.test(s)) reason ??= { kind: 'process' };
      else if (/\.shade(?:\.[cm]?[jt]s)?$/.test(s)) reason ??= { kind: 'shade', specifier: s };
      else if (s.startsWith('.')) {
        const to = resolveRelative(file, s);
        if (to !== undefined) next.push(to);
      }
    }
    this.direct.set(file, reason);
    this.edges.set(file, next);
    for (const to of next) this.read(to);
  }

  /** Why `file` (an absolute path) can load TypeScript, through its own imports or theirs. */
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

/** Each test file, and whether a TypeScript leg runs it. */
export function classify(root = ROOT): { file: string; reason: Reason | undefined }[] {
  const reader = new Reader();
  return testFiles(root).map((file) => ({ file, reason: reader.reason(join(root, file)) }));
}

if (import.meta.main) {
  const all = classify();
  const listed = all.filter((t) => t.reason !== undefined);
  if (listed.length === 0) {
    console.error('typescript-tests: no test file loads TypeScript; the reader is broken');
    process.exit(1);
  }
  for (const t of listed) console.log(relative(ROOT, join(ROOT, t.file)));
  if (process.argv.includes('--summary'))
    console.error(
      `typescript-tests: ${listed.length} of ${all.length} test files load TypeScript; ` +
        `${all.length - listed.length} give the same result on every version`,
    );
}
