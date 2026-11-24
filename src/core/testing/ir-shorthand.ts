import {
  f32T,
  type Expr,
  type FuncDecl,
  type ModuleDecl,
  type ShaderType,
  type Stmt,
} from '../ir/index.js';
import { stampSpans } from './stamp-spans.js';

export const param = (name: string, type: ShaderType = f32T): Expr => ({ op: 'param', type, name });
export const ref = (name: string, type: ShaderType = f32T): Expr => ({ op: 'varref', type, name });
export const lit = (value: number, type: ShaderType = f32T): Expr => ({ op: 'lit', type, value });
export const call = (fn: string, args: Expr[], type: ShaderType = f32T): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});
export const add = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '+', a, b });
export const mul = (a: Expr, b: Expr): Expr => ({ op: 'binop', type: f32T, bop: '*', a, b });
export const field = (base: Expr, name: string, type: ShaderType = f32T): Expr => ({
  op: 'member',
  type,
  base,
  field: name,
});

export function moduleOfFuncs(funcs: FuncDecl[], structs: ModuleDecl['structs'] = []): ModuleDecl {
  return stampSpans({ consts: [], structs, bindings: [], funcs });
}

export function entryModule(
  body: Stmt[],
  params: FuncDecl['params'] = [{ name: 'x', type: f32T }],
  structs: ModuleDecl['structs'] = [],
): ModuleDecl {
  return moduleOfFuncs([{ name: 'fs', params, ret: f32T, body }], structs);
}
