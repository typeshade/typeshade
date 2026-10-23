// The runtime and deferred executor carry no compiler and build no JavaScript from strings.
// Rule 11.11 and Rule 11.13; changes 0025 and 0085.
//
// Check each public subpath with every export retained:
// 1. Walk all source imports, including type-only and literal deferred imports. Refuse the
//    front end and external packages. A root-entry canary must find both.
// 2. Measure the single-file bundle and every split asset. Bound initial static downloads and
//    aggregate gzip bytes separately. CHANGELOG.md records each measured budget change.
// 3. Parse every asset. Refuse new Function, calls of Function or eval, and imports unless a
//    split import names an included local JavaScript asset literally. Remote, computed and
//    missing targets fail. Strings, comments and names such as lowerFunction are not calls.
//    The scan recognizes direct/property/comma-call spellings, not arbitrary aliases.
//
// Planted faults prove the scanner reads every artifact to its end. Browser/worker journeys
// separately exercise strict CSP, missing chunks and complete offline artifact maps.
// The runtime can defer its fuse executor and WebGL2 tier, or inline them in a single file.
//
// bun scripts/bundle-boundary.ts            check and print sizes
// bun scripts/bundle-boundary.ts --update   regenerate allowances for explicit review

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The package manifest: its name and its `exports`, for the subpaths the package names itself. */
const PKG = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  readonly name: string;
  readonly exports: Readonly<Record<string, string | { readonly default: string }>>;
};
const BUDGET = join(ROOT, 'scripts', 'bundle-budget.json');

/** Each checked subpath: its entry, and the directories its closure may reach. */
const SUBPATHS: readonly {
  readonly name: string;
  readonly entry: string;
  readonly allowed: readonly string[];
  /** The fewest modules a real closure of the entry holds. */
  readonly minModules: number;
}[] = [
  {
    name: 'typeshade/runtime',
    entry: 'src/runtime.ts',
    allowed: ['src/runtime.ts', 'src/runtime/', 'src/core/'],
    minModules: 15,
  },
  // The load-time emitter: the IR, the backends and the manifest builder, and no front end.
  {
    name: 'typeshade/emit',
    entry: 'src/emit.ts',
    allowed: ['src/emit.ts', 'src/core/'],
    minModules: 40,
  },
  // The fuse scope (change 0058): the recorder, the planner, the builder of the fused entry with
  // the WGSL writer it emits with, and the call layer they run through, and no front end.
  {
    name: 'typeshade/fuse',
    entry: 'src/fuse.ts',
    allowed: ['src/fuse.ts', 'src/core/'],
    minModules: 40,
  },
  // The common modules (change 0072, Rule 11.20): each host face is the baked module over the
  // runtime it imports as a consumer's generated module does, and nothing of the compiler.
  {
    name: 'typeshade/algorithms',
    entry: 'src/algorithms/index.ts',
    allowed: ['src/algorithms/', 'src/runtime-internal.ts', 'src/runtime/', 'src/core/'],
    minModules: 15,
  },
  {
    name: 'typeshade/random',
    entry: 'src/random/index.ts',
    allowed: ['src/random/', 'src/runtime-internal.ts', 'src/runtime/', 'src/core/'],
    minModules: 15,
  },
];

/** A subpath's budget: the most it may weigh, and the least a real bundle of it weighs. */
interface Budget {
  readonly bytes: number;
  readonly floor: number;
  readonly split?: { readonly initial: number; readonly floor: number; readonly total: number };
}

/** The source file the package's own `exports` maps `spec` to (`typeshade/runtime/internal` to
 *  `src/runtime-internal.ts`), or undefined for a specifier that is not the package's own. A
 *  shader package subpath (change 0072) maps to its host face, the `default` condition. */
