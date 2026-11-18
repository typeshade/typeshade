import type ts from 'typescript';
import type { Expr, FuncDecl, Stmt } from '../../../../core/ir/nodes.js';

export type MadeElement = 'f32' | 'i32' | 'u32';

export interface MadeArray {
  readonly param: string;
  readonly count: string;
  readonly shown: string;
  readonly element: MadeElement;
  readonly length: Expr;
  readonly fill?: Expr;
  readonly grown?: true;
  readonly prelude: readonly Stmt[];
  readonly form: string;
  readonly lengthText: string;
}

export interface MadeLowering {
  readonly decl: ts.VariableDeclaration;
  readonly param: string;
  readonly element: MadeElement;
  readonly length: Expr;
  readonly fill?: Expr;
  readonly lengthNode: ts.Node;
  readonly fillNode?: ts.Node;
  readonly grown?: true;
  readonly form: string;
  readonly lengthText: string;
}

const saidOnce = new WeakMap<FuncDecl, ts.Node[]>();

export function sayOnceAt(fn: FuncDecl, node: ts.Node): void {
  saidOnce.set(fn, [...(saidOnce.get(fn) ?? []), node]);
}

export function nodesSaidOnce(fn: FuncDecl): readonly ts.Node[] {
  return saidOnce.get(fn) ?? [];
}

const candidates = new WeakMap<FuncDecl, ts.VariableDeclaration>();
const lowerings = new WeakMap<FuncDecl, MadeLowering>();
const settled = new WeakMap<FuncDecl, MadeArray>();

export function setMadeCandidate(fn: FuncDecl, decl: ts.VariableDeclaration): void {
  candidates.set(fn, decl);
}

export function madeCandidateOf(fn: FuncDecl | undefined): ts.VariableDeclaration | undefined {
  return fn === undefined ? undefined : candidates.get(fn);
}

export function setMadeLowering(fn: FuncDecl, lowering: MadeLowering): void {
  lowerings.set(fn, lowering);
}

export function madeLoweringOf(fn: FuncDecl): MadeLowering | undefined {
  return lowerings.get(fn);
}

export function setMadeArray(fn: FuncDecl, made: MadeArray): void {
  settled.set(fn, made);
}

export function madeArrayOf(fn: FuncDecl): MadeArray | undefined {
  return settled.get(fn);
}
