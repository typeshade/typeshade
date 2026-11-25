import type { CompileTsSourceResult } from '../../compiler/ts/source-file.js';

export interface HoverProgram {
  readonly uri: string;
  readonly analysis: CompileTsSourceResult;
}

export interface HoverPrograms {
  linking(declaringUri: string): readonly HoverProgram[];
  of(uri: string): HoverProgram | undefined;
}

export type StructNames = (emitted: string) => string;
