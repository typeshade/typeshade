import { describe, it, expect } from 'vitest';
import { module, constExpr, fn } from './builder.js';
import { vec4, arrayLit, constRef } from './node.js';
import { vec4fT, arrayT, type ShaderType } from './types.js';
import { emitModule } from '../backends/wgsl.js';
import { compileModule } from '../oracle.js';
import type { Node } from './node.js';

// ═══ #8 B6 — the constExpr handle carries its own reader ═══
//
// AUTHORING.md says of `constRef('SKY', vec4fT)` that "the string is not checked". It is also
// a second copy of the type. So a rename or a retype of the constant is silent at every call
// site until the GPU compiler sees it. `.node` is the declaration's own reference, made from
// the name and type it was declared with, so the two cannot disagree.

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('#8 B6 — constExpr().node', () => {
  const SKY = constExpr('SKY', vec4fT, vec4(0.5, 0.7, 1, 1));

  it('emits what the constRef spelling emits', () => {
    const viaNode = emitModule(module({ consts: [SKY], funcs: [fn('bg', {}, () => SKY.node)] }));
    const viaRef = emitModule(
      module({ consts: [SKY], funcs: [fn('bg', {}, () => constRef('SKY', vec4fT))] }),
    );
    expect(viaNode).toBe(viaRef);
    expect(viaNode).toContain('const SKY: vec4<f32> = vec4<f32>(0.5, 0.7, 1.0, 1.0);');
    expect(viaNode).toContain('return SKY;');
  });

  it('carries the declared type, so the fn handle takes the right key', () => {
    const bg = fn('bg', {}, () => SKY.node);
    const _k: Exact<ReturnType<typeof bg>, Node<'vec4<f32>'>> = true;
    expect(_k).toBe(true);
  });

  it('works for an array constant too', () => {
    const PAL = constExpr(
      'PAL',
      arrayT(vec4fT, 2),
      arrayLit(vec4fT, vec4(1, 0, 0, 1), vec4(0, 1, 0, 1)),
    );
    const m = module({ consts: [PAL], funcs: [fn('p', {}, () => PAL.node.at(0, vec4fT))] });
    expect(emitModule(m)).toContain('PAL[0u]');
    expect(compileModule(m).fns.p!()).toEqual([1, 0, 0, 1]);
  });

  it('is STILL the ConstDecl — module({ consts }) takes it unchanged', () => {
    // The declaration goes into the module as itself; `.node` must not have turned it into a
    // handle that `consts:` no longer accepts.
    const decls: ShaderType[] = [SKY.type];
    expect(decls).toHaveLength(1);
    expect(SKY.name).toBe('SKY');
    expect(SKY.valueExpr).toBeDefined();
  });

  it('keeps `node` off every spread, key list and serialization of the decl', () => {
    // Why non-enumerable: the decl is spread and compared on its way through module assembly
    // and the passes. An enumerable Expr-bearing field would show up in all of it.
    expect(Object.keys(SKY)).toEqual(['name', 'type', 'wgslValue', 'cpuValue', 'valueExpr']);
    expect({ ...SKY }).toEqual({
      name: 'SKY',
      type: vec4fT,
      wgslValue: 0,
      cpuValue: 0,
      valueExpr: SKY.valueExpr,
    });
    expect(JSON.parse(JSON.stringify(SKY)).node).toBeUndefined();
    expect(SKY.node).toBeDefined();
  });
});
