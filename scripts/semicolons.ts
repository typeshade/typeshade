// ═══ Every statement in the shader source ends with `;` ═══
//
// `bun run format:semicolons` writes the `;` the shader source in this repository leaves to
// ASI; `bun run format:semicolons --check` lists them and exits 1 without writing. The
// insertion itself is `insertSemicolons` (src/compiler/ts/semicolons.ts), which reads the
// source with the compiler's own parser, so a `;` lands only where a statement already ended.
// `src/compiler/ts/semicolons.test.ts` runs the same check in `bun run test`, which is how CI
// holds it.
//
// WHAT IS SHADER SOURCE. Three places, each found by the directive rather than by a list:
//
//   file      examples/**/*.shade.ts, the whole file.
//   fence     a ```ts / ```typescript fence in README.md, AUTHORING.md, docs/*.md or
//             examples/*.md that carries the `"use typeshade"` directive (the compilation units
//             the doc-snippets suite compiles), and every fence in
//             docs/use-typeshade-surface.md, which is the grammar written out in fragments
//             (a fragment that elides with `…` does not parse and is left as it is).
//   template  a backtick string in src/**/*.ts or examples/**/*.ts whose first code line is the
//             directive: the inline sources the tests compile. One with a `${…}` substitution or
//             an escape sequence is left alone (its text is not the source the parser sees), and
//             so is one that does not parse, because a test may be feeding the compiler a
//             broken source on purpose. A test whose inline sources leave their `;` to ASI on
//             purpose says so, with the reason, on a line of its own anywhere in the file:
//
//               // format:semicolons skip — why these sources are written without `;`
//
// Host-side TypeScript is not touched: it keeps Prettier's `semi: false` (.prettierrc.json).
// An example file or a directive fence that does not parse is an error, not a skip: shader
// source a reader copies out of the docs should parse.

import ts from 'typescript'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { insertSemicolons } from '../src/compiler/ts/semicolons.js'

const DIRECTIVE = /^(["'])use typeshade\1;?$/
const FENCE_OPEN = /^```(ts|typescript)\s*$/
/** The opt-out for a test file's inline sources; the reason after the dash is required. */
const SKIP_MARKER = /^\/\/ format:semicolons skip — \S/m
/** The one doc whose every fence is shader source, directive or not. */
const ALL_FENCES_DOC = 'docs/use-typeshade-surface.md'

/** One file's worth of findings: the rewritten text, the 1-based lines that gained a `;`. */
export interface FileReport {
  readonly file: string
  readonly original: string
  readonly text: string
  readonly lines: readonly number[]
  readonly errors: readonly string[]
}

function walk(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path, keep))
    else if (keep(path)) out.push(path)
  }
  return out
}

function firstCodeLine(code: string): string {
  for (const line of code.split('\n')) {
    const t = line.trim()
    if (t !== '' && !t.startsWith('//')) return t
  }
  return ''
}

/** 1-based line of each offset. */
function linesOf(text: string, offsets: readonly number[]): number[] {
  const out: number[] = []
  let line = 1
  let i = 0
  for (const at of offsets) {
    for (; i < at; i++) if (text.charCodeAt(i) === 10) line++
    if (out[out.length - 1] !== line) out.push(line)
  }
  return out
}

/** Rewrite each region [start, end) of `text` with `insertSemicolons`. */
function rewriteRegions(
  file: string,
  text: string,
  regions: readonly { start: number; end: number; strict: boolean }[],
): FileReport {
  let out = ''
  let from = 0
  const offsets: number[] = []
  const errors: string[] = []
  for (const { start, end, strict } of regions) {
    const code = text.slice(start, end)
    const r = insertSemicolons(code, file)
    if (!r.ok) {
      if (strict) errors.push(`${file}:${linesOf(text, [start + r.at])[0]}: ${r.message}`)
      continue
    }
    out += text.slice(from, start) + r.text
    from = end
    r.inserted.forEach((at) => offsets.push(start + at))
  }
  out += text.slice(from)
  return { file, original: text, text: out, lines: linesOf(text, offsets), errors }
}

function fenceRegions(
  file: string,
  text: string,
): { start: number; end: number; strict: boolean }[] {
  const all = file === ALL_FENCES_DOC
  const regions: { start: number; end: number; strict: boolean }[] = []
  const lines = text.split('\n')
  let offset = 0
  const starts = lines.map((l) => {
    const s = offset
    offset += l.length + 1
    return s
  })
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE_OPEN.test(lines[i]!.trim())) continue
    let end = i + 1
    while (end < lines.length && lines[end]!.trim() !== '```') end++
    const code = lines.slice(i + 1, end).join('\n')
    const unit = code.split('\n').some((l) => DIRECTIVE.test(l.trim()))
    // A compilation unit has to parse. A fragment of the surface doc may elide with `…` or
    // `{ ... }`, which no parser reads, and is formatted only when it parses.
    if (unit || all) {
      regions.push({ start: starts[i + 1]!, end: starts[i + 1]! + code.length, strict: unit })
    }
    i = end
  }
  return regions
}

