// ═══ The manifest npm publishes — DERIVED from the real one, never a second copy of it ═══
//
// The package resolves to SOURCE in this repository and always will: `exports` names
// ./src/*.ts, the test files import themselves by package name through that map, and
// `api-surface.test.ts` reads it as the list of entry points to parse. A tarball cannot
// ship that map — a consumer installing from npm has no TypeScript toolchain promised to
// them — so the published manifest points at ./dist instead.
//
// WHY NOT `publishConfig.exports`. Because npm does not apply it. `self-contained.test.ts`
// arm S5 records the measurement (F6: neither npm 10.9.7 nor `bun pm pack` 1.3.11 applies
// publishConfig FIELD overrides; main/module/types/exports are a pnpm-and-yarn extension)
// and fails the build on any publishConfig key outside access/tag/registry/provenance.
// Re-measured while writing this file, same npm 10.9.7: a package with
// `publishConfig.exports` packs its package.json BYTE-IDENTICAL, overrides included and
// unapplied. A block that changes nothing while looking authoritative is worse than absent.
//
// WHY NOT A `prepack` SCRIPT. Arm S4 forbids every pack/publish lifecycle hook, and its
// reason applies here exactly: `prepack` runs inside `npm pack` too, so a read-only
// operation would mutate the tracked tree, and a Ctrl-C partway through would leave it
// mutated with nothing saying so. This script is invoked DELIBERATELY — by the publish
// workflow, or by a human verifying a tarball — and says what it did.
//
// WHY THIS IS NOT A SECOND AUTHORITY (CLAUDE.md §12). It does not carry a list of entry
// points. It READS `exports` and rewrites each target by one rule — `./<dir>/<path>.ts`
// becomes `./dist/<dir>/<path>.js` — which is exactly what tsconfig.json's `rootDir: "."`
// makes true on disk. A subpath added to `exports` is picked up with no edit here, and a
// subpath whose build output is missing fails the verification below by name. That is the
// drift S5 objected to, closed rather than re-opened in a new file.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PKG_DIR = resolve(HERE, '..');

export interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly main?: string;
  readonly types?: string;
  readonly exports: Readonly<Record<string, string>>;
  readonly sideEffects?: readonly string[];
  /** Command name → source entry (`./src/cli/bin.ts`). Rewritten by the same one rule as
   *  `exports`, to the emitted `.js`, which keeps the source's `#!/usr/bin/env node` line. */
  readonly bin?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

/** True for a subpath whose target is ALREADY a built declaration file — `./shade`, the
 *  ambient authoring lib `scripts/emit-shade-dts.ts` writes out of `SHADE_DTS`. There is no
 *  source module behind it to rewrite and no runtime module to import: the consumer names it
 *  in their `types` array, never in an `import`. It is the one shape that is not a `./x.ts`
 *  source path, and it is recognised BY that shape rather than by name, so a second generated
 *  .d.ts subpath needs no edit here either. */
export function isTypesOnly(target: string): boolean {
  return target.startsWith('./dist/') && target.endsWith('.d.ts');
}

/** The one rule. `./src/core/ir/index.ts` → `./dist/src/core/ir/index` — the caller appends
 *  `.js` or `.d.ts`. Mirrors tsconfig.json's `rootDir: "."` + `outDir: "./dist"`: the emit
 *  reproduces the source tree one level down, so the transform is a prefix and a suffix and
 *  nothing else. Throws rather than guessing on a target shape the rule does not cover. */
export function distStem(target: string): string {
  if (!target.startsWith('./') || !target.endsWith('.ts') || isTypesOnly(target))
    throw new Error(
      `exports target ${JSON.stringify(target)} is not a "./<path>.ts" source path. The ` +
        'published manifest is derived from the source map by one rule; a target of another ' +
        'shape has no derivation and must be given one here, deliberately.',
    );
  return `./dist/${target.slice(2, -'.ts'.length)}`;
}

/** A conditional export for one subpath. `types` FIRST — TypeScript resolves conditions in
 *  order and takes the first match, so a `types` condition after `import` is never read.
 *  `import` and `default` carry the same file: the package is ESM-only (`"type": "module"`,
 *  `module: nodenext`), so there is no second build to point a `require` condition at, and
 *  `default` is what a bundler falls back to when it matches neither name. */
