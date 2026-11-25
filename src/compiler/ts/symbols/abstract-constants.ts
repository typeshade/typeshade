import type ts from 'typescript';
import type { ShaderType } from '../../../core/ir/types.js';

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