function ownSubpath(spec: string): string | undefined {
  if (spec !== PKG.name && !spec.startsWith(`${PKG.name}/`)) return undefined;
  const subpath = spec === PKG.name ? '.' : `.${spec.slice(PKG.name.length)}`;
  const target = PKG.exports[subpath];
  if (target === undefined) return undefined;
  const file = typeof target === 'string' ? target : target.default;
  return file.replace(/^\.\//, '');
}

/** Every module `entry` reaches, relative to the root, and every bare specifier it names. */
export function closureOf(entry: string): {
  files: string[];
  bare: { from: string; spec: string }[];
} {
  const seen = new Set<string>();
  const bare: { from: string; spec: string }[] = [];
  const todo = [resolve(ROOT, entry)];
  while (todo.length > 0) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    // TypeScript's own scan: the imports and re-exports the file makes, and not the ones a
    // comment shows as an example.
    for (const { fileName: spec } of ts.preProcessFile(text, true, true).importedFiles) {
      if (!spec.startsWith('.')) {
        // The package's own subpath, named as a consumer's generated module names it (the baked
        // host face of a common module imports `typeshade/runtime/internal`, change 0072): the
        // file `exports` maps it to, walked as a relative import is.
        const own = ownSubpath(spec);
        if (own !== undefined) {
          todo.push(resolve(ROOT, own));
          continue;
        }
        bare.push({ from: relative(ROOT, file), spec });
        continue;
      }
      const target = resolve(dirname(file), spec.replace(/\.js$/, '.ts'));
      if (!existsSync(target))
        throw new Error(`${relative(ROOT, file)} imports ${spec}, which does not exist`);
      todo.push(target);
    }
  }
  return { files: [...seen].map((f) => relative(ROOT, f)).sort(), bare };
}

/** The part of Bun's bundler this uses; the repository's type check has no Bun types. */
interface Bundler {
  build(o: {
    entrypoints: string[];
    target: 'browser';
    format: 'esm';
    minify: boolean;
    splitting: boolean;
    outdir: string;
  }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: { readonly path: string; readonly kind: string; text(): Promise<string> }[];
  }>;
}

