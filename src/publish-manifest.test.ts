// ═══ The published entry points are DERIVED from `exports`, and the build really makes them ═══
//
// Four failures, one arm each: a derived map that drifts from `exports` (D1), a `sideEffects`
// list quietly dropped or falsified on the way out (D2), an entry point the build never emits
// (D3), and an emitted examples set that is no longer the published entry's closure (D4).
//
// D1/D2 are about the DERIVATION and read nothing from disk: every subpath in `exports` must
// come out of `scripts/publish-manifest.ts` with a dist target, `types` must come first in the
// condition order (TypeScript takes the FIRST matching condition, so a `types` written after
// `import` is never read and the consumer silently falls back to `any`), and a target shape the
// one rewrite rule does not cover must throw rather than be guessed at. This is what keeps the
// published map from becoming the second authority `self-contained.test.ts` S5 rejected: there
// is no list of entry points here or in the script, only `exports` and one transform.
//
// D3 is about the BUILD, and is the arm that would have caught the layout bug this work
// started from: `tsc` copies import specifiers verbatim, so emitting src/ to dist/ root left
// every `from '../src/index.js'` in dist/examples/*.js pointing at a dist/src/ that did not
// exist. A file named in the published exports map that the emit does not produce is a package
// whose entry point 404s on first import, and npm cannot un-publish a version.
//
// D3 needs `bun run build` to have run. `bun run test` is documented and wired to follow it
// (ci.yml runs the two in that order in one job), but a developer running vitest alone on a
// fresh clone has no dist/, and failing there would be a gate reporting on something the run
// never claimed to do — so it skips, visibly, rather than reddening.

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import {
  derivePublishManifest,
  distStem,
  verifyTargets,
  type Manifest,
} from '../scripts/publish-manifest.js'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as Manifest
const DIST = join(PKG_DIR, 'dist')
const BUILT = existsSync(DIST)

