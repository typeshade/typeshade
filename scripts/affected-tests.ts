// Select code-PR tests from the current static import graph. Runtime records can omit
// conditional imports; opaque inputs and uncertain changes retain the applicable suite.
// Usage: bun scripts/affected-tests.ts [--base REF] [--typescript] [--run]
// Without --run, print a JSON plan. Without --base, keep the full applicable suite.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify as documentTests, Reader } from './doc-tests.js';
import { classify as typescriptTests, testFiles } from './typescript-tests.js';

export interface Selection {
  mode: 'full' | 'affected';
  reason: string;
  files: string[];
  total: number;
  changed: string[];
  base?: string;
}

export interface SelectionOptions {
  root: string;
  base?: string;
  typescript?: boolean;
  config?: string;
}

const slash = (path: string): string => path.replaceAll('\\', '/');
const unique = (files: string[]): string[] => [...new Set(files)].sort();
const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Use Vitest's public static resolver, including its configuration-dependency fallback. */
export async function staticRelated(
  root: string,
  changed: string[],
  config?: string,
): Promise<string[]> {
  const { createVitest } = await import('vitest/node');
  const ctx = await createVitest({
    root,
    config,
    run: true,
    watch: false,
    related: changed.map((file) => resolve(root, file)),
    experimental: { recordDependencies: false },
    reporters: [],
  });
  try {
    const reader = new Reader({ conservative: true });
    let opaqueSetup = false;
    // The root globalSetup also runs for workspace projects, but Vitest's affected resolver
    // only walks each project's setup. Other global inputs can read files outside that graph.
    for (const project of [ctx.getRootProject(), ...ctx.projects]) {
      const config = project.config;
      if (config.globalSetup.length || config.environment !== 'node') {
        opaqueSetup = true;
        break;
      }
      const inputs = [
        ...config.setupFiles,
        ...config.snapshotSerializers,
        config.runner,
        config.snapshotEnvironment,
        typeof config.diff === 'string' ? config.diff : undefined,
      ].filter((file): file is string => typeof file === 'string');
      if (inputs.some((file) => reader.reason(resolve(config.root, file)) !== undefined)) {
        opaqueSetup = true;
        break;
      }
    }
    const specs = opaqueSetup
      ? await ctx.globTestSpecifications()
      : await ctx.getRelevantTestSpecifications();
    return unique(specs.map((spec) => slash(relative(root, spec.moduleId))));
  } finally {
    await ctx.close();
  }
}

