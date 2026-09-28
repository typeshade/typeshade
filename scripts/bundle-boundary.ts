// ═══ The runtime carries no compiler (Rule 11.11, change 0025) ═══
//
// `typeshade/runtime` is what an application ships to run a compiled program, and the point of
// it is that the application does not ship the compiler: the TypeScript front end is 1.4 MB
// gzipped with TypeScript, the runtime about 10 KB. Two checks hold that, over the subpath's
// source:
//
//   1. THE CLOSURE. Every module the subpath's entry reaches through its imports, type-only ones
//      included, is walked. A file of `src/compiler/` fails it, and so does any bare specifier
//      (`typescript`, `node:fs`): the runtime is `src/runtime/` and `src/core/` alone.
//   2. THE SIZE. The entry is bundled for the browser, minified, with every export kept, and
//      gzipped. Its size must not pass its budget in `scripts/bundle-budget.json`, which is set
//      at the size the subpath landed with. A rise past it is a reviewed change: the budget moves
//      in the same pull request, where a reviewer reads the number.
//
//   bun scripts/bundle-boundary.ts            check, and print each size
//   bun scripts/bundle-boundary.ts --update   also write the measured sizes as the budgets

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUDGET = join(ROOT, 'scripts', 'bundle-budget.json');

/** Each checked subpath: its entry, and the directories its closure may reach. */
const SUBPATHS: readonly {
  readonly name: string;
  readonly entry: string;
  readonly allowed: readonly string[];
}[] = [
  {
    name: 'typeshade/runtime',
    entry: 'src/runtime.ts',
    allowed: ['src/runtime.ts', 'src/runtime/', 'src/core/'],
  },
];

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
  build(o: { entrypoints: string[]; target: 'browser'; format: 'esm'; minify: boolean }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: { text(): Promise<string> }[];
  }>;
}

/** The entry bundled for the browser, minified, with every export kept, gzipped: its bytes. */
async function gzippedSize(entry: string): Promise<number> {
  const bun = (globalThis as { Bun?: Bundler }).Bun;
  if (bun === undefined) throw new Error('the size check needs Bun: run it with bun');
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-boundary-'));
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
    });
    if (!built.success)
      throw new Error(`${entry} did not bundle: ${built.logs.map(String).join('\n')}`);
    return gzipSync(await built.outputs[0]!.text(), { level: 9 }).length;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const update = process.argv.includes('--update');
  const budgets = JSON.parse(readFileSync(BUDGET, 'utf8')) as Record<string, number>;
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
    const size = await gzippedSize(s.entry);
    const budget = budgets[s.name];
    if (update) budgets[s.name] = size;
    else if (budget === undefined) {
      console.log(`FAIL  ${s.name} has no budget in scripts/bundle-budget.json; run with --update`);
      failures++;
    } else if (size > budget) {
      console.log(
        `FAIL  ${s.name} is ${size} bytes gzipped, over its budget of ${budget}: move the budget in this pull request, where a reviewer reads it`,
      );
      failures++;
    }
    console.log(
      `${s.name}: ${files.length} modules, none of the compiler; ${size} bytes minified and gzipped (budget ${budgets[s.name] ?? 'none'})`,
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
