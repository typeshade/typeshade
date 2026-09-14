// ═══ Twin comparison — what the two authoring surfaces do with one shader ═══
//
// A `.shade.ts` file carrying `twinOf` claims to be the SAME shader as an `fn()` EDSL
// example, written in the source language instead of built with `fn()` / `module()`. That
// claim is what makes the EDSL corpus an oracle for the compiler: if the two surfaces ever
// stop agreeing, something moved that should not have. A claim nobody checks is worth
// nothing, so this file is the check.
//
// It answers two questions, because they fail differently:
//
//   1. WHAT DOES THE EMIT LOOK LIKE SIDE BY SIDE? — a unified diff of the two WGSL texts.
//      Textual, and it moves whenever either surface changes how it spells this shader.
//   2. ARE THE TWO PROGRAMS THE SAME PROGRAM? — a diff of the two LOWERED modules
//      (`lowerForBackend`, so autoVars/lowerModule/optimize have all run and both sides sit
//      where the backend spells them), rendered as canonical one-line statement shapes with
//      function-local names replaced by their declaration index.
//
// WHY (2) IS A LINE DIFF AND NOT A DEEP OBJECT COMPARE. The first cut walked both IRs and
// reported mismatching paths. It was useless: the bodies differ in LENGTH, so `body[2]` was
// compared against an unrelated `body[2]`, and one inserted statement turned into twenty
// "differences" that were really one. Aligning canonical LINES with the same LCS the text
// diff uses reports the one insertion as one insertion. The rendering also drops what is
// encoding rather than meaning (a `FuncDecl` back-pointer, whether the stage rides in
// `attrs` or in `stage`), so what is left is the program.
//
// Node-only (imported by a test, and it reaches into the emit pipeline), hence the leading
// underscore this directory uses for a helper that is not an example.

import { lowerForBackend } from '../src/core/emit.js'
import { wgslBackend } from '../src/core/backends/wgsl.js'
import { typeKey } from '../src/index.js'
import type { ModuleDecl } from '../src/index.js'

// ── unified diff ──

/** Longest common subsequence over two line arrays, as the classic O(n·m) table. The inputs
 *  are single shaders (tens of lines), so the quadratic table is the right trade for not
 *  taking a dependency — and a diff that is itself a dependency is a diff nobody can read
 *  when it breaks. */
function lcs(a: readonly string[], b: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  return table
}

/** Walk the LCS table, emitting ` ctx` / `-only-in-a` / `+only-in-b` lines. */
function diffLines(a: readonly string[], b: readonly string[]): string[] {
  const table = lcs(a, b)
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(` ${a[i]!}`)
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      out.push(`-${a[i]!}`)
      i++
    } else {
      out.push(`+${b[j]!}`)
      j++
    }
  }
  for (; i < a.length; i++) out.push(`-${a[i]!}`)
  for (; j < b.length; j++) out.push(`+${b[j]!}`)
  return out
}

/**
 * A unified diff of two texts, with full context.
 *
 * Full context rather than the usual three lines: these are whole shaders of a few dozen
 * lines, and a golden that hides the unchanged body makes a reviewer open two other files to
 * see what the diff is a diff OF.
 *
 * @param original - the left text.
 * @param twin - the right text.
 * @param originalLabel - the `---` header label.
 * @param twinLabel - the `+++` header label.
 * @returns the diff, always ending in a newline.
 */
export function unifiedDiff(
  original: string,
  twin: string,
  originalLabel: string,
  twinLabel: string,
): string {
  const a = original.replace(/\n$/, '').split('\n')
  const b = twin.replace(/\n$/, '').split('\n')
  return `${['--- ' + originalLabel, '+++ ' + twinLabel, ...diffLines(a, b)].join('\n')}\n`
}

// ── canonical rendering of a lowered function body ──

type Node = Record<string, unknown>

/** Render one expression as a compact, side-effect-free line fragment.
 *
 *  Leaf reads keep their `op` in the rendering (`varref(x)` vs `constref(x)`) because the two
 *  surfaces genuinely disagree about that encoding today (#14) and a rendering that hid it
 *  would hide a live bug. Function-local names arrive already canonicalised. */