/** Compute a plan without executing tests. Uncertain inputs broaden the plan, never empty it. */
export async function selectTests(options: SelectionOptions): Promise<Selection> {
  const root = resolve(options.root);
  const all = unique(testFiles(root));
  if (!all.length) throw new Error('No test files found; refusing to infer a passing empty suite.');
  let candidates = all;
  const changed: string[] = [];
  let base: string | undefined;
  const full = (reason: string): Selection => ({
    mode: 'full',
    reason,
    files: candidates,
    total: candidates.length,
    changed,
    base,
  });
  if (options.typescript) {
    try {
      const classified = typescriptTests(root);
      const listed = classified
        .filter((test) => test.reason !== undefined)
        .map((test) => test.file);
      if (!listed.length) return full('No TypeScript candidates identified; keep every test.');
      candidates = unique(listed);
    } catch (error) {
      return full(`TypeScript classification failed: ${message(error)}`);
    }
  }
  if (!options.base) return full('No PR base supplied.');
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const ref = git('rev-parse', '--verify', '--end-of-options', `${options.base}^{commit}`).trim();
    base = git('merge-base', ref, 'HEAD').trim();
    const rows = git('diff', '--name-status', '-z', '--find-renames', base, 'HEAD').split('\0');
    let structural = false;
    for (let i = 0; i < rows.length && rows[i];) {
      const status = rows[i++]!;
      const count = /^[RC]/.test(status) ? 2 : 1;
      for (let n = 0; n < count; n++) {
        const file = rows[i++];
        if (!file) throw new Error('Incomplete Git change record.');
        changed.push(file);
      }
      if (status !== 'A' && status !== 'M') structural = true;
    }
    if (git('status', '--porcelain', '-z', '--untracked-files=normal'))
      return full('Working tree differs from HEAD.');
    if (structural) return full('Deleted, renamed, copied or type-changed input.');
  } catch (error) {
    return full(`Cannot establish the committed PR diff: ${message(error)}`);
  }
  if (!changed.length)
    return {
      mode: 'affected',
      reason: 'No committed changes.',
      files: [],
      total: candidates.length,
      changed,
      base,
    };
  // Config, dependencies, fixtures, snapshots, shaders and non-source inputs remain full.
  // The source allowlist deliberately excludes scripts and generated shader host views.
  const uncertain = changed.find(
    (file) =>
      !/^(?:src|examples)\/.*\.(?:[cm]?[jt]s)$/.test(file) ||
      /\.shade(?:\.|$)|(?:^|\/)(?:__fixtures__|fixtures|__snapshots__)(?:\/|$)/.test(file),
  );
  if (uncertain) return full(`Input outside the source selection boundary: ${uncertain}`);
  try {
    const opaque = documentTests(root, { conservative: true });
    if (opaque.length !== all.length || opaque.some((test) => !all.includes(test.file)))
      throw new Error('Input classification does not cover the test inventory.');
    const related = await staticRelated(root, changed, options.config);
    if (related.some((file) => isAbsolute(file) || !all.includes(file)))
      throw new Error('Vitest returned a test outside the known inventory.');
    const keep = new Set([
      ...related,
      ...opaque.filter((test) => test.reason !== undefined).map((test) => test.file),
      ...changed.filter((file) => all.includes(file)),
    ]);
    const files = candidates.filter((file) => keep.has(file));
    return {
      mode: files.length === candidates.length ? 'full' : 'affected',
      reason:
        files.length === candidates.length
          ? 'Static dependencies and opaque inputs retain every candidate.'
          : 'Static dependencies plus opaque filesystem, process and package inputs.',
      files,
      total: candidates.length,
      changed,
      base,
    };
  } catch (error) {
    return full(`Static selection failed: ${message(error)}`);
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const options: SelectionOptions = { root: fileURLToPath(new URL('..', import.meta.url)) };
    let run = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--run') run = true;
      else if (arg === '--typescript') options.typescript = true;
      else if (
        ['--root', '--base', '--config'].includes(arg!) &&
        args[i + 1] &&
        !args[i + 1]!.startsWith('--')
      ) {
        const value = args[++i]!;
        if (arg === '--base') options.base = value;
        else if (arg === '--root') options.root = resolve(value);
        else options.config = resolve(value);
      } else throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
    const start = performance.now();
    const selection = await selectTests(options);
    const summary =
      `affected-tests: ${selection.files.length}/${selection.total} files (${selection.mode}), ` +
      `${((performance.now() - start) / 1000).toFixed(2)}s selection; ${selection.reason}`;
    console.error(summary);
    if (!run) console.log(JSON.stringify(selection, null, 2));
    else {
      if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `\n### Unit test selection\n\n${summary}\n`,
        );
      // An empty explicit set is a no-op; an argument-less Vitest invocation runs everything.
      if (selection.files.length) {
        const tests =
          selection.mode === 'full' && !options.typescript
            ? []
            : selection.files.map((file) => resolve(options.root, file));
        const result = spawnSync(
          'node',
          [
            resolve(options.root, 'node_modules/vitest/vitest.mjs'),
            'run',
            ...(options.config ? ['--config', options.config] : []),
            ...tests,
          ],
          { cwd: options.root, stdio: 'inherit' },
        );
        if (result.error) throw result.error;
        process.exitCode = result.status ?? 1;
      }
    }
  } catch (error) {
    console.error(message(error));
    process.exitCode = 1;
  }
}
