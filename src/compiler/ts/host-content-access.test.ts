import { describe, expect, it } from 'vitest';
import { hostContentReads } from './host-content-access.js';
import type { Expr, FuncDecl, ModuleDecl } from '../../core/ir/nodes.js';
import { f32T, voidT } from '../../core/ir/types.js';

const param: Expr = { op: 'varref', name: 'value', type: f32T };
const writer: FuncDecl = {
  name: 'write',
  params: [{ name: 'value', type: f32T, mode: 'inout' }],
  ret: voidT,
  body: [{ s: 'assign', target: param, expr: { op: 'lit', type: f32T, value: 7 } }],
};
const reader: FuncDecl = {
  name: 'read',
  params: writer.params,
  ret: voidT,
  body: [{ s: 'assignOp', target: param, bop: '+', expr: { op: 'lit', type: f32T, value: 1 } }],
};
function reads(declRef: FuncDecl | undefined, included: readonly FuncDecl[]) {
  const caller: FuncDecl = {
    name: 'caller',
    params: writer.params,
    ret: voidT,
    body: [
      {
        s: 'call',
        expr: {
          op: 'call',
          fn: 'write',
          type: voidT,
          args: [param],
          ...(declRef === undefined ? {} : { declRef }),
        },
      },
    ],
  };
  const module: ModuleDecl = {
    funcs: [caller, ...included],
    bindings: [],
    structs: [],
    consts: [],
  };
  return [...hostContentReads(module).get('caller')!.params];
}

describe('private content facts preserve declaration identity', () => {
  it('uses an in-module declaration rather than another function with its displayed name', () => {
    expect(reads(reader, [writer, reader])).toEqual(['value']);
    expect(reads(writer, [writer, reader])).toEqual([]);
  });
  it('keeps an unresolved declaration conservative rather than borrowing a namesake summary', () => {
    expect(reads(reader, [writer])).toEqual(['value']);
    expect(reads(undefined, [writer])).toEqual([]);
  });
});
