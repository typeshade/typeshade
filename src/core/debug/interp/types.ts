import type { ConsoleSink } from '../../console.js';
import type { FuncDecl, ShaderType, Stmt, StructDecl } from '../../ir/index.js';
import type { SourceSpan } from '../../ir/span.js';
import type { CpuValue } from '../../cpu-runtime.js';
import type { TreeLoop } from '../../passes/parallel-loop.js';

export interface StepFrame {
  readonly fnName: string;
  readonly fnSpan: SourceSpan | undefined;
  readonly callSpan: SourceSpan | undefined;
  readonly env: Map<string, CpuValue>;
  readonly types: ReadonlyMap<string, ShaderType>;
  readonly parameterLocals?: ReadonlyMap<string, string>;
  readonly stubbed: Set<string>;
  current: Stmt | undefined;
}

export interface StepEvent {
  readonly stmt: Stmt;
  readonly frames: readonly StepFrame[];
  readonly afterCall?: true;
  readonly atomic?: 'before' | 'after';
}

export interface StepCtx {
  readonly consts: Map<string, CpuValue>;
  readonly overrides: Map<string, CpuValue>;
  readonly decls: Map<string, FuncDecl>;
  readonly bindings: Record<string, CpuValue>;
  readonly vars: Record<string, CpuValue>;
  readonly privates: Record<string, CpuValue>;
  readonly lockstep: boolean;
  readonly structs: Map<string, StructDecl>;
  readonly bindingNames: Set<string>;
  readonly gpuStubs: boolean;
  readonly consoleSink?: ConsoleSink;
  readonly invocation?: readonly number[];
  readonly frames: StepFrame[];
  readonly stubbed: Set<string>;
  stubHits: number;
  readonly copies: Map<string, readonly boolean[]>;
  readonly trees?: ReadonlyMap<Stmt, TreeLoop>;
  readonly f32?: boolean;
  readonly journal?: JournalEntry[];
  readonly words?: WordMemory;
}

export interface WordMemory {
  load(root: number, word: number): number;
  store(root: number, word: number, bits: number): void;
}

export interface JournalEntry {
  readonly undo: () => void;
  readonly redo: () => void;
}

export type Step<T> = Generator<StepEvent, T, void>;

export type Signal =
  | { kind: 'normal' }
  | { kind: 'return'; value: CpuValue | undefined }
  | { kind: 'break' }
  | { kind: 'continue' }
  | { kind: 'discard' };
