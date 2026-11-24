import type { Expr, FuncDecl, Stmt } from '../../ir/nodes.js';
import type { ShaderType } from '../../ir/types.js';
import type { SourceSpan } from '../../ir/span.js';

export type ForStmt = Stmt & { s: 'for' };

export type LoopRefusal =
  | { readonly rule: 'R1'; readonly why: 'while'; readonly at?: SourceSpan }
  | { readonly rule: 'R1'; readonly why: 'step'; readonly at?: SourceSpan }
  | { readonly rule: 'R2'; readonly why: 'return' | 'break'; readonly at?: SourceSpan }
  /** `name` is written and read by another iteration. */
  | {
      readonly rule: 'R3';
      readonly why: 'carried';
      readonly name: string;
      readonly at?: SourceSpan;
    }
  /** `target` is an element two iterations can share. */
  | { readonly rule: 'R3'; readonly why: 'shared'; readonly target: Expr; readonly at?: SourceSpan }
  /** `name` is pushed onto, and written another way too (change 0078). */
  | {
      readonly rule: 'R3';
      readonly why: 'push-mixed';
      readonly name: string;
      readonly at?: SourceSpan;
    }
  /** `read` reads an array the loop pushes onto: an element or its `.length` (change 0078). */
  | {
      readonly rule: 'R4';
      readonly why: 'reads-pushed';
      readonly name: string;
      readonly read: Expr;
      readonly at?: SourceSpan;
    }
  /** The value a `push` returns is read: the count before it (change 0078). */
  | { readonly rule: 'R4'; readonly why: 'push-result'; readonly at?: SourceSpan }
  /** `read` reads an element another iteration writes. */
  | {
      readonly rule: 'R4';
      readonly why: 'reads-written';
      readonly read: Expr;
      readonly at?: SourceSpan;
    }
  /** The value `fn` returns is read, and depends on the order of the iterations. */
  | {
      readonly rule: 'R4';
      readonly why: 'atomic-result';
      readonly fn: string;
      readonly at?: SourceSpan;
    }
  | {
      readonly rule: 'R5';
      readonly callee: string;
      readonly writes: string;
      readonly at?: SourceSpan;
    }
  | {
      readonly rule: 'R6';
      readonly why: 'console' | 'barrier' | 'workgroup';
      readonly name: string;
      readonly at?: SourceSpan;
    };

export type LoopWrite =
  | {
      readonly kind: 'affine';
      readonly name: string;
      readonly a: number;
      readonly c: readonly number[];
    }
  /** At one index whose coefficient of `i` is loop-invariant, which the call checks is not 0. */
  | {
      readonly kind: 'scaled';
      readonly name: string;
      readonly index: Expr;
      readonly coefficient: Expr;
    }
  /** At `i*W + x`, over the nested loop of `x` from 0 to `< W`. */
  | { readonly kind: 'row-major'; readonly name: string; readonly width: Expr }
  /** A texture at `vec2(i % W, i / W)`. */
  | { readonly kind: 'texel'; readonly name: string; readonly width: Expr }
  /** An integer array combined with `op` at any index (a scatter reduction), or through atomics.
   *  `float` is the CPU-only `f32` form of change 0056 (option C): an `f32` parameter array
   *  combined with `+=`, folded per element in the tree order by the CPU tier (`kernel-tree.ts`). */
  | { readonly kind: 'scatter'; readonly name: string; readonly op: string; readonly float?: true }
  /** An array parameter the loop appends to with `push`, in the order of the iterations (change
   *  0078). */
  | { readonly kind: 'append'; readonly name: string };

export interface ProofOptions {
  readonly cpuScatterF32?: boolean;
}

export interface LoopReduction {
  readonly name: string;
  readonly op: '+' | '*' | '&' | '|' | '^' | 'min' | 'max';
  readonly type: ShaderType;
}

export interface LoopAccess {
  readonly place: Expr;
  readonly at?: SourceSpan;
}

export interface LoopGuard {
  readonly cop: '<' | '<=' | '>' | '>=';
  readonly bound: Expr;
}

export interface LoopRead {
  readonly name: string;
  readonly atI: boolean;
  readonly first?: LoopAccess;
  readonly forms: readonly {
    readonly a: number;
    readonly c: number;
    readonly guards?: readonly LoopGuard[];
  }[];
}

export interface LoopStore {
  readonly name: string;
  readonly atI: boolean;
  readonly readBack: boolean;
  readonly first?: LoopAccess;
}

export type LoopVerdict =
  | {
      readonly ok: true;
      readonly loop: ForStmt;
      readonly writes: readonly LoopWrite[];
      readonly reductions: readonly LoopReduction[];
      readonly reads: readonly LoopRead[];
      readonly stores: readonly LoopStore[];
    }
  | { readonly ok: false; readonly loop: ForStmt; readonly refusal: LoopRefusal };

export type ShapeRefusal =
  | { readonly why: 'outside'; readonly what?: string; readonly at?: SourceSpan }
  /** A later loop reads `name`, which an earlier loop reduces. */
  | {
      readonly why: 'split';
      readonly name: string;
      readonly reducedAt?: SourceSpan;
      readonly at?: SourceSpan;
    };

export interface KernelProof {
  readonly fn: string;
  readonly shape?: ShapeRefusal;
  readonly loops: readonly LoopVerdict[];
}

export interface TreeLoop {
  readonly reductions: readonly LoopReduction[];
  readonly scatters: readonly string[];
}

export interface Ctx {
  readonly byName: ReadonlyMap<string, FuncDecl>;
  readonly writes: ReadonlyMap<string, ReadonlySet<string>>;
  readonly moduleNames: ReadonlySet<string>;
  readonly workgroup: ReadonlySet<string>;
}

export interface Write {
  readonly target: Expr;
  readonly root: string;
  readonly combine?: { readonly op: LoopReduction['op']; readonly with: Expr };
  readonly atomic?: string;
  readonly texel?: Expr;
  readonly push?: true;
  readonly at?: SourceSpan;
}

export type IndexForm =
  | { readonly kind: 'affine'; readonly a: number; readonly c: readonly number[] }
  | { readonly kind: 'scaled'; readonly index: Expr; readonly coefficient: Expr }
  | { readonly kind: 'row-major'; readonly width: Expr };
