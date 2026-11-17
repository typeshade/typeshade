// Implements: Rule 8.8 (docs/language-design.md; traced in reqs/).

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
  readonly type: ShaderType | undefined;
  readonly name?: string;
}

const PENDING = new WeakMap<TsCompilerDiagnostic[], Map<string, Pending>>();
const WRITTEN = new WeakMap<TsCompilerDiagnostic[], ShaderType[]>();

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

export function deferRefusal(diagnostics: TsCompilerDiagnostic[], p: Pending): void {
  let held = PENDING.get(diagnostics);
  if (held === undefined) PENDING.set(diagnostics, (held = new Map()));
  held.set(`${p.node.getStart(p.sourceFile)}:${p.message}`, p);
}

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
