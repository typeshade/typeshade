// A backend identifier restriction reported at the authored declaration (TS8068).
// Variables (locals, parameters, constants and module variables) receive safe spellings
// on a backend copy instead. Structs, fields, bindings, overrides and WGSL function names
// retain their interface naming contract: WGSL failures are errors and GLSL failures
// warnings, with the GLSL writer refusing that output. A helper function named like something
// its target predeclares is renamed by the writer (Rule 9.5); an entry point keeps its name, so
// one that would hide a name the module's WGSL uses is refused here (`reportHiddenPredeclared`).
// Names are checked after class and namespace flattening, then mapped back to the original
// file by the linker.
// Implements: Rule 3.2, Rule 3.3, Rule 3.4 (docs/language-design.md; traced in reqs/).

import type ts from 'typescript';
import type { FuncDecl, ModuleDecl, ModuleVarDecl } from '../../core/ir/nodes.js';
import { emitModule } from '../../core/backends/wgsl.js';
import { lexShader } from '../../core/shader-lex.js';
import { GLSL_ES300_RESERVED, WGSL_PREDECLARED, WGSL_RESERVED } from '../../core/reserved-words.js';
import { TS_CODES } from './codes.js';
import { makeSpanDiagnostic } from './diagnostic.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import type { DeclaredSymbol, DeclaredSymbolKind } from './symbols.js';

/** `a local`, `an override`: the article the noun takes, so the message reads as a sentence. */
const withArticle = (noun: string): string => `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;

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
};

/** The kinds the GLSL ES 3.00 writer spells verbatim. A `local`, a `param` and a `function`
 *  are absent because `sanitizeReservedIdents` renames those for that target on its own. */
const GLSL_VERBATIM: ReadonlySet<DeclaredSymbolKind> = new Set<DeclaredSymbolKind>([
  'struct',
  'field',
  'const',
  'binding',
  'override',
]);

/** The API each language is emitted for, as the message names it: the reader needs to know
 *  which of their two targets the name stops, not only which language spells it. */
const WEBGPU = 'WebGPU';
const WEBGL2 = 'WebGL2';

/** Why WGSL refuses this spelling, or `undefined` if it does not. The spec has four rules:
 *  a keyword or reserved word, the single `_`, any name beginning with `__`, and the identifier
 *  profile, whose characters are XID_Start and XID_Continue and `_`, which leaves out the `$`
 *  that TypeScript takes (Rule 3.2, #376). */
function wgslRefusal(name: string): string | undefined {
  if (name.includes('$')) return `contains "$", which a WGSL identifier cannot hold`;
  if (WGSL_RESERVED.has(name)) return `is reserved in WGSL`;
  if (name.startsWith('__')) return `begins with two underscores, which WGSL reserves`;
  if (name === '_') return `is WGSL's phony assignment target, not an identifier`;
  return undefined;
}

/** Why GLSL ES 3.00 refuses this spelling, or `undefined` if it does not. Beside the word list
 *  (§3.6) that section has two SHAPE rules, both measured on ANGLE rather than read: `gl_Scale`
 *  is "'gl_' : reserved built-in name", and `a__b` is "identifiers containing two consecutive
 *  underscores (__) are reserved as possible future keywords" — anywhere in the name, where
 *  WGSL's own rule is about the first two characters only. */
