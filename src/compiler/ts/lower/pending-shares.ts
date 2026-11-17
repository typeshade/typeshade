// ═══ Refusals that wait for every body (change 0142, rule 6) ═══
//
// Implements: Rule 8.8 (docs/language-design.md; traced in reqs/).
//
// A store of an object that has a name (rule 2) and a name for an object that may have one (rule
// 4) are refused only where the object's type is written somewhere in the module. That is known
// when every body is lowered, so each such refusal waits here with the lowered type of its value,
// and `resolvePendingShares` says the ones whose type is written.

import type ts from 'typescript';
import type { FuncDecl, StructDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import { makeDiagnostic } from '../diagnostic.js';
import type { TsCode } from '../codes.js';
import { typeKey } from '../../../core/ir/types.js';
import { writtenTypes } from '../written-types.js';

interface Pending {
  readonly sourceFile: ts.SourceFile;
  readonly node: ts.Node;
  readonly message: string;
  readonly code: TsCode;
  /** The lowered type of the value; absent where the lowering did not say, which is written. */
  readonly type: ShaderType | undefined;
  /** For a name a declaration would give an object: the name, which a write through it finds. */
  readonly name?: string;
}

const PENDING = new WeakMap<TsCompilerDiagnostic[], Map<string, Pending>>();
const WRITTEN = new WeakMap<TsCompilerDiagnostic[], ShaderType[]>();

/** Whether a declaration of `name` of this type holds a refusal, so that a write through it is
 *  said by that refusal; the write then counts, since no IR carries it. */
export function heldRefusal(
  diagnostics: TsCompilerDiagnostic[],
  name: string,
  type: ShaderType,
): boolean {
  const key = typeKey(type);
  const hit = [...(PENDING.get(diagnostics)?.values() ?? [])].some(
    (p) => p.name === name && p.type !== undefined && typeKey(p.type) === key,
  );
  if (hit) {
    const list = WRITTEN.get(diagnostics) ?? [];
    list.push(type);
    WRITTEN.set(diagnostics, list);
  }
  return hit;
}

/** Hold a refusal until the module's written types are known. */
export function deferRefusal(diagnostics: TsCompilerDiagnostic[], p: Pending): void {
  let held = PENDING.get(diagnostics);
  if (held === undefined) PENDING.set(diagnostics, (held = new Map()));
  held.set(`${p.node.getStart(p.sourceFile)}:${p.message}`, p);
}

/** Say each held refusal whose value's type is written, and drop the others. */
export function resolvePendingShares(
  funcs: readonly FuncDecl[],
  constructors: ReadonlySet<FuncDecl>,
  structs: readonly StructDecl[],
  diagnostics: TsCompilerDiagnostic[],
): void {
  const held = PENDING.get(diagnostics);
  if (held === undefined || held.size === 0) return;
  const types = writtenTypes(funcs, constructors, structs, WRITTEN.get(diagnostics) ?? []);
  for (const p of held.values()) {
    if (p.type !== undefined && !types.writes(p.type)) continue;
    diagnostics.push(makeDiagnostic(p.sourceFile, p.node, p.message, p.code));
  }
  held.clear();
}
