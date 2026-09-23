import { describe, it, expect } from 'vitest';
import {
  fn,
  module,
  Var,
  arrayLit,
  arrayT,
  vec3,
  f32,
  u32,
  f32T,
  u32T,
  vec3fT,
  typeKey,
  type Node,
  type ReadonlyNode,
  type ArrayElemKey,
} from './index.js';
import { emitModule } from '../backends/wgsl.js';
import { compileModule } from '../oracle.js';

// ═══ #8 S3 — xs.at(i) reads its own element type ═══
//
// The declaration already said what the elements are. `xs.at(i, f32T)` says it again, and
// forgetting the second half was a RUNTIME TypeError rather than a tsc error, because the
// element ShaderType was the only place the type came from. A `storageBuffer` handle's `.at(i)`
// already took one argument, and the `"use typeshade"` surface writes `xs[i]`; this is the
// same spelling on a plain array node.

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('#8 S3 — ArrayElemKey', () => {
  it('takes the element off a sized and an unsized array key', () => {
    const _a: Exact<ArrayElemKey<'array<f32,4>'>, 'f32'> = true;
    const _b: Exact<ArrayElemKey<'array<f32>'>, 'f32'> = true;
    const _c: Exact<ArrayElemKey<'array<vec3<f32>,2>'>, 'vec3<f32>'> = true;
    const _d: Exact<ArrayElemKey<'array<struct:Seg,8>'>, 'struct:Seg'> = true;
    expect([_a, _b, _c, _d]).toEqual([true, true, true, true]);
  });

  it('handles the nested case the naive first-comma split gets wrong', () => {
    // `array<array<f32,2>,3>` split at the FIRST comma yields `array<f32`, a key matching
    // nothing. The size is at the last position, which is what DropArraySize walks to.
    const _n: Exact<ArrayElemKey<'array<array<f32,2>,3>'>, 'array<f32,2>'> = true;
    expect(_n).toBe(true);
  });

  it('is never for a key that is not an array', () => {
    const _s: Exact<ArrayElemKey<'f32'>, never> = true;
    const _v: Exact<ArrayElemKey<'vec3<f32>'>, never> = true;
    expect([_s, _v]).toEqual([true, true]);
  });
});

describe('#8 S3 — .at(i) without the element token', () => {
  it('emits what the two-argument call emits', () => {
    const short = emitModule(
      module({
        funcs: [
          fn('g', { i: u32T }, f32T, ({ i }) => {
            const xs = Var('xs', arrayLit(f32T, f32(1), f32(2), f32(3)));
            return xs.at(i);
          }),
        ],
      }),
    );
    const long = emitModule(
      module({
        funcs: [
          fn('g', { i: u32T }, f32T, ({ i }) => {
            const xs = Var('xs', arrayLit(f32T, f32(1), f32(2), f32(3)));
            return xs.at(i, f32T);
          }),
        ],
      }),
    );
    expect(short).toBe(long);
    expect(short).toContain('return xs[i];');
  });

  it('types the read, so the fn handle takes the element key', () => {
    const g = fn('g', { i: u32T }, f32T, ({ i }) => {
      const xs = Var('xs', arrayLit(f32T, f32(1), f32(2)));
      const e = xs.at(i);
      const _k: Exact<typeof e, Node<'f32'>> = true;
      expect(_k).toBe(true);
      return e;
    });
    expect(typeKey(g.ret)).toBe('f32');
  });

  it('carries a vector element through', () => {
    const g = fn('g', {}, vec3fT, () => {
      const ps = Var('ps', arrayLit(vec3fT, vec3(1, 0, 0), vec3(0, 1, 0)));
      const e = ps.at(1);
      const _k: Exact<typeof e, Node<'vec3<f32>'>> = true;
      expect(_k).toBe(true);
      return e;
    });
    expect(compileModule(module({ funcs: [g] })).fns.g!()).toEqual([0, 1, 0]);
  });

  it('lifts a JS number index to u32, as the two-argument call does', () => {
    const src = emitModule(
      module({
        funcs: [
          fn('g', {}, f32T, () => {
            const xs = Var('xs', arrayLit(f32T, f32(1), f32(2)));
            return xs.at(0);
          }),
        ],
      }),
    );
    expect(src).toContain('xs[0u]');
  });

  it('keeps the two-argument call, which is what a WIDENED node still needs', () => {
    // A node whose key is the `string` fallback — an unparameterised helper param, a struct
    // read the phantom key cannot see into — has no element to read, so the token stays.
    const g = fn('g', { i: u32T }, f32T, ({ i }) => {
      const xs = Var('xs', arrayT(f32T, 4)) as unknown as ReadonlyNode<string>;
      // The one-argument form is not reachable on such a node: `string` is not an array key.
      // @ts-expect-error — #8 S3: the `this:` bound wants an `array<...>` key.
      const _unreachable = () => xs.at(i);
      expect(_unreachable).toBeTypeOf('function');
      return xs.at(i, f32T);
    });
    expect(emitModule(module({ funcs: [g] }))).toContain('xs[i]');
  });

  it('rejects a one-argument .at on a non-array receiver', () => {
    const v = vec3(1, 2, 3);
    // @ts-expect-error — #8 S3: the `this:` bound admits an array key only.
    expect(() => v.at(u32(0))).toThrow(/SD0117[\s\S]*vec3<f32>/);
  });
});