function templateRegions(
  file: string,
  text: string,
): { start: number; end: number; strict: boolean }[] {
  if (!text.includes('use typeshade') || SKIP_MARKER.test(text)) return []
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const regions: { start: number; end: number; strict: boolean }[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isNoSubstitutionTemplateLiteral(node)) {
      const start = node.getStart(sf) + 1
      const end = node.getEnd() - 1
      const raw = text.slice(start, end)
      if (raw === node.text && DIRECTIVE.test(firstCodeLine(raw))) {
        regions.push({ start, end, strict: false })
      }
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return regions
}

/** Every shader source under `root`, each with the `;` it is missing written in. */
export function scanShaderSources(root: string): FileReport[] {
  const rel = (p: string) => relative(root, p).split('\\').join('/')
  const reports: FileReport[] = []
  for (const path of walk(join(root, 'examples'), (p) => p.endsWith('.shade.ts'))) {
    const text = readFileSync(path, 'utf8')
    reports.push(rewriteRegions(rel(path), text, [{ start: 0, end: text.length, strict: true }]))
  }
  const docs = [
    'README.md',
    'AUTHORING.md',
    ...readdirSync(join(root, 'docs'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => `docs/${f}`),
    ...readdirSync(join(root, 'examples'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => `examples/${f}`),
  ].sort()
  for (const file of docs) {
    const text = readFileSync(join(root, file), 'utf8')
    reports.push(rewriteRegions(file, text, fenceRegions(file, text)))
  }
  const hosts = [
    ...walk(join(root, 'src'), (p) => p.endsWith('.ts')),
    ...walk(join(root, 'examples'), (p) => p.endsWith('.ts') && !p.endsWith('.shade.ts')),
  ]
  for (const path of hosts) {
    const text = readFileSync(path, 'utf8')
    reports.push(rewriteRegions(rel(path), text, templateRegions(rel(path), text)))
  }
  return reports.filter((r) => r.lines.length > 0 || r.errors.length > 0)
}

function main(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const check = process.argv.includes('--check')
  const reports = scanShaderSources(root)
  let missing = 0
  for (const r of reports) {
    for (const e of r.errors) console.error(e)
    if (r.lines.length === 0) continue
    missing += r.lines.length
    if (check) console.log(`${r.file}: line ${r.lines.join(', ')}`)
    else writeFileSync(join(root, r.file), r.text)
  }
  const errors = reports.reduce((n, r) => n + r.errors.length, 0)
  const files = reports.filter((r) => r.lines.length > 0).length
  if (check) {
    if (missing > 0)
      console.log(
        `\n${missing} line(s) in ${files} file(s) end a statement without ';'. Run: bun run format:semicolons`,
      )
  } else {
    console.log(`wrote ';' on ${missing} line(s) in ${files} file(s)`)
  }
  if (errors > 0 || (check && missing > 0)) process.exit(1)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main()
