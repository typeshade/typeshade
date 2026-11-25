import type ts from 'typescript';

export type SignalName = 'layer' | 'breadth' | 'home' | 'cohesion' | 'ownership';

export type Remedy =
  | 'move the file'
  | 'split along the components'
  | 'design change inside a declaration'
  | 'give the rule to its owner'
  | 'none (report)';

export type Evidence = Record<string, string | number | boolean | readonly string[]>;

export interface Finding {
  signal: SignalName;
  file: string;
  line: number;
  kind: string;
  evidence: Evidence;
  remedy: Remedy;
}

export interface ShapeContext {
  root: string;
  program: ts.Program;
  checker: ts.TypeChecker;
  analysed: readonly ts.SourceFile[];
  all: readonly ts.SourceFile[];
  rel(sf: ts.SourceFile): string;
  skipped: Readonly<Record<string, number>>;
}

export type Signal = (ctx: ShapeContext) => Finding[];
