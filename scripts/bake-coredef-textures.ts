// ═══ The `core.def` texture fixture — Tint's own overload table, checked in ═══
//
// WHAT IT IS. `src/core/spec-conformance/fixtures/coredef-textures.json` is every
// `fn texture*` overload of Tint's intrinsic table (`core.def`), parsed into rows.
// `src/core/spec-conformance/coredef-texture-overloads.test.ts` reads it and forces every row
// to be claimed: SUPPORTED with a `compile()` witness, or DEFERRED with a reason and an issue.
//
// WHY A FIXTURE AND NOT A FETCH. The suite must be offline and deterministic: a test that
// downloads the table would go red when a network is missing and would silently change what it
// asserts when Dawn lands a commit. The fixture is a dated snapshot; this script is how it is
// refreshed, so "regenerate it" is a command rather than a paragraph.
//
// WHY TINT'S TABLE AND NOT THE SPEC PROSE. `core.def` is what Chromium's WGSL front end
// actually matches a call against, so a row missing here is a program Tint refuses. It also
// carries `@stage(...)`, which the spec states in prose ("Must only be used in a fragment
// shader stage.") and which this package must reproduce in two hand-written sets.
//
// TO REGENERATE (from the package root):
//
//   curl -sSL https://raw.githubusercontent.com/google/dawn/main/src/tint/lang/core/core.def \
//     -o /tmp/core.def
//   bun scripts/bake-coredef-textures.ts /tmp/core.def
//
// Then run `bun run test src/core/spec-conformance/coredef-texture-overloads.test.ts` and claim
// every row the suite names as new. A row that arrives unclaimed FAILS the suite: that is the
// whole point of the fixture.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '..', 'src', 'core', 'spec-conformance', 'fixtures')
const OUT = join(FIXTURES, 'coredef-textures.json')
const OUT_STAGES = join(FIXTURES, 'coredef-stages.json')
const URL = 'https://raw.githubusercontent.com/google/dawn/main/src/tint/lang/core/core.def'

/** One `fn texture*` overload. `signature` is the row key the suite claims against. */
interface Row {
  readonly fn: string
  /** The `@stage(...)` list, empty when the overload is legal in every stage. */
  readonly stages: readonly string[]
  /** `implicit(A: iu32)` — the type parameters and the constraint each ranges over. */
  readonly implicit: Readonly<Record<string, string>>
  readonly params: readonly { readonly name: string; readonly type: string }[]
  /** `''` for an overload that returns nothing (`textureStore`). */
  readonly ret: string
  readonly signature: string
}

/** Split a parameter list on the commas that separate PARAMETERS, not the ones inside a
 *  generic argument list — `texel_buffer<F, R>` is one type, not two parameters. */
function splitParams(inner: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === '<' || c === '(' || c === '[') depth++
    else if (c === '>' || c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      out.push(inner.slice(start, i))
      start = i + 1
    }
  }
  out.push(inner.slice(start))
  return out.map((s) => s.trim()).filter((s) => s !== '')
}

/** Parameter text (`@const offset: vec2<i32>`) to `{ name, type }`, keeping `@const` on the
 *  name so a const-expression-only argument stays visible to whoever claims the row. */
function param(text: string): { name: string; type: string } {
  const t = text.trim()
  const colon = t.indexOf(':')
  if (colon < 0) return { name: t, type: t }
  return { name: t.slice(0, colon).trim(), type: t.slice(colon + 1).trim() }
}

