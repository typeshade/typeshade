import { describe, expect, it } from 'vitest';
import { bothTake } from '../testing/both-halves.js';
import { emitModule } from '../backends/wgsl.js';
import { lowerModule } from '../passes/match-lower.js';
import { f32T, i32T, voidT } from './types.js';
import type { Expr, FuncDecl, ModuleDecl, Stmt } from './nodes.js';

function moduleWithBody(body: Stmt[]): ModuleDecl {
  const fn: FuncDecl = { name: 'host', params: [], ret: voidT, body };
  return { consts: [], structs: [], bindings: [], funcs: [fn] };
}

const GUARDED_BY_OVERRIDE = `
  "use typeshade";
  const quality: override<f32> = 2.;
  export function viaOverride(): f32 {
    if (quality > 1.) {
      return 10.;
    }
    return 20.;
  }
`;

describe('an override read is symbolic to the optimizer', () => {
  it('keeps both arms of a branch that an override guards', () => {
    const { result } = bothTake(GUARDED_BY_OVERRIDE);
    const wgsl = result.wgsl ?? '';
    expect(wgsl).toContain('quality > 1.0');
    expect(wgsl).toContain('return 10.0;');
    expect(wgsl).toContain('return 20.0;');
  });
});

function constFn(name: string, value: number): FuncDecl {
  return {
    name,
    params: [],
    ret: f32T,
    body: [{ s: 'return', expr: { op: 'lit', type: f32T, value } }],
  };
}

describe('a call node spells its callee by fn, not by declRef', () => {
  it('emits the name in fn although declRef points at a declaration of another name', () => {
    const named = constFn('named_by_fn', 1);
    const pointed = constFn('pointed_by_declref', 2);
    const call: Expr = { op: 'call', type: f32T, fn: 'named_by_fn', args: [], declRef: pointed };
    const host: FuncDecl = {
      name: 'host',
      params: [],
      ret: f32T,
      body: [{ s: 'return', expr: call }],
    };
    const wgsl = emitModule({
      consts: [],
      structs: [],
      bindings: [],
      funcs: [named, pointed, host],
    });
    const hostText = wgsl.slice(wgsl.indexOf('fn host'));
    expect(hostText).toContain('named_by_fn()');
    expect(hostText).not.toContain('pointed_by_declref()');
  });
});

describe('a raw statement is a leaf of match lowering', () => {
  it('leaves a raw statement unchanged beside a statement that holds a matchExpr', () => {
    const raw: Stmt = { s: 'raw', wgsl: 'x = 1;', glsl: 'x = 1;' };
    const mod = moduleWithBody([
      raw,
      {
        s: 'var',
        name: 'x',
        type: i32T,
        init: {
          op: 'matchExpr',
          type: i32T,
          scrutinee: { op: 'lit', type: i32T, value: 0 },
          cases: [[0, { op: 'lit', type: i32T, value: 10 }]],
          default: { op: 'lit', type: i32T, value: 99 },
        },
      },
    ]);
    const body = lowerModule(mod).funcs[0]!.body;
    expect(body[0]).toEqual(raw);
    expect(body.map((s) => s.s)).toEqual(['raw', 'var', 'switch', 'var']);
  });
});
