// === A name a target reserves, refused where it is written (#103) ===
//
// A struct field named `half` compiled to WGSL Tint accepts and to GLSL ANGLE answers with
//
//   glsl: fragment: ERROR: 0:16: 'half' : Illegal use of reserved word
//
// — a line number in generated text, for a word the author wrote on a line of their own. The
// same held for a module constant, an override, a module variable, a struct name and, on the
// WGSL side, for every one of the 146 tokens that spec reserves for future use.
//
// THREE THINGS DECIDE WHERE THIS CHECK LIVES.
//
// 1. The EMITTED name is what collides. A class's static field is `Cls_K`, a namespace's
//    member `Ns_K`, an inherited field `Cls_super_Base_member`: the flattening happens during
//    collection, so a check in the struct collector would test a spelling that never reaches a
//    backend. The declared-symbol table (`symbols.ts`) carries both halves — the emitted name
//    and the span of the name the author wrote — which is exactly what a diagnostic needs.
// 2. The TARGET SET has to be known. A module with no `@vertex` or `@fragment` entry has no
//    GLSL form at all (`compile()` does not even attempt one), so refusing it for a GLSL word
//    it never emits would be a refusal of a program that works. WGSL is every module's target
//    and is always checked.
// 3. The NAMES THE GLSL WRITER RENAMES ITSELF are not this check's business. `glsl-sanitize`
//    rewrites a param, a local and a function name that collides, consistently with every
//    reference, so `let out = …` has always been legal here and stays legal. What it cannot
//    rename is the module surface: a struct and its fields (the std140 offsets and the
//    cross-stage varying contract), a constant, an override's `#define`, a module variable and
//    a binding (whose name is the host's reflection key). Those are the ones refused here.

import type ts from 'typescript'
import type { FuncDecl, ModuleVarDecl } from '../../core/ir/nodes.js'
import { GLSL_ES300_RESERVED, WGSL_RESERVED } from '../../core/reserved-words.js'
import { TS_CODES } from './codes.js'
import { makeSpanDiagnostic } from './diagnostic.js'
import type { TsCompilerDiagnostic } from './source-file.js'
import type { DeclaredSymbol, DeclaredSymbolKind } from './symbols.js'

/** `a local`, `an override`: the article the noun takes, so the message reads as a sentence. */
const withArticle = (noun: string): string => `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`

/** What the author calls the thing they declared, for the message. */
const NOUN: Record<DeclaredSymbolKind, string> = {
  local: 'local',
  param: 'parameter',
  const: 'module constant',
  binding: 'binding',
  function: 'function',
  struct: 'struct',
  field: 'field',
  override: 'override',
}

/** The kinds the GLSL ES 3.00 writer spells verbatim. A `local`, a `param` and a `function`
 *  are absent because `sanitizeReservedIdents` renames those for that target on its own. */
const GLSL_VERBATIM: ReadonlySet<DeclaredSymbolKind> = new Set<DeclaredSymbolKind>([
  'struct',
  'field',
  'const',
  'binding',
  'override',
])

/** The API each language is emitted for, as the message names it: the reader needs to know
 *  which of their two targets the name stops, not only which language spells it. */
const WEBGPU = 'WebGPU'
const WEBGL2 = 'WebGL2'

/** Why WGSL refuses this spelling, or `undefined` if it does not. The spec has three rules:
 *  a keyword or reserved word, the single `_`, and any name beginning with `__`. */
function wgslRefusal(name: string): string | undefined {
  if (WGSL_RESERVED.has(name)) return `is reserved in WGSL`
  if (name.startsWith('__')) return `begins with two underscores, which WGSL reserves`
  if (name === '_') return `is WGSL's phony assignment target, not an identifier`
  return undefined
}

/**
 * Report every declared name a target this module is emitted for reserves.
 *
 * `symbols` is the front end's declared-symbol table, whose `name` is the EMITTED name and
 * whose span is the name the author wrote; `funcs` decides whether GLSL ES 3.00 is a target of
 * this module at all, and `vars` tells a module variable apart from a resource binding, which
 * the symbol table records under one kind. One diagnostic per declaration, WGSL first, since
 * every module has it.
 */
export function reportReservedNames(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols: readonly DeclaredSymbol[],
  funcs: readonly FuncDecl[],
  vars: readonly ModuleVarDecl[],
): void {
  const emitsGlsl = funcs.some((f) => f.stage === 'vertex' || f.stage === 'fragment')
  const varNames = new Set(vars.map((v) => v.name))
  for (const sym of symbols) {
    const emitted = sym.name
    const written = sourceFile.text.slice(sym.start, sym.start + sym.length)
    // A module variable is recorded as a `binding` (the editor spells both `let name: T`),
    // but the author knows the difference and the message should too.
    const noun =
      sym.kind === 'binding' && varNames.has(emitted) ? 'module variable' : NOUN[sym.kind]
    const wgsl = wgslRefusal(emitted)
    const glsl =
      emitsGlsl && GLSL_VERBATIM.has(sym.kind) && GLSL_ES300_RESERVED.has(emitted)
        ? `is reserved in GLSL ES 3.00`
        : undefined
    const [why, api] =
      wgsl !== undefined ? [wgsl, WEBGPU] : glsl !== undefined ? [glsl, WEBGL2] : [undefined, '']
    if (why === undefined) continue
    // The flattened name is what collides, and it is not always what the author typed: a
    // static field `K` of a class `S` is emitted `S_K`. Say both when they differ, or the
    // reader is sent to a line that does not contain the word the message quotes.
    const message =
      emitted === written
        ? `"${emitted}" ${why}, so ${withArticle(noun)} of that name cannot be emitted for the ${api} target. Rename it.`
        : `"${written}" is emitted as "${emitted}", which ${why}, so this ${noun} cannot be emitted for the ${api} target. Rename it.`
    diagnostics.push(
      makeSpanDiagnostic(sourceFile, sym.start, sym.length, message, TS_CODES.RESERVED_NAME),
    )
  }
}
