// ═══ The file-level `"enable <extension>";` directive (§50) ═══
//
// WGSL turns a language extension on with a module-scope `enable f16;`. Some of the
// extensions this compiler can spell are DERIVED from use, because WGSL refuses the use
// without them: writing `@builtin(clip_distances)` is the whole declaration, `@blend_src(n)`
// is the whole of `dual_source_blending`, and `required-caps.ts` turns each into its
// directive. The rest — `f16` and `subgroups` — are turned on by an author who intends to
// write against them, and until now the `"use typeshade"` front end had no spelling for that
// at all: `enables` was EDSL-only metadata on a hand-assembled `ModuleDecl`.
//
// The vocabulary is DERIVED from the profile below rather than listed, so no count of it is
// written anywhere that could go stale as a lane appends a capability row.
//
// The spelling is a string directive beside `"use typeshade"`, the one top-level statement
// form a TypeShade file already has:
//
//   "use typeshade"
//   "enable subgroups"
//
// One extension per directive, WGSL's own name, and the name is checked against the WGSL
// backend's capability profile — so the list of what an author may enable is the list of what
// the writer can actually emit a directive for, and a lane that appends a capability row gets
// the author spelling with it rather than needing an edit here.

import ts from 'typescript';
import { wgslBackend } from '../../core/backends/wgsl.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `Capability` is the {@link} target below
import type { Capability, DeclarableCapability } from '../../core/ir/nodes.js';
import { makeDiagnostic } from './diagnostic.js';
import { TS_CODES } from './codes.js';
import type { TsCompilerDiagnostic } from './source-file.js';
import { unknownNameSentence } from './unknown-names.js';

/** The prefix a `"enable ..."` string directive carries. */
const ENABLE_PREFIX = 'enable ';

/** WGSL extension name → the neutral {@link Capability} it is, derived from the WGSL
 *  backend's `capProfile`: a row's `directive` IS the extension's WGSL name, so the two
 *  cannot drift and a newly appended capability row is author-spellable the day it lands. */
function extensionTable(): ReadonlyMap<string, DeclarableCapability> {
  const out = new Map<string, DeclarableCapability>();
  for (const [cap, support] of Object.entries(wgslBackend.capProfile)) {
    if (support?.directive === undefined) continue;
    out.set(support.directive, cap as DeclarableCapability);
  }
  return out;
}

/** Every WGSL extension name a `"enable ..."` directive may carry, sorted — the vocabulary the
 *  diagnostic below lists. */
export function enableExtensionNames(): readonly string[] {
  return [...extensionTable().keys()].sort();
}

/** True when `node` is a top-level `"enable <extension>";` directive, whatever the name says.
 *  `semantic.ts` reads this so a directive is not also reported as a stray top-level
 *  expression: one statement never earns two contradictory diagnostics. */
export function isEnableDirective(node: ts.Node): boolean {
  if (!ts.isExpressionStatement(node)) return false;
  const e = node.expression;
  return ts.isStringLiteral(e) && e.text.startsWith(ENABLE_PREFIX);
}

/** The capabilities the file's `"enable ..."` directives turn on, deduplicated and in source
 *  order. An unknown extension name, or a directive naming more than one, is a `TS8050`
 *  naming the vocabulary; the directive then contributes nothing, so one typo does not also
 *  fail the module closed on a capability it never asked for. */
export function collectEnables(
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): DeclarableCapability[] {
  const table = extensionTable();
  const out: DeclarableCapability[] = [];
  for (const stmt of sourceFile.statements) {
    if (!isEnableDirective(stmt)) continue;
    const raw = ((stmt as ts.ExpressionStatement).expression as ts.StringLiteral).text;
    const name = raw.slice(ENABLE_PREFIX.length).trim();
    const cap = table.get(name);
    if (cap === undefined) {
      diagnostics.push(
        makeDiagnostic(
          sourceFile,
          stmt,
          unknownNameSentence(
            `Unknown WGSL extension "${name}".`,
            name,
            [enableExtensionNames()],
            `"enable ..." takes one of: ${enableExtensionNames().join(', ')}.`,
          ),
          TS_CODES.ENABLE_NAME,
        ),
      );
      continue;
    }
    if (!out.includes(cap)) out.push(cap);
  }
  return out;
}
