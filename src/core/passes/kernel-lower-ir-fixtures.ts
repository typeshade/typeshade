import type { Expr, ModuleDecl, Stmt } from '../ir/nodes.js';
import type { ShaderType } from '../ir/types.js';
import { u32T, voidT } from '../ir/types.js';
import type { ForStmt, LoopCtx } from './kernel-lower-ir.js';

export const u32Array: ShaderType = { kind: 'array', elem: u32T };
export const lit = (value: number, type: ShaderType = u32T): Expr => ({ op: 'lit', type, value });
export const ref = (name: string, type: ShaderType = u32T): Expr => ({ op: 'varref', type, name });
export const param = (name: string, type: ShaderType = u32T): Expr => ({ op: 'param', type, name });
export const idx = (base: Expr, i: Expr): Expr => ({ op: 'index', type: u32T, base, idx: i });
export const emptyModule: ModuleDecl = { consts: [], structs: [], bindings: [], funcs: [] };

export const loopOver = (body: Stmt[], cond?: Expr, step = 1): ForStmt => ({
  s: 'for',
  init: { s: 'var', name: 'i', type: u32T, init: lit(0) },
  cond: cond ?? { op: 'compare', type: u32T, cop: '<', a: ref('i'), b: param('n') },
  update: { s: 'assign', target: ref('i'), expr: lit(1) },
  counted: { name: 'i', op: (step > 0 ? 'add' : 'sub') as 'add', step },
  body,
});

export const ctx = (over: Partial<LoopCtx> & { loop: ForStmt }): LoopCtx => ({
  f: { name: 'f', params: [], ret: voidT, body: [], kernel: true },
  wg: 64,
  j: 0,
  counter: 'i',
  counterType: u32T,
  step: 1,
  prelude: [],
  scalars: ['n'],
  arrays: ['out'],
  argsBinding: '_args',
  argsStruct: 'Args',
  scatter: new Set(),
  bindingNames: new Map(),
  skip: false,
  ...over,
});
