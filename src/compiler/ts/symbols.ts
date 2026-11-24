import type ts from 'typescript';
import type { ShaderType } from '../../core/ir/types.js';
export {
  captureExpressionRecords,
  openExpressionTable,
  recordLoweredExpression,
  loweredTypeOf,
  closeExpressionTable,
} from './symbols/lowered-expressions.js';
export type { LoweredExpression } from './symbols/lowered-expressions.js';
export { recordInferredReturn, inferredReturnAt } from './symbols/inferred-returns.js';
export { recordDeclaration } from './symbols/declared.js';
export type {
  DeclaredSymbolKind,
  DeclaredParam,
  DeclaredSymbol,
  DeclaredSymbolSink,
} from './symbols/declared.js';

export interface AbstractConstDecl {
  readonly fileName: string;
  readonly start: number;
  readonly length: number;
  readonly keyword: 'const' | 'static';
  readonly written: string;
  readonly integerWritten: boolean;
}

export interface AbstractConstRead {
  readonly start: number;
  readonly length: number;
  readonly type: ShaderType | null;
}

export interface AbstractConstTable {
  readonly decls: readonly AbstractConstDecl[];
  readonly reads: readonly AbstractConstRead[];
}

const abstractConstTables = new WeakMap<ts.SourceFile, AbstractConstTable>();

export function recordAbstractConstTable(
  sourceFile: ts.SourceFile,
  table: AbstractConstTable,
): void {
  abstractConstTables.set(sourceFile, table);
}

export function abstractConstTableOf(sourceFile: ts.SourceFile): AbstractConstTable | undefined {
  return abstractConstTables.get(sourceFile);
}

const resultCopies = new WeakMap<
  ts.SourceFile,
  {
    readonly decls: Map<number, { readonly name: string; readonly types: readonly ShaderType[] }>;
    readonly calls: Map<number, ShaderType | null>;
    readonly params: Map<number, readonly ShaderType[]>;
  }
>();

function resultCopiesOf(sourceFile: ts.SourceFile) {
  let table = resultCopies.get(sourceFile);
  if (table === undefined) {
    table = { decls: new Map(), calls: new Map(), params: new Map() };
    resultCopies.set(sourceFile, table);
  }
  return table;
}

export function recordResultCopies(
  sourceFile: ts.SourceFile,
  name: ts.Node,
  shown: string,
  types: readonly ShaderType[],
): void {
  resultCopiesOf(sourceFile).decls.set(name.getStart(sourceFile), { name: shown, types });
}

export function recordCopyCall(
  sourceFile: ts.SourceFile,
  callee: ts.Node,
  type: ShaderType,
  params: readonly ShaderType[] = [],
): void {
  const { calls, params: paramsAt } = resultCopiesOf(sourceFile);
  const at = callee.getStart(sourceFile);
  paramsAt.set(at, params);
  const seen = calls.get(at);
  if (seen === undefined) calls.set(at, type);
  else if (seen !== null && JSON.stringify(seen) !== JSON.stringify(type)) calls.set(at, null);
}

export function mapResultCopies(
  linked: ts.SourceFile,
  entry: ts.SourceFile,
  at: (offset: number) => number | undefined,
): void {
  const table = resultCopies.get(linked);
  if (table === undefined) return;
  const mine = resultCopiesOf(entry);
  for (const [offset, type] of table.calls) {
    const to = at(offset);
    if (to === undefined) continue;
    mine.calls.set(to, type);
    const params = table.params.get(offset);
    if (params !== undefined) mine.params.set(to, params);
  }
  for (const [offset, decl] of table.decls) {
    const to = at(offset);
    if (to !== undefined) mine.decls.set(to, decl);
  }
}

export function resetResultCopies(sourceFile: ts.SourceFile): void {
  resultCopies.delete(sourceFile);
}

export function copyCallParamsAt(
  sourceFile: ts.SourceFile,
  offset: number,
): readonly ShaderType[] | undefined {
  return resultCopies.get(sourceFile)?.params.get(offset);
}

export function hasResultCopies(sourceFile: ts.SourceFile): boolean {
  const table = resultCopies.get(sourceFile);
  return (table?.decls.size ?? 0) > 0 || (table?.calls.size ?? 0) > 0;
}

export function resultCopiesAt(
  sourceFile: ts.SourceFile,
  offset: number,
): { readonly name: string; readonly types: readonly ShaderType[] } | undefined {
  return resultCopies.get(sourceFile)?.decls.get(offset);
}

export function copyCallAt(sourceFile: ts.SourceFile, offset: number): ShaderType | undefined {
  return resultCopies.get(sourceFile)?.calls.get(offset) ?? undefined;
}
