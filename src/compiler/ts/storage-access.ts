// Implements: Rule 6.2 (docs/language-design.md; traced in reqs/).
import type ts from 'typescript';
import { stageOf, type BindingDecl, type FuncDecl, type ModuleDecl } from '../../core/ir/nodes.js';
import { fnWrites } from '../../core/passes/effects.js';
import { reachFrom } from '../../core/passes/stage-bindings.js';
import { atomicWithin } from './lower/atomics.js';
import { TS_CODES } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import type { CompileTsSourceResult, TsCompilerDiagnostic } from './source-file.js';
import { settleUseInference } from './use-inference.js';

type StorageAccess = 'read' | 'read_write';

const DECISIONS = new WeakMap<ts.SourceFile, Map<string, StorageAccess>>();

export function inferredStorageAccess(sourceFile: ts.SourceFile, name: string): StorageAccess {
  let table = DECISIONS.get(sourceFile);
  if (table === undefined) DECISIONS.set(sourceFile, (table = new Map()));
  if (!table.has(name)) table.set(name, 'read_write');
  return table.get(name)!;
}

const moduleOf = (funcs: readonly FuncDecl[], bindings: readonly BindingDecl[]): ModuleDecl => ({
  consts: [],
  structs: [],
  bindings,
  funcs,
  overrides: [],
  vars: [],
});

const isRoot = (f: FuncDecl): boolean => stageOf(f) !== undefined || f.kernel === true;

function writtenByRoots(
  funcs: readonly FuncDecl[],
  bindings: readonly BindingDecl[],
  roots: (f: FuncDecl) => boolean = isRoot,
) {
  const writes = fnWrites(moduleOf(funcs, bindings));
  const written = new Set<string>();
  for (const f of funcs) if (roots(f)) for (const n of writes.get(f.name) ?? []) written.add(n);
  return written;
}

export function settleStorageAccess(sourceFile: ts.SourceFile, result: CompileTsSourceResult) {
  const table = DECISIONS.get(sourceFile);
  if (table === undefined) return false;
  const written = writtenByRoots(result.funcs, result.bindings);
  for (const b of result.bindings) if (atomicWithin(b.type) !== undefined) written.add(b.name);
  let changed = false;
  for (const [name, access] of table) {
    const decided = written.has(name) ? 'read_write' : 'read';
    if (decided !== access) changed = true;
    table.set(name, decided);
  }
  return changed;
}

export function settleInference(sourceFile: ts.SourceFile, result: CompileTsSourceResult) {
  const numbers = settleUseInference(sourceFile);
  if (numbers) {
    const table = DECISIONS.get(sourceFile);
    if (table !== undefined) for (const name of table.keys()) table.set(name, 'read_write');
    return true;
  }
  return settleStorageAccess(sourceFile, result);
}

export function checkVertexReadsWritten(
  funcs: readonly FuncDecl[],
  bindings: readonly BindingDecl[],
  nodeByName: ReadonlyMap<string, ts.NamedDeclaration>,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): void {
  const elsewhere = writtenByRoots(funcs, bindings, (f) => isRoot(f) && stageOf(f) !== 'vertex');
  const module = moduleOf(funcs, bindings);
  const writes = fnWrites(module);
  for (const entry of funcs.filter((f) => stageOf(f) === 'vertex')) {
    const node = nodeByName.get(entry.name);
    if (node?.name === undefined) continue;
    const own = writes.get(entry.name) ?? new Set<string>();
    for (const name of reachFrom(module, [entry]).bindings) {
      if (bindings.find((b) => b.name === name)?.space !== 'storage') continue;
      const binding = bindings.find((b) => b.name === name);
      if (own.has(name) && atomicWithin(binding!.type) === undefined) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            node.name,
            `WebGPU allows no writable storage buffer in the vertex stage, and the vertex entry ` +
              `"${entry.name}" writes "${name}": write it from a compute or fragment entry, or ` +
              `give the vertex stage a separate binding.`,
            TS_CODES.UNSUPPORTED,
          ),
        );
      } else if (elsewhere.has(name)) {
        diagnostics.push(
          makeDiagnostic(
            sourceFile,
            node.name,
            `WebGPU allows no writable storage buffer in the vertex stage, and the module writes ` +
              `"${name}" that the vertex entry "${entry.name}" reads: give the vertex stage a ` +
              `separate binding, or declare "${name}" readonly and write nothing to it.`,
            TS_CODES.UNSUPPORTED,
          ),
        );
      }
    }
  }
}