describe('the manifest npm publishes', () => {
  it('D1 — every `exports` subpath is derived, with `types` first', () => {
    const derived = derivePublishManifest(PKG)
    const exports = derived['exports'] as Record<string, Record<string, string>>
    const subpaths = Object.keys(PKG.exports)

    expect(
      subpaths.length,
      'read no `exports` subpaths — the manifest reader is broken and D1/D2 are vacuous',
    ).toBeGreaterThanOrEqual(5)
    expect(
      Object.keys(exports).sort(),
      'the derived map and `exports` describe different subpaths. They cannot: the derivation ' +
        'iterates `exports` itself. If this fails the script grew a list of its own.',
    ).toEqual(subpaths.sort())

    for (const [subpath, conditions] of Object.entries(exports)) {
      expect(
        Object.keys(conditions),
        `${subpath}: condition ORDER is load-bearing — TypeScript and Node both take the first ` +
          'match, so `types` after `import` is never read and the consumer silently gets `any`',
      ).toEqual(['types', 'import', 'default'])
      expect(conditions['types']).toMatch(/^\.\/dist\/.*\.d\.ts$/)
      expect(conditions['import']).toMatch(/^\.\/dist\/.*\.js$/)
      expect(conditions['default']).toBe(conditions['import'])
    }

    expect(derived['main']).toBe(`${distStem(PKG.exports['.']!)}.js`)
    expect(derived['types']).toBe(`${distStem(PKG.exports['.']!)}.d.ts`)
  })

  it('D2 — `sideEffects` is carried over, never dropped or falsified', () => {
    const derived = derivePublishManifest(PKG)
    const sideEffects = derived['sideEffects'] as readonly string[]
    expect(
      sideEffects.length,
      'the published manifest lost `sideEffects`. src/core/ir/builder.ts calls ' +
        'installStmtSink() at module scope; a bundler told the package is side-effect-free ' +
        'tree-shakes that module away and every builder call throws SD0012 at run time.',
    ).toBeGreaterThanOrEqual(2)
    expect(
      sideEffects,
      'the dist spelling of each source entry must be present — a consumer resolving through ' +
        'the published `exports` map only ever sees dist paths',
    ).toContain('./dist/src/core/ir/builder.js')
    expect(sideEffects).toContain('./src/core/ir/builder.ts')
  })

  it('D2 — a target the one rewrite rule does not cover throws instead of being guessed', () => {
    expect(() => distStem('./dist/src/index.js')).toThrow(/not a "\.\/<path>\.ts" source path/)
    expect(() => distStem('src/index.ts')).toThrow(/not a "\.\/<path>\.ts" source path/)
  })

  it.runIf(BUILT)('D3 — the build produces every file the published map promises', () => {
    const checked = verifyTargets(derivePublishManifest(PKG), PKG_DIR)
    expect(checked.length, 'verified 0 paths — the check is vacuous').toBeGreaterThanOrEqual(
      2 * Object.keys(PKG.exports).length,
    )
    expect(
      checked.filter((c) => !c.ok).map((c) => c.path),
      'file(s) the published `exports` map names that `tsc --build` did not emit. A consumer ' +
        'importing that subpath gets a resolution failure on the first hop, and npm forbids ' +
        'republishing a version, so the bad tarball is permanent. Either the emit layout ' +
        '(tsconfig.json `rootDir`/`outDir`) or the derivation rule is wrong — they are the ' +
        'only two inputs.',
    ).toEqual([])
  })

  it.skipIf(BUILT)('D3 — SKIPPED: no dist/ in this tree; run `bun run build` first', () => {})

  // D4 — tsconfig.json's examples exclusions are "everything unreachable from the entry",
  // recomputed rather than trusted. Without this the list is a hand-curated allowlist: adding
  // an example to the registry would silently not be emitted (its dist path 404s for anyone
  // importing `typeshade/examples` and reading `.module` off that entry), and deleting a
  // helper would leave a stale name behind that nothing notices. Composite projects cannot
  // express "this entry and its closure" — `files` on its own raises TS6307 — so the pattern
  // has to be stated as an exclusion list and then CHECKED against the closure.
  it('D4 — the emitted examples are exactly `examples/index.ts` and its closure', () => {
    const ENTRY = 'examples/index.ts'
    const program = ts.createProgram([join(PKG_DIR, ENTRY)], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    })
    const reachable = new Set(
      program
        .getSourceFiles()
        .map((f) => f.fileName)
        .filter((f) => f.startsWith(`${join(PKG_DIR, 'examples')}/`))
        .map((f) => `examples/${f.slice(join(PKG_DIR, 'examples').length + 1)}`),
    )
    expect(
      reachable.size,
      `resolved nothing from ${ENTRY} — the reader is broken, not the tsconfig`,
    ).toBeGreaterThanOrEqual(20)
    expect(reachable, 'the entry itself must be in its own closure').toContain(ENTRY)

    const candidates = readdirSync(join(PKG_DIR, 'examples'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.shade.ts'))
      .map((f) => `examples/${f}`)
    const shouldExclude = candidates.filter((f) => !reachable.has(f)).sort()

    const tsconfig = JSON.parse(
      // tsconfig.json carries `//` line comments only; a block comment added to it makes this
      // parse THROW, which is the right failure — it is not a silent empty read.
      readFileSync(join(PKG_DIR, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
    ) as { exclude: string[] }
    const excluded = tsconfig.exclude
      .filter((e) => e.startsWith('examples/') && !e.includes('*'))
      .sort()

    expect(
      excluded,
      'tsconfig.json\'s per-file examples exclusions and "unreachable from ' +
        `${ENTRY}\" disagree. Left is what the config excludes, right is what it should: an ` +
        'example ADDED to the registry must be emitted (delete its line), and a helper added ' +
        'beside it must not (add its line). Nothing here is a matter of taste — the ' +
        '`./examples` subpath resolves to the entry, so its closure is exactly the published ' +
        'graph.',
    ).toEqual(shouldExclude)
  })
})
