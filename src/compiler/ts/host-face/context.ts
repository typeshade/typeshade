import type ts from 'typescript';
import type {
  BindingDecl,
  ConstDecl,
  FuncDecl,
  ModuleDecl,
  StructDecl,
} from '../../../core/ir/nodes.js';
import type { BindingReach } from '../../../core/manifest/reach.js';
import type { compileTsSource } from '../source-file.js';

export interface FaceCtx {
  readonly sf: ts.SourceFile;
  readonly symbols: ReturnType<typeof compileTsSource>['symbols'];
  readonly byName: ReadonlyMap<string, FuncDecl>;
  readonly structs: ReadonlyMap<string, StructDecl>;
  readonly collected: ReturnType<typeof compileTsSource>['structs'];
  readonly constsByName: ReadonlyMap<string, ConstDecl>;
  readonly bindingNames: ReadonlySet<string>;
  readonly overrideNames: ReadonlySet<string>;
  readonly privateNames: ReadonlySet<string>;
  readonly reachProblem: (fn: string) => string | undefined;
  readonly fuse?: { readonly origin: string };
  readonly entry: EntryCtx;
}

interface EntryCtx {
  readonly module: ModuleDecl;
  readonly bindings: readonly BindingDecl[];
  readonly reads: ReadonlyMap<string, ReadonlySet<string>>;
  readonly writes: ReadonlyMap<string, ReadonlySet<string>>;
  readonly reach: (entry: string) => BindingReach;
  readonly callees: ReadonlyMap<string, ReadonlySet<string>>;
  readonly declared: ReadonlySet<string>;
  readonly workgroupZero: Readonly<Record<string, unknown>>;
  readonly guard?: { readonly group: number; readonly binding: number };
}
