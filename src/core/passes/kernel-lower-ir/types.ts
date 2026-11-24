import type { FuncDecl, ModuleDecl, Stmt } from '../../ir/nodes.js';
import type { ShaderType } from '../../ir/types.js';
import type { LoopReduction } from '../parallel-loop.js';

export type ForStmt = Stmt & { s: 'for' };

export interface KernelLoopPlan {
  readonly entry: string;
  readonly range: string;
  readonly cop: '<' | '<=' | '>' | '>=';
  readonly step: number;
  readonly writes: readonly string[];
  readonly checks: readonly {
    readonly param: string;
    readonly a: number;
    readonly c: number;
    readonly read?: true;
    readonly guards?: readonly { readonly cop: '<' | '<=' | '>' | '>='; readonly fn: string }[];
  }[];
  readonly texels?: readonly { readonly param: string; readonly width: string }[];
  readonly strides?: readonly {
    readonly param: string;
    readonly coefficient: string;
    readonly base: string;
  }[];
  readonly rows?: readonly { readonly param: string; readonly width: string }[];
  readonly wg: number;
  readonly reduce?: {
    readonly entry: string;
    readonly vars: readonly (LoopReduction & { readonly binding: string })[];
  };
  readonly push?: { readonly count: string; readonly scan: string; readonly binding: string };
  readonly device?: { readonly entry: string; readonly at: number };
  readonly iterates: string;
  readonly iteration: number;
  readonly continues: boolean;
  readonly subgroupFold?: true;
}

export interface KernelPlan {
  readonly module: ModuleDecl;
  readonly subgroupModule?: ModuleDecl;
  readonly argsBinding: string;
  readonly argsStruct: string;
  readonly loops: readonly KernelLoopPlan[];
  readonly ranges: readonly FuncDecl[];
  readonly bindingNames: ReadonlyMap<string, string>;
  readonly tail?: string;
  readonly finish?: {
    readonly entry: string;
    readonly fn: string;
    readonly writes: readonly string[];
  };
  readonly words?: readonly PushWord[];
  readonly trips?: { readonly write: string; readonly read: string };
  readonly collections?: readonly KernelCollection[];
  readonly lookups?: readonly KernelLookup[];
}

export interface PushWord {
  readonly param: string;
  readonly binding: string;
  readonly field: string;
  readonly loops: readonly number[];
}

export interface KernelCollection {
  readonly param: string;
  readonly records: string;
  readonly loop: number;
  readonly perIteration: number;
}

export interface KernelLookup {
  readonly param: string;
  readonly keys: string;
  readonly values?: string;
  readonly loop: number;
}

export interface LowerOptions {
  readonly held?: boolean;
  readonly exactTotal?: boolean;
}

export interface LoopCtx {
  readonly f: FuncDecl;
  readonly wg: number;
  readonly loop: ForStmt;
  readonly j: number;
  readonly counter: string;
  readonly counterType: ShaderType;
  readonly step: number;
  readonly prelude: readonly Stmt[];
  readonly scalars: readonly string[];
  readonly arrays: readonly string[];
  readonly argsBinding: string;
  readonly argsStruct: string;
  readonly scatter: ReadonlySet<string>;
  readonly bindingNames: ReadonlyMap<string, string>;
  readonly skip: boolean;
  readonly words?: ReadonlyMap<string, PushWord>;
  readonly trips?: { readonly binding: string; readonly at: number };
  readonly subgroup?: boolean;
  readonly subgroupScatter?: boolean;
}
