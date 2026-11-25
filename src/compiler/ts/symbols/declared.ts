import type ts from 'typescript';
import type { ShaderType } from '../../../core/ir/types.js';

export type DeclaredSymbolKind =
  | 'local'
  | 'param'
  | 'const'
  | 'binding'
  | 'function'
  | 'struct'
  | 'field'
  // A specialization constant (#8 A7). Its own kind rather than 'const': its value is not
  // known until a pipeline is built, so an editor should not offer it as a folded number.
  | 'override';

export interface DeclaredParam {
  readonly name: string;
  readonly type: ShaderType;
}

export interface DeclaredSymbol {
  readonly name: string;
  readonly kind: DeclaredSymbolKind;
  readonly start: number;
  readonly length: number;
  readonly type: ShaderType;
  readonly params?: readonly DeclaredParam[];
  readonly mutable?: boolean;
  readonly struct?: string;
}

export type DeclaredSymbolSink = DeclaredSymbol[];

export function recordDeclaration(
  sink: DeclaredSymbolSink | undefined,
  sourceFile: ts.SourceFile,
  nameNode: ts.Node,
  symbol: Omit<DeclaredSymbol, 'start' | 'length'>,
): void {
  if (sink === undefined) return;
  const start = nameNode.getStart(sourceFile);
  sink.push({ ...symbol, start, length: nameNode.getEnd() - start });
}
