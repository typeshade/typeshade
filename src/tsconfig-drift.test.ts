// ═══ X-GIS #1681 B1 — the package tsconfig is SELF-CONTAINED ═══
//
// Every `extends` in this package must resolve to a path INSIDE it. The package is
// vendored into a consumer's project as a git submodule or a source copy; a chain that
// reaches a parent directory's `tsconfig.base.json` makes the copied directory
// uncompilable, and the failure is at config-load time, before a single .ts file is read.
//
// THIS FILE USED TO CARRY A SECOND INVARIANT, and it is deliberately gone. Self-containment
// began as a COPY of the X-GIS monorepo root's baseline, so the copy was pinned to the
// original: for every option the root set, `tsconfig.base.json` had to set the same value,
// with a strictness boolean allowed to be stronger but never weaker. That arm compared this
// tree against `../tsconfig.base.json`. With the package split out of the monorepo there is
// no `..` to compare against — `tsconfig.base.json` is now the only authority for those
// options, not a copy of one — so the arm has no subject and was deleted rather than left
// skipping. The option lists it compared went with it.
//
// Scanner sanity: a reader that silently returned `{}` would make every comparison vacuous,
// so the gate independently proves the JSONC reader recovers known witnesses from a
// commented config.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_DIR = resolve(HERE, '..')

/** Every tsconfig this package owns. Listed explicitly (not globbed) so ADDING one
 *  without adding it here is visible in review — and the existence assertion below
 *  turns a MOVED file into a red gate rather than a vacuously-green skipped entry
 *  (§12: a path-keyed allowlist needs a companion "every key still resolves"). */
const PACKAGE_TSCONFIGS = [
  'tsconfig.json',
  'tsconfig.tests.json',
  'tsconfig.base.json',
  'examples/tsconfig.json',
]

/** Strip JSONC comments. String-aware: a `//` inside a string literal (e.g. a URL in
 *  `$schema`) must survive, and an escaped quote must not end the string. */
function stripJsonComments(text: string): string {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    const next = text[i + 1]
    if (inLine) {
      if (c === '\n') {
        inLine = false
        out += c
      }
      continue
    }
    if (inBlock) {
      if (c === '*' && next === '/') {
        inBlock = false
        i++
      }
      continue
    }
    if (inString) {
      out += c
      if (c === '\\') {
        // copy the escaped char verbatim so `\"` cannot close the string
        if (next !== undefined) {
          out += next
          i++
        }
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      out += c
      continue
    }
    if (c === '/' && next === '/') {
      inLine = true
      i++
      continue
    }
    if (c === '/' && next === '*') {
      inBlock = true
      i++
      continue
    }
    out += c
  }
  return out
}

type Tsconfig = {
  extends?: string
  compilerOptions?: Record<string, unknown>
  include?: string[]
  exclude?: string[]
}

function readTsconfig(path: string): Tsconfig {
  return JSON.parse(stripJsonComments(readFileSync(path, 'utf8'))) as Tsconfig
}

describe('X-GIS #1681 B1 — tsconfig self-containment', () => {
  it('every tsconfig this package owns exists at the listed path', () => {
    const missing = PACKAGE_TSCONFIGS.filter((p) => !existsSync(resolve(PKG_DIR, p)))
    expect(missing, `listed package tsconfig(s) not found: ${missing.join(', ')}`).toEqual([])
    expect(PACKAGE_TSCONFIGS.length).toBeGreaterThanOrEqual(4)
  })

  it('no tsconfig in the package extends outside the package', () => {
    const escapes: string[] = []
    for (const rel of PACKAGE_TSCONFIGS) {
      const file = resolve(PKG_DIR, rel)
      const ext = readTsconfig(file).extends
      if (ext === undefined) continue
      // A bare package specifier (`@tsconfig/…`) would be a dependency, not a path —
      // this package has none, so treat anything non-relative as an escape too.
      if (!ext.startsWith('.')) {
        escapes.push(`${rel} extends non-relative '${ext}'`)
        continue
      }
      const target = resolve(dirname(file), ext)
      const inside = relative(PKG_DIR, target)
      if (inside.startsWith('..') || isAbsolute(inside))
        escapes.push(`${rel} extends '${ext}' → ${target} (outside the package)`)
    }
    expect(
      escapes,
      `a vendored copy of shader-dsl/ cannot compile — extends chain(s) leave the package:\n  ${escapes.join('\n  ')}`,
    ).toEqual([])
  })

  it('the JSONC reader recovers known witnesses from a COMMENTED config', () => {
    // tsconfig.json carries both a leading `//` block and a trailing one; if the
    // stripper were broken this parse throws, and if it were over-eager these
    // witnesses would be gone. Without this arm a silently-empty reader would green
    // every assertion above.
    const cfg = readTsconfig(resolve(PKG_DIR, 'tsconfig.json'))
    expect(cfg.compilerOptions?.['composite']).toBe(true)
    expect(cfg.compilerOptions?.['outDir']).toBe('./dist')
    expect(cfg.include).toEqual(['src/**/*.ts'])
    expect(cfg.exclude).toEqual(['src/**/*.test.ts'])
    expect(cfg.extends).toBe('./tsconfig.base.json')
    // a `//` sequence inside a string must survive the stripper
    expect(JSON.parse(stripJsonComments('{"a":"http://x"} // trailing'))).toEqual({
      a: 'http://x',
    })
    expect(JSON.parse(stripJsonComments('{"a":"q\\"//not-a-comment"}'))).toEqual({
      a: 'q"//not-a-comment',
    })
  })
})