function renderExpr(e: unknown, names: ReadonlyMap<string, string>): string {
  if (e === null || e === undefined || typeof e !== 'object') return String(e)
  const n = e as Node
  const sub = (k: string): string => renderExpr(n[k], names)
  const list = (k: string): string =>
    ((n[k] ?? []) as unknown[]).map((x) => renderExpr(x, names)).join(', ')
  switch (n['op']) {
    case 'lit':
      return String(n['value'])
    case 'varref':
      return `varref(${names.get(n['name'] as string) ?? (n['name'] as string)})`
    case 'param':
      return `param(${n['name'] as string})`
    case 'constref':
    case 'externref':
    case 'overrideref':
      return `${n['op'] as string}(${n['name'] as string})`
    case 'binop':
      return `(${sub('a')} ${n['bop'] as string} ${sub('b')})`
    case 'compare':
      return `(${sub('a')} ${n['cop'] as string} ${sub('b')})`
    case 'logical':
      return `(${sub('a')} ${n['lop'] as string} ${sub('b')})`
    case 'unop':
      return `-(${sub('a')})`
    case 'call':
      return `${n['fn'] as string}(${list('args')})`
    case 'member':
      return `${sub('base')}.${n['field'] as string}`
    case 'index':
      return `${sub('base')}[${sub('idx')}]`
    case 'construct':
      return `${typeKey(n['type'] as never)}(${list('args')})`
    case 'select':
      return `select(${sub('cond')}, ${sub('ifTrue')}, ${sub('ifFalse')})`
    default:
      return `${String(n['op'])}(…)`
  }
}

/** Render a statement list as indented canonical lines, binding local names as it goes.
 *  `names` is mutated in declaration order, so two bodies with the same shape get the same
 *  canonical names however the author (or a pass) spelled them. */
function renderStmts(
  body: readonly unknown[],
  names: Map<string, string>,
  depth: number,
): string[] {
  const pad = '  '.repeat(depth + 1)
  const out: string[] = []
  const declare = (raw: string): string => {
    const c = `_c${String(names.size)}`
    names.set(raw, c)
    return c
  }
  for (const s of body) {
    const n = s as Node
    const e = (k: string): string => renderExpr(n[k], names)
    switch (n['s']) {
      case 'let': {
        // Render the initialiser BEFORE binding the name: `let x = x + 1` reads the outer x.
        const init = e('expr')
        out.push(`${pad}let ${declare(n['name'] as string)} = ${init}`)
        break
      }
      case 'var': {
        const init = n['init'] === undefined ? undefined : e('init')
        const name = declare(n['name'] as string)
        const ty = typeKey(n['type'] as never)
        out.push(`${pad}var ${name}: ${ty}${init === undefined ? '' : ` = ${init}`}`)
        break
      }
      case 'assign':
        out.push(`${pad}${e('target')} = ${e('expr')}`)
        break
      case 'assignOp':
        out.push(`${pad}${e('target')} ${n['bop'] as string}= ${e('expr')}`)
        break
      case 'return':
        out.push(`${pad}return${n['expr'] === undefined ? '' : ` ${e('expr')}`}`)
        break
      case 'if': {
        for (const [i, arm] of (n['arms'] as readonly Node[]).entries()) {
          out.push(`${pad}${i === 0 ? 'if' : 'else if'} (${renderExpr(arm['cond'], names)}) {`)
          out.push(...renderStmts(arm['body'] as readonly unknown[], names, depth + 1))
        }
        if (n['elseBody'] !== undefined) {
          out.push(`${pad}} else {`)
          out.push(...renderStmts(n['elseBody'] as readonly unknown[], names, depth + 1))
        }
        out.push(`${pad}}`)
        break
      }
      case 'for': {
        // The init declares the loop variable, and cond/update/body all read it, so it is
        // rendered (and bound) first.
        const init = renderStmts([n['init']], names, 0)[0]?.trim() ?? ''
        out.push(
          `${pad}for (${init}; ${e('cond')}; ${renderStmts([n['update']], names, 0)[0]?.trim() ?? ''}) {`,
        )
        out.push(...renderStmts(n['body'] as readonly unknown[], names, depth + 1))
        out.push(`${pad}}`)
        break
      }
      case 'switch': {
        out.push(`${pad}switch (${e('scrut')}) {`)
        for (const c of n['cases'] as readonly Node[]) {
          out.push(`${pad}  case ${String(c['value'])}:`)
          out.push(...renderStmts(c['body'] as readonly unknown[], names, depth + 2))
        }
        if (n['defaultBody'] !== undefined) {
          out.push(`${pad}  default:`)
          out.push(...renderStmts(n['defaultBody'] as readonly unknown[], names, depth + 2))
        }
        out.push(`${pad}}`)
        break
      }
      default:
        out.push(`${pad}${String(n['s'])}`)
    }
  }
  return out
}