function subpathExport(target: string): Record<string, string> {
  // Types-only: `types` and nothing else, deliberately. Giving it an `import`/`default` would
  // advertise `import 'typeshade/shade'` as a thing a consumer can write, and it is not — the
  // file is a `.d.ts` with no runtime half. Resolution failing there is the correct answer.
  if (isTypesOnly(target)) return { types: target };
  const stem = distStem(target);
  return { types: `${stem}.d.ts`, import: `${stem}.js`, default: `${stem}.js` };
}

/** The manifest as it should look inside the tarball. Pure: it reads nothing from disk. */
export function derivePublishManifest(pkg: Manifest): Record<string, unknown> {
  const root = pkg.exports['.'];
  if (root === undefined) throw new Error('`exports` has no "." subpath to derive `main` from');
  const exports: Record<string, Record<string, string>> = {};
  for (const [subpath, target] of Object.entries(pkg.exports))
    exports[subpath] = subpathExport(target);
  return {
    ...pkg,
    main: `${distStem(root)}.js`,
    types: `${distStem(root)}.d.ts`,
    exports,
    // The command runs the emitted JavaScript under Node; the source `bin` is for this tree,
    // where Bun runs the TypeScript directly.
    ...(pkg.bin === undefined
      ? {}
      : {
          bin: Object.fromEntries(
            Object.entries(pkg.bin).map(([name, target]) => [name, `${distStem(target)}.js`]),
          ),
        }),
    // Both spellings of the same module. A bundler that resolves the consumer's import
    // through `exports` sees the dist path; one pointed at the shipped source (the tarball
    // carries src/ as well, for the declaration maps) sees the .ts path. Either way
    // `installStmtSink()` at module scope survives tree-shaking — drop that module and
    // every builder call throws SD0012, which is the whole reason this field is not `false`.
    sideEffects: (pkg.sideEffects ?? []).flatMap((entry) =>
      entry.endsWith('.ts') ? [`${distStem(entry)}.js`, entry] : [entry],
    ),
  };
}

/** Every file the derived manifest promises, and whether the build produced it. */
export function verifyTargets(
  derived: Record<string, unknown>,
  pkgDir: string = PKG_DIR,
): { readonly path: string; readonly ok: boolean }[] {
  const exports = derived['exports'] as Record<string, Record<string, string>>;
  const paths = new Set<string>([derived['main'] as string, derived['types'] as string]);
  for (const conditions of Object.values(exports))
    for (const p of Object.values(conditions)) paths.add(p);
  for (const p of Object.values((derived['bin'] ?? {}) as Record<string, string>)) paths.add(p);
  return [...paths].sort().map((p) => ({ path: p, ok: existsSync(join(pkgDir, p.slice(2))) }));
}

function main(argv: readonly string[]): number {
  const write = argv.includes('--write');
  const manifestPath = join(PKG_DIR, 'package.json');
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const derived = derivePublishManifest(pkg);
  const checked = verifyTargets(derived);
  const missing = checked.filter((c) => !c.ok);

  for (const c of checked) console.error(`${c.ok ? 'ok   ' : 'MISS '} ${c.path}`);
  console.error(
    `${checked.length - missing.length}/${checked.length} entry-point files present in dist/`,
  );
  if (missing.length > 0) {
    console.error(
      `\n${missing.length} file(s) the published exports map promises do not exist. Run ` +
        '`bun run build` first; if they are still missing, the emit layout and this ' +
        'derivation disagree and one of the two is wrong — do not publish.',
    );
    return 1;
  }

  const text = `${JSON.stringify(derived, null, 2)}\n`;
  if (!write) {
    process.stdout.write(text);
    console.error(
      '\n(preview only — nothing written. Re-run with --write to replace package.json.)',
    );
    return 0;
  }
  writeFileSync(manifestPath, text);
  console.error(
    '\npackage.json is now PUBLISH-SHAPED: its exports resolve to dist/, not src/. The ' +
      'working tree is modified — restore it with `git checkout -- package.json`. Intended ' +
      'for the ephemeral checkout the publish workflow runs in.',
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)));
