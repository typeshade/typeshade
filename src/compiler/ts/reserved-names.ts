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
//    member `Ns_K`, a `super` call `Cls_super_Base_member`: the flattening happens during
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
//
// SEVERITY FOLLOWS THE TARGET'S ROLE. WGSL is the program, so a name it reserves is an error
// and the module does not compile. GLSL ES 3.00 is a second target of it, and this codebase
// already has one answer for "the GLSL leg cannot take this module": a warning that leaves
// `wgsl` in place and `glsl` undefined (`compile.ts`, for a compute entry beside the render
// pair or a storage binding the emulation cannot spell). A reserved name is that same class of
// shortfall, so it is reported the same way — which is also what keeps a render module that
// never produces GLSL for some OTHER reason from being refused for a word it would never have
// emitted. `sanitizeReservedIdents` fails the GLSL emit closed on the same names, so the
// warning is never the only thing standing between a reserved word and a driver.
//
// NOT COVERED, and deliberately: the multi-file path (`compileTsSources`, roadmap 0.5 item 14)
// records a declared-symbol table for its ENTRY file only, and without the module constants
// even there, because a span alone cannot say which file it indexes. Running this check over
// that half-table would refuse some kinds and miss others with no rule the reader could state,
// so `compileTsSources` is left alone until every file has a table of its own.

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

/** Why GLSL ES 3.00 refuses this spelling, or `undefined` if it does not. Beside the word list
 *  (§3.6) that section has two SHAPE rules, both measured on ANGLE rather than read: `gl_Scale`
 *  is "'gl_' : reserved built-in name", and `a__b` is "identifiers containing two consecutive
 *  underscores (__) are reserved as possible future keywords" — anywhere in the name, where
 *  WGSL's own rule is about the first two characters only. */
function glslRefusal(name: string): string | undefined {
  if (GLSL_ES300_RESERVED.has(name)) return `is reserved in GLSL ES 3.00`
  if (name.startsWith('gl_')) return `begins with "gl_", which GLSL ES 3.00 keeps for built-ins`
  if (name.includes('__'))
    return `has two consecutive underscores, which GLSL ES 3.00 reserves for future keywords`
  return undefined
}

/**
 * Report every declared name a target this module is emitted for reserves.
 *
 * `symbols` is the front end's declared-symbol table, whose `name` is the EMITTED name and
 * whose span is the name the author wrote; `funcs` decides whether GLSL ES 3.00 is a target of
 * this module at all, and `vars` tells a module variable apart from a resource binding, which
 * the symbol table records under one kind. One diagnostic per declaration, WGSL first, since
 * every module has it: a WGSL word is an error, a GLSL ES 3.00 one a warning, per the header.
 */
export function reportReservedNames(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols: readonly DeclaredSymbol[],
  funcs: readonly FuncDecl[],
  vars: readonly ModuleVarDecl[],
): void {
  // GLSL text is produced for every module the GLSL writer takes, which is every module
  // WITHOUT a compute entry — that stage is the one GLSL ES 3.00 does not have, and it is what
  // makes `emitGlslStages` throw. A module of helpers alone emits GLSL too, so it is held to
  // the list as well; only a compute kernel is exempt. Over-including costs a warning on a
  // module whose GLSL fails for some other reason, which is the same thing that module is
  // already told; under-including would let a reserved word through to a driver.
  const emitsGlsl = !funcs.some((f) => f.stage === 'compute')
  const varNames = new Set(vars.map((v) => v.name))
  // One declaration, one diagnostic: a generic struct is collected once per set of type
  // arguments the file writes it with, so its fields are recorded once per instantiation and
  // would otherwise draw one identical squiggle each.
  const reported = new Set<string>()
  for (const sym of symbols) {
    const emitted = sym.name
    const written = sourceFile.text.slice(sym.start, sym.start + sym.length)
    // A module variable is recorded as a `binding` (the editor spells both `let name: T`),
    // but the author knows the difference and the message should too.
    const noun =
      sym.kind === 'binding' && varNames.has(emitted) ? 'module variable' : NOUN[sym.kind]
    const wgsl = wgslRefusal(emitted)
    const glsl = emitsGlsl && GLSL_VERBATIM.has(sym.kind) ? glslRefusal(emitted) : undefined
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
    const key = `${String(sym.start)}:${String(sym.length)}:${message}`
    if (reported.has(key)) continue
    reported.add(key)
    diagnostics.push(
      makeSpanDiagnostic(
        sourceFile,
        sym.start,
        sym.length,
        message,
        TS_CODES.RESERVED_NAME,
        wgsl !== undefined ? 'error' : 'warning',
      ),
    )
  }
}