/** The module's interface, as canonical lines: what a host binds against. Ordered as
 *  declared, because binding order is part of the contract, not a detail. */
function renderInterface(m: ModuleDecl): string[] {
  const out: string[] = []
  for (const s of m.structs ?? []) {
    out.push(
      `struct ${s.name} { ${s.fields.map((f) => `${f.name}: ${typeKey(f.type)}`).join(', ')} }`,
    )
  }
  for (const b of m.bindings ?? []) {
    out.push(
      `binding @group(${String(b.group)}) @binding(${String(b.binding)}) ${b.space} ${b.name}: ${typeKey(b.type)}`,
    )
  }
  for (const f of m.funcs ?? []) {
    const params = f.params.map((p) => `${p.name}: ${typeKey(p.type)}`).join(', ')
    out.push(`fn ${f.name}(${params}) -> ${typeKey(f.ret)}`)
  }
  return out
}

/** One function body, rendered as canonical lines. */
function renderBodies(m: ModuleDecl): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const f of m.funcs ?? []) out.set(f.name, renderStmts(f.body, new Map<string, string>(), 0))
  return out
}

/** The per-function half of a {@link TwinReport}. */
export interface TwinFunctionDiff {
  readonly name: string
  readonly same: boolean
  /** Unified-diff lines over the canonical statement rendering. Empty when `same`. */
  readonly diff: readonly string[]
}

/** The pinned comparison of one twin against the EDSL example it claims to be. */
export interface TwinReport {
  /** The `.shade.ts` id. */
  readonly twin: string
  /** The `examples` id it is a twin of. */
  readonly of: string
  /** Do the two WGSL emits match byte for byte? */
  readonly emitIdentical: boolean
  /** Do the two lowered modules render to the same canonical lines — interface and every
   *  body? When true, the surfaces built the same program and any emit difference is
   *  spelling. */
  readonly loweredIdentical: boolean
  /** Interface differences: structs, bindings, function signatures. Should always be empty;
   *  a twin whose interface moved is a different shader, not the same one written twice. */
  readonly interfaceDiff: readonly string[]
  /** One entry per function present in either module. */
  readonly functions: readonly TwinFunctionDiff[]
}

/**
 * Compare a twin against the EDSL example it mirrors.
 *
 * Both modules go through `lowerForBackend` for the WGSL backend first, so the comparison is
 * between what the backend actually spells — after auto-var materialisation, match lowering
 * and the optimizer — rather than between two authored shapes that encode the same thing
 * differently.
 *
 * @param twinId - the `.shade.ts` id.
 * @param ofId - the `examples` id it mirrors.
 * @param original - the EDSL example's module.
 * @param twin - the compiled twin's module.
 * @param originalWgsl - the EDSL example's emitted WGSL.
 * @param twinWgsl - the twin's emitted WGSL.
 * @returns the report, shaped to be committed as JSON.
 */
export function twinReport(
  twinId: string,
  ofId: string,
  original: ModuleDecl,
  twin: ModuleDecl,
  originalWgsl: string,
  twinWgsl: string,
): TwinReport {
  const a = lowerForBackend(original, wgslBackend)
  const b = lowerForBackend(twin, wgslBackend)

  const interfaceDiff = diffLines(renderInterface(a), renderInterface(b)).filter(
    (l) => !l.startsWith(' '),
  )

  const aBodies = renderBodies(a)
  const bBodies = renderBodies(b)
  const functions: TwinFunctionDiff[] = []
  for (const name of new Set([...aBodies.keys(), ...bBodies.keys()])) {
    const lines = diffLines(aBodies.get(name) ?? [], bBodies.get(name) ?? [])
    const same = lines.every((l) => l.startsWith(' '))
    functions.push({ name, same, diff: same ? [] : lines })
  }

  return {
    twin: twinId,
    of: ofId,
    emitIdentical: originalWgsl === twinWgsl,
    loweredIdentical: interfaceDiff.length === 0 && functions.every((f) => f.same),
    interfaceDiff,
    functions,
  }
}