function glslRefusal(name: string): string | undefined {
  if (GLSL_ES300_RESERVED.has(name)) return `is reserved in GLSL ES 3.00`;
  if (name.startsWith('gl_')) return `begins with "gl_", which GLSL ES 3.00 keeps for built-ins`;
  if (name.includes('__'))
    return `has two consecutive underscores, which GLSL ES 3.00 reserves for future keywords`;
  return undefined;
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
  const emitsGlsl = !funcs.some((f) => f.stage === 'compute');
  const varNames = new Set(vars.map((v) => v.name));
  // One declaration, one diagnostic: a generic struct is collected once per set of type
  // arguments the file writes it with, so its fields are recorded once per instantiation and
  // would otherwise draw one identical squiggle each.
  const reported = new Set<string>();
  for (const sym of symbols) {
    // These variables receive backend spellings; authored names remain in the original IR.
    if (
      sym.kind === 'local' ||
      sym.kind === 'param' ||
      sym.kind === 'const' ||
      (sym.kind === 'binding' && varNames.has(sym.name))
    )
      continue;
    const emitted = sym.name;
    const written = sourceFile.text.slice(sym.start, sym.start + sym.length);
    // A module variable is recorded as a `binding` (the editor spells both `let name: T`),
    // but the author knows the difference and the message should too.
    const noun =
      sym.kind === 'binding' && varNames.has(emitted) ? 'module variable' : NOUN[sym.kind];
    const wgsl = wgslRefusal(emitted);
    const glsl = emitsGlsl && GLSL_VERBATIM.has(sym.kind) ? glslRefusal(emitted) : undefined;
    const [why, api] =
      wgsl !== undefined ? [wgsl, WEBGPU] : glsl !== undefined ? [glsl, WEBGL2] : [undefined, ''];
    if (why === undefined) continue;
    // The flattened name is what collides, and it is not always what the author typed: a
    // static field `K` of a class `S` is emitted `S_K`. Say both when they differ, or the
    // reader is sent to a line that does not contain the word the message quotes.
    const message =
      emitted === written
        ? `"${emitted}" ${why}, so ${withArticle(noun)} of that name cannot be emitted for the ${api} target. Rename it.`
        : `"${written}" is emitted as "${emitted}", which ${why}, so this ${noun} cannot be emitted for the ${api} target. Rename it.`;
    const key = `${String(sym.start)}:${String(sym.length)}:${message}`;
    if (reported.has(key)) continue;
    reported.add(key);
    diagnostics.push(
      makeSpanDiagnostic(
        sourceFile,
        sym.start,
        sym.length,
        message,
        TS_CODES.RESERVED_NAME,
        wgsl !== undefined ? 'error' : 'warning',
      ),
    );
  }
}

/** The words before a name that make it a declaration of that name, and not a use of the name
 *  WGSL predeclares. */
const DECLARING = new Set(['let', 'var', 'const', 'override', 'struct', 'alias', 'fn']);

/**
 * Report an entry point whose name hides something the module's WGSL uses (Rule 3.2, Rule 9.5).
 *
 * A writer renames a helper function named like something its target predeclares, and never
 * an entry point: the host creates the pipeline by the name written. A module-scope declaration
 * hides a predeclared name in the whole WGSL module, so an entry named `fract` beside a call of
 * the builtin `fract`, the one `random(p)` expands to, made that call reach the entry, and an
 * entry named `f32` hid the type `array<f32>` spells. Tint refused both, and the front end said
 * nothing. An entry named `step` in a module that never calls the builtin `step` is a program
 * Tint accepts, and is left alone (Rule 13.3).
 *
 * So the check reads the WGSL the module emits, and only when an entry's name is one WGSL
 * predeclares, which is rare: a use of the name there that is not a member, a field or a
 * declaration of its own is what the entry would hide. Where the WGSL also declares a local, a
 * parameter or a field of the name, a use may be that declaration's, and nothing is reported,
 * so the check never refuses what Tint accepts. One error per entry, at its name.
 */
export function reportHiddenPredeclared(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
  symbols: readonly DeclaredSymbol[],
  m: ModuleDecl,
): void {
  const entries = m.funcs.filter((f) => f.stage !== undefined && WGSL_PREDECLARED.has(f.name));

  if (entries.length === 0) return;
  let wgsl: string;
  try {
    wgsl = emitModule(m);
  } catch {
    // A module the WGSL writer refuses is reported where the emit runs.
    return;
  }
  const words = lexShader(wgsl);
  for (const f of entries) {
    let used = false;
    let declared = false;
    words.forEach((t, i) => {
      if (t.kind !== 'word' || t.text !== f.name) return;
      const before = words[i - 1]?.text;
      const after = words[i + 1]?.text;
      if (before === '.') return;
      if (before === 'fn' && after === '(') return; // the entry itself
      if ((before !== undefined && DECLARING.has(before)) || after === ':') declared = true;
      else used = true;
    });
    if (!used || declared) continue;
    const sym = symbols.find((x) => x.kind === 'function' && x.name === f.name);
    if (sym === undefined) continue;
    diagnostics.push(
      makeSpanDiagnostic(
        sourceFile,
        sym.start,
        sym.length,
        `"${f.name}" is predeclared in WGSL, and this module's WGSL uses it, so an entry point of that name, which is emitted under the name written, would hide it for the WebGPU target. Rename it.`,
        TS_CODES.RESERVED_NAME,
        'error',
      ),
    );
  }
}