/** The entry bundled for the browser, minified, with every export kept: its text. */
async function bundleOf(
  entry: string,
  splitting = false,
): Promise<{ readonly entry: string; readonly chunks: ReadonlyMap<string, string> }> {
  const bun = (globalThis as { Bun?: Bundler }).Bun;
  if (bun === undefined) throw new Error('the size check needs Bun: run it with bun');
  // A random wrapper path changes Bun's generated names and moves gzip by a few bytes.
  // Keep the fixture's repository-relative path fixed; builds run sequentially and remove it.
  const dir = join(ROOT, 'dist', '.bundle-boundary');
  mkdirSync(dir, { recursive: true });
  try {
    const keep = join(dir, 'keep.ts');
    writeFileSync(
      keep,
      `import * as all from ${JSON.stringify(resolve(ROOT, entry))};\n(globalThis as Record<string, unknown>).all = all;\n`,
    );
    const built = await bun.build({
      entrypoints: [keep],
      target: 'browser',
      format: 'esm',
      minify: true,
      splitting,
      outdir: join(dir, 'out'),
    });
    if (!built.success)
      throw new Error(`${entry} did not bundle: ${built.logs.map(String).join('\n')}`);
    const chunks = new Map<string, string>();
    let main: string | undefined;
    for (const output of built.outputs) {
      const path = relative(join(dir, 'out'), output.path).replaceAll('\\', '/');
      chunks.set(path, await output.text());
      if (output.kind === 'entry-point') main = path;
    }
    if (main === undefined) throw new Error(`${entry} produced no entry artifact`);
    return { entry: main, chunks };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── the CSP scan ────────────────────────────────────────────────────────────────────────────

/** A way to build code at run time, which a strict content security policy refuses. */
export type Builder = 'new Function' | 'Function(' | 'eval(' | 'import(';

/** One place where a script builds code at run time. */
export interface CodeBuilder {
  readonly what: Builder;
  /** Where in the text it starts. */
  readonly at: number;
  /** A fixed path, present only for an import with a literal argument. */
  readonly specifier?: string;
}

/**
 * Every place where `text`, a script, builds code at run time: a `new Function`, a call of
 * `Function` or `eval` (bare, as a property such as `globalThis.eval`, or as `(0,eval)`) and a
 * dynamic `import(`. TypeScript parses the text, so only code counts. A name that ends in
 * `Function`, a string and a comment are no hit.
 */
export function codeBuilders(text: string): CodeBuilder[] {
  const file = ts.createSourceFile(
    'bundle.js',
    text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  const found: CodeBuilder[] = [];
  // What is called, past the parentheses and the comma: `(0,eval)(x)` is how a bundler writes an
  // indirect call of `eval`.
  const callee = (e: ts.Expression): ts.Expression => {
    while (true) {
      if (ts.isParenthesizedExpression(e)) e = e.expression;
      else if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.CommaToken)
        e = e.right;
      else return e;
    }
  };
  const names = (called: ts.Expression, name: string): boolean => {
    const e = callee(called);
    return (
      (ts.isIdentifier(e) && e.text === name) ||
      (ts.isPropertyAccessExpression(e) && e.name.text === name) ||
      (ts.isElementAccessExpression(e) &&
        ts.isStringLiteralLike(e.argumentExpression) &&
        e.argumentExpression.text === name)
    );
  };
  const visit = (node: ts.Node): void => {
    let what: Builder | undefined;
    if (ts.isNewExpression(node)) {
      if (names(node.expression, 'Function')) what = 'new Function';
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) what = 'import(';
      else if (names(node.expression, 'Function')) what = 'Function(';
      else if (names(node.expression, 'eval')) what = 'eval(';
    }
    if (what !== undefined) {
      const argument = ts.isCallExpression(node) ? node.arguments[0] : undefined;
      found.push({
        what,
        at: node.getStart(file),
        ...(what === 'import(' && argument !== undefined && ts.isStringLiteralLike(argument)
          ? { specifier: argument.text }
          : {}),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Static module edges of an emitted chunk. Dynamic edges are read by the CSP scan. */
function staticImports(text: string): string[] {
  const file = ts.createSourceFile(
    'chunk.js',
    text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  return file.statements.flatMap((s) =>
    (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) &&
    s.moduleSpecifier !== undefined &&
    ts.isStringLiteralLike(s.moduleSpecifier)
      ? [s.moduleSpecifier.text]
      : [],
  );
}

/** A package-owned local JavaScript asset. Missing, remote and computed imports are refused. */
function localAsset(
  from: string,
  specifier: string | undefined,
  chunks: ReadonlyMap<string, string>,
): string | undefined {
  if (specifier === undefined || !specifier.startsWith('./') || !/^[\w./-]+\.js$/.test(specifier))
    return undefined;
  const path = posix.normalize(posix.join(posix.dirname(from), specifier));
  return path.startsWith('../') || !chunks.has(path) ? undefined : path;
}

/** Check every emitted chunk, including deferred assets. Only literal imports of included local assets may load code. */
export function splitProblems(chunks: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [from, text] of chunks) {
    for (const specifier of staticImports(text))
      if (localAsset(from, specifier, chunks) === undefined)
        problems.push(
          `${from}: static import ${JSON.stringify(specifier)} is not an included local asset`,
        );
    for (const found of codeBuilders(text)) {
      if (found.what === 'import(' && localAsset(from, found.specifier, chunks) !== undefined)
        continue;
      problems.push(`${from}: ${found.what} at ${found.at} is not permitted`);
    }
  }
  return problems;
}

/** The bytes downloaded before any dynamic import: the entry and its static shared chunks. */
function initialChunks(entry: string, chunks: ReadonlyMap<string, string>): Set<string> {
  const initial = new Set<string>();
  const visit = (file: string): void => {
    if (initial.has(file)) return;
    initial.add(file);
    for (const specifier of staticImports(chunks.get(file)!)) {
      const target = localAsset(file, specifier, chunks);
      if (target !== undefined) visit(target);
    }
  };
  visit(entry);
  return initial;
}

/** Each way, as a bundler would write it, and an indirect `eval` with them. Planted in a string, to
 *  show that the scan sees each one. */
const PLANTED: readonly (readonly [Builder, string])[] = [
  ['new Function', 'new Function("a","return a")'],
  ['Function(', 'Function("return 1")()'],
  ['eval(', 'eval("1+1")'],
  ['eval(', '(0,eval)("1+1")'],
  ['import(', 'import("./planted.js")'],
];
const PLANTED_TEXT = PLANTED.map(([, code]) => `;${code};`).join('\n');

/** Code that only looks like one of the four: a longer name, a string, a comment, a regular
 *  expression, a template, `import.meta`, a name that is no call and a method named `import`. */
const LOOK_ALIKES = [
  'const lowerFunction=(x)=>x;lowerFunction(1);',
  'const note="new Function(eval(import(";',
  '// new Function("x")\n/* eval("y") */',
  'const re=/Function\\(/;',
  'const t=`eval(${1})`;',
  'const m=import.meta.url;',
  'const f=(x)=>x instanceof Function;',
  'const e=obj.evaluate(1),g=obj.import;x.import(2);',
].join('\n');

/** The text around `at`, on one line: what a failure prints of a hit. */
const around = (text: string, at: number): string =>
  text.slice(Math.max(0, at - 30), Math.min(text.length, at + 70)).replace(/\s+/g, ' ');

/** The ways the scan reports at or after `from`, in the order they stand. */
const waysFrom = (found: readonly CodeBuilder[], from: number): Builder[] =>
  found.filter((f) => f.at >= from).map((f) => f.what);

/** The ways `PLANTED_TEXT` plants, in order, and the four kinds as a sentence lists them. */
const PLANTED_WAYS = PLANTED.map(([what]) => what);
const KINDS = [...new Set(PLANTED_WAYS)];
const WAYS = `${KINDS.slice(0, -1).join(', ')} and ${KINDS.at(-1)}`;

async function main(): Promise<number> {
  const update = process.argv.includes('--update');
  const budgets = JSON.parse(readFileSync(BUDGET, 'utf8')) as Record<string, Budget>;
  // The instrument, first: a walk that cannot see the compiler from the root passes anything.
  const root = closureOf('src/index.ts');
  if (
    !root.files.some((f) => f.startsWith('src/compiler/')) ||
    !root.bare.some((b) => b.spec === 'typescript')
  ) {
    console.log(
      'FAIL  the walk finds no src/compiler/ or typescript from src/index.ts: it is blind',
    );
    return 1;
  }
  console.log('instrument: the walk finds src/compiler/ and typescript from src/index.ts');
  // The scan's instrument: a scan that reports nothing in a string with all four planted in it
  // passes a bundle that builds code, and one that reports the look-alikes fails a clean one.
  const planted = waysFrom(codeBuilders(PLANTED_TEXT), 0);
  if (planted.join() !== PLANTED_WAYS.join()) {
    console.log(
      `FAIL  the scan reports [${planted.join(', ')}] of [${PLANTED_WAYS.join(', ')}] planted in a string: it is blind`,
    );
    return 1;
  }
  const alike = codeBuilders(LOOK_ALIKES);
  if (alike.length > 0) {
    console.log(
      `FAIL  the scan reports [${alike.map((a) => a.what).join(', ')}] in code that only looks like one: it fails a clean bundle`,
    );
    return 1;
  }
  console.log(
    `instrument: the scan reports ${WAYS} planted in a string, and nothing in their look-alikes`,
  );
  let failures = 0;
  for (const s of SUBPATHS) {
    const { files, bare } = closureOf(s.entry);
    const outside = files.filter(
      (f) => !s.allowed.some((a) => (a.endsWith('/') ? f.startsWith(a) : f === a)),
    );
    for (const f of outside) {
      console.log(`FAIL  ${s.name} reaches ${f}, outside ${s.allowed.join(', ')}`);
      failures++;
    }
    for (const b of bare) {
      console.log(`FAIL  ${s.name} imports "${b.spec}" (${b.from}): the runtime names no package`);
      failures++;
    }
    if (files.length < s.minModules) {
      console.log(
        `FAIL  ${s.name} reaches ${files.length} modules, under its floor of ${s.minModules}: the walk is not reading it`,
      );
      failures++;
    }
    const single = await bundleOf(s.entry);
    if (single.chunks.size !== 1) {
      console.log(`FAIL  ${s.name}: the single-file build emitted extra assets`);
      failures++;
    }
    const text = single.chunks.get(single.entry)!;
    const size = gzipSync(text, { level: 9 }).length;
    const budget = budgets[s.name];
    if (update)
      budgets[s.name] = {
        bytes: Math.ceil((size * 1.1) / 100) * 100,
        floor: Math.floor(size / 2 / 100) * 100,
      };
    else if (budget === undefined) {
      console.log(`FAIL  ${s.name} has no budget in scripts/bundle-budget.json; run with --update`);
      failures++;
    } else if (size > budget.bytes) {
      console.log(
        `FAIL  ${s.name} is ${size} bytes gzipped, over its budget of ${budget.bytes}: move the budget in this pull request, where a reviewer reads it`,
      );
      failures++;
    } else if (size < budget.floor) {
      console.log(
        `FAIL  ${s.name} is ${size} bytes gzipped, under its floor of ${budget.floor}: the bundle measured nothing`,
      );
      failures++;
    }
    // The scan reads the bundle with the four planted after it. All four must come back, or the
    // scan did not read the bundle to its end.
    const scanned = codeBuilders(`${text}\n${PLANTED_TEXT}`);
    const seen = waysFrom(scanned, text.length);
    const readAll = seen.join() === PLANTED_WAYS.join();
    if (!readAll) {
      console.log(
        `FAIL  the scan of ${s.name} reports [${seen.join(', ')}] of [${PLANTED_WAYS.join(', ')}] planted after its text: it does not read the bundle to its end`,
      );
      failures++;
    }
    const builds = scanned.filter((c) => c.at < text.length);
    for (const c of builds) {
      console.log(
        `FAIL  ${s.name} builds code at run time with ${c.what} (Rules 11.7 and 11.13): …${around(text, c.at)}…`,
      );
      failures++;
    }
    const verdict = !readAll
      ? 'not read to its end'
      : builds.length === 0
        ? `none of ${WAYS}`
        : `${builds.length} found, listed above`;
    const b = budgets[s.name];
    console.log(
      `${s.name}: ${files.length} modules, none of the compiler; ${size} bytes minified and gzipped (floor ${b?.floor ?? '?'}, budget ${b?.bytes ?? '?'}); scan: ${Buffer.byteLength(text)} bytes read, ${verdict}`,
    );
    const split = await bundleOf(s.entry, true);
    const initial = initialChunks(split.entry, split.chunks);
    let initialSize = 0,
      totalSize = 0;
    const violations = splitProblems(split.chunks);
    for (const problem of violations) {
      console.log(`FAIL  ${s.name}: ${problem}`);
      failures++;
    }
    for (const [name, code] of split.chunks) {
      const bytes = gzipSync(code, { level: 9 }).length;
      totalSize += bytes;
      if (initial.has(name)) initialSize += bytes;
      console.log(
        `${s.name} split ${name}: ${bytes} gzip bytes (${name === split.entry ? 'entry' : initial.has(name) ? 'initial shared' : 'deferred/shared'})`,
      );
      // Each individual asset must be read to its end, including a deferred executor.
      if (
        waysFrom(codeBuilders(`${code}\n${PLANTED_TEXT}`), code.length).join() !==
        PLANTED_WAYS.join()
      ) {
        console.log(`FAIL  ${s.name}: the scan did not read ${name} to its end`);
        failures++;
      }
    }
    if (update)
      budgets[s.name] = {
        ...budgets[s.name]!,
        split: {
          initial: initialSize,
          floor: Math.floor(initialSize / 2 / 100) * 100,
          total: totalSize,
        },
      };
    else if (
      b?.split === undefined ||
      initialSize > b.split.initial ||
      totalSize > b.split.total ||
      initialSize < b.split.floor
    ) {
      console.log(
        `FAIL  ${s.name}: split initial ${initialSize}, total ${totalSize} gzip bytes exceed a budget or miss its floor; record measurements in scripts/bundle-budget.json`,
      );
      failures++;
    }
    console.log(
      `${s.name} split: initial ${initialSize}, deferred ${totalSize - initialSize}, aggregate ${totalSize} gzip bytes; ${split.chunks.size} assets scanned`,
    );
  }
  if (update) writeFileSync(BUDGET, `${JSON.stringify(budgets, null, 2)}\n`);
  return failures;
}

if (import.meta.main === true || process.argv[1] === fileURLToPath(import.meta.url))
  main().then(
    (n) => process.exit(n === 0 ? 0 : 1),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
