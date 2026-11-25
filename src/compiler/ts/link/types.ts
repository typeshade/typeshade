import type ts from 'typescript';
import type { TsCompilerDiagnostic } from '../source-file.js';

export interface ImportHooks {
  readonly readDocument?: (fileName: string) => string | undefined;
  readonly resolveImport?: (fromFile: string, specifier: string) => string | undefined;
}

export interface LinkedFile {
  readonly name: string;
  readonly sourceFile: ts.SourceFile;
  readonly kept: boolean;
}

export interface LinkedExport {
  readonly name: string;
  readonly emitted: string;
  readonly file: string;
}

export interface MappedSpan {
  readonly file: LinkedFile;
  readonly start: number;
  readonly end: number;
}

export interface LinkedProgram {
  readonly fatal: boolean;
  readonly diagnostics: readonly TsCompilerDiagnostic[];
  readonly fileName: string;
  readonly source: string;
  readonly files: readonly LinkedFile[];
  readonly exports: readonly LinkedExport[];
  map(start: number, end: number): MappedSpan | undefined;
  readonly silenced: readonly SilencedUse[];
}

export interface SilencedUse {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly name: string;
}

export interface LinkRoot {
  readonly fileName: string;
  readonly text: string;
}

export interface ProgramFile {
  readonly name: string;
  readonly sf: ts.SourceFile;
  readonly root: boolean;
  readonly pkg: string | undefined;
  readonly imports: ProgramFile[];
}

export interface Unit {
  readonly file: ProgramFile;
  readonly stmt: ts.Statement;
  readonly names: readonly ts.Identifier[];
  readonly fixedName: 'entry point' | 'binding' | 'override' | undefined;
  readonly refs: Set<Unit>;
}

export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface Piece {
  readonly at: number;
  readonly length: number;
  readonly file: ProgramFile | undefined;
  readonly from: number;
  readonly anchor?: { readonly start: number; readonly end: number };
}