function parse(def: string): Row[] {
  const lines = def.split('\n')
  const rows: Row[] = []
  let attrs: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim()
    if (line === '' || line.startsWith('//')) {
      attrs = []
      continue
    }
    const decl = /\bfn\s+(texture\w*)\s*\(/.exec(line)
    if (decl === null) {
      // An attribute line BELONGING to the next declaration, unless the line declares
      // something itself (`@stage("compute") fn storageBarrier()`), which ends the run.
      if (/\bfn\s+\w+\s*\(/.test(line)) attrs = []
      else if (line.startsWith('@') || line.startsWith('implicit')) attrs.push(line)
      else attrs = []
      continue
    }
    // The signature may wrap over several lines; read until the parentheses balance.
    let text = line
    const depth = (s: string): number => s.split('(').length - s.split(')').length
    while (depth(text) > 0 && i + 1 < lines.length) text += ' ' + (lines[++i] ?? '').trim()
    const head = attrs.join(' ') + ' ' + line.slice(0, decl.index)
    attrs = []

    // From the DECLARATION's own parenthesis: a line may open with `@stage("compute") fn …`,
    // whose first `(` belongs to the attribute.
    const open = text.indexOf('(', decl.index)
    const close = text.lastIndexOf(')')
    const params = splitParams(text.slice(open + 1, close)).map(param)
    const arrow = text.slice(close + 1).trim()
    const ret = arrow.startsWith('->') ? arrow.slice(2).trim() : ''

    const stageAttr = /@stage\(([^)]*)\)/.exec(head)
    const stages =
      stageAttr === null
        ? []
        : (stageAttr[1] ?? '').split(',').map((s) => s.trim().replace(/"/g, ''))
    const implicit: Record<string, string> = {}
    const implicitAttr = /implicit\(([^)]*)\)/.exec(head)
    for (const part of (implicitAttr?.[1] ?? '').split(',')) {
      const [name, constraint] = part.split(':')
      if (name !== undefined && constraint !== undefined) implicit[name.trim()] = constraint.trim()
    }

    const fn = decl[1] ?? ''
    const signature = `${fn}(${params.map((p) => p.type).join(', ')})${ret === '' ? '' : ` -> ${ret}`}`
    rows.push({ fn, stages, implicit, params, ret, signature })
  }
  return rows
}

/** Every declaration carrying a `@stage(...)` attribute, texture or not: `{ fn, stages }`
 *  once per OVERLOAD, so a name whose overloads disagree is visible downstream. */
function parseStaged(def: string): { fn: string; stages: string[] }[] {
  const lines = def.split('\n')
  const out: { fn: string; stages: string[] }[] = []
  let attrs: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '' || line.startsWith('//')) {
      attrs = []
      continue
    }
    const decl = /\bfn\s+([A-Za-z_]\w*)\s*\(/.exec(line)
    if (decl === null) {
      if (line.startsWith('@') || line.startsWith('implicit')) attrs.push(line)
      else attrs = []
      continue
    }
    const head = attrs.join(' ') + ' ' + line.slice(0, decl.index)
    attrs = []
    const stageAttr = /@stage\(([^)]*)\)/.exec(head)
    if (stageAttr === null) {
      out.push({ fn: decl[1] ?? '', stages: [] })
      continue
    }
    out.push({
      fn: decl[1] ?? '',
      stages: (stageAttr[1] ?? '').split(',').map((s) => s.trim().replace(/"/g, '')),
    })
  }
  return out
}

const path = process.argv[2]
if (path === undefined) {
  console.error(
    `usage: bun scripts/bake-coredef-textures.ts <core.def>\n  curl -sSL ${URL} -o /tmp/core.def`,
  )
  process.exit(1)
}
const def = readFileSync(path, 'utf8')
const rows = parse(def).sort((a, b) => a.signature.localeCompare(b.signature))
const duplicates = rows.filter((r, i) => i > 0 && rows[i - 1]?.signature === r.signature)
if (duplicates.length > 0) {
  // A key that repeats cannot be claimed once, so the parser — not the table — is wrong.
  console.error(`duplicate signatures:\n${duplicates.map((d) => `  ${d.signature}`).join('\n')}`)
  process.exit(1)
}
const sha256 = createHash('sha256').update(def).digest('hex')
// `baked` is the date the CONTENT changed, not the date the script last ran: re-baking an
// unchanged `core.def` must produce no diff at all, or "regenerate it and see" stops being a
// cheap thing to ask of a reviewer. The sha256 above is the real identity.
const previous = existsSync(OUT)
  ? (JSON.parse(readFileSync(OUT, 'utf8')) as { sha256?: string; baked?: string })
  : {}
const baked =
  previous.sha256 === sha256 && previous.baked !== undefined
    ? previous.baked
    : new Date().toISOString().slice(0, 10)
const fixture = { source: URL, sha256, baked, generator: 'scripts/bake-coredef-textures.ts', rows }
// One row per line: a JSON blob with no newlines is unreviewable, and `JSON.stringify`'s
// indented form costs 45 KB of leading spaces for a file that ships in the tarball.
const body = rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')
const head = Object.entries(fixture)
  .filter(([k]) => k !== 'rows')
  .map(([k, v]) => ` "${k}": ${JSON.stringify(v)},`)
  .join('\n')
writeFileSync(OUT, `{\n${head}\n "rows": [\n${body}\n ]\n}\n`)
console.log(`${String(rows.length)} texture overloads → ${OUT}`)

// ─── The second fixture: every `@stage(...)` builtin, texture or not ───
//
// `stage-rules.test.ts` needs the derivatives, the barriers and the atomics as well as the
// texture rows, and it needs to know when a NAME's overloads disagree — `textureLoad` is
// staged `fragment, compute` for a writable storage texture and unstaged for a sampled one,
// which is exactly the rule a per-id set cannot express.
const all = parseStaged(def)
const staged = new Map<string, Set<string>>()
for (const row of all) {
  const seen = staged.get(row.fn) ?? new Set<string>()
  // `any` for an overload with no `@stage`: a name whose overloads DISAGREE
  // (`textureLoad` is staged for a writable storage texture and unstaged for a sampled one)
  // must be visible as such, or a per-name rule would over-refuse.
  seen.add(row.stages.length === 0 ? 'any' : row.stages.join(','))
  staged.set(row.fn, seen)
}
const stageRows = [...staged.entries()]
  .filter(([, sets]) => !(sets.size === 1 && sets.has('any')))
  .map(([fn, sets]) => ({ fn, stageSets: [...sets].sort() }))
  .sort((a, b) => a.fn.localeCompare(b.fn))
const stageBody = stageRows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')
writeFileSync(OUT_STAGES, `{\n${head}\n "rows": [\n${stageBody}\n ]\n}\n`)
console.log(`${String(stageRows.length)} staged builtins → ${OUT_STAGES}`)
