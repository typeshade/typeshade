import { describe, it, expect } from 'vitest';
import {
  fn,
  module,
  If,
  Return,
  Var,
  f32,
  f32T,
  u32T,
  vec3uT,
  voidT,
  type FnHandle,
  type Node,
  type ReadonlyNode,
} from './index.js';
import { builtin, storageBuffer } from '../sot.js';
import { emitModule } from '../backends/wgsl.js';

// ═══ #8 B1 — a void body may drop the `voidT` token ═══
//
// The compute entry is the shape that paid for X-GIS #2458's rule: `fn('k', { gid }, voidT, body,
// { stage: 'compute' })` wrote a token whose only job was to say "nothing", and leaving it out
// was a `tsc` error rather than an inference. The void overloads make the short spelling an
// authored one; the type-level claim `'void'` is held up by the SD0113 throw, which is what
// keeps it from being the lie X-GIS #2458 refused.

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

// Instrument check — `Exact` must SEPARATE the fallback from a precise key, or every
// assertion below is vacuous.
const _exactRejectsFallback: Exact<string, 'void'> = false;

describe('#8 B1 — fn() infers void', () => {
  it('emits the same bytes with and without the token', () => {
    const gid = builtin('global_invocation_id', vec3uT);
    const dst = storageBuffer('dst', f32T, { group: 0, binding: 0, access: 'read_write' });
    const body = (p: { gid: ReadonlyNode<'vec3<u32>'> }) => {
      dst.at(p.gid.x).assign(f32(1));
    };
    const withToken = fn('k', { gid }, voidT, body, { stage: 'compute' });
    const inferred = fn('k', { gid }, body, { stage: 'compute' });
    expect(emitModule(module({ uses: [dst], funcs: [inferred] }))).toBe(
      emitModule(module({ uses: [dst], funcs: [withToken] })),
    );
    expect(emitModule(module({ uses: [dst], funcs: [inferred] }))).toContain(
      '@compute @workgroup_size(64)',
    );
  });

  it("lands the handle on 'void', not on the `string` fallback", () => {
    const h = fn('touch', { x: f32T }, ({ x }) => {
      Var('t', x.add(1));
    });
    // The load-bearing assertion. `string` here would put every call site of `h` outside the
    // phantom-key checker, which is the regression X-GIS #2458 named.
    const _h: Exact<ReturnType<typeof h>, Node<'void'>> = true;
    expect([_h, _exactRejectsFallback]).toEqual([true, false]);
    const _decl: FnHandle<{ x: typeof f32T }, 'void'> = h;
    expect(_decl.ret).toEqual(voidT);
  });

  it('accepts a bare early Return() — nothing leaves, so nothing is claimed', () => {
    const h = fn('guard', { n: u32T }, ({ n }) => {
      If(n.gt(4), () => {
        Return();
      });
      Var('t', f32(0));
    });
    expect(h.ret).toEqual(voidT);
    expect(emitModule(module({ funcs: [h] }))).toContain('fn guard(n: u32)');
  });

  it('turns away a body that returns a VALUE through an ambient Return (SD0113)', () => {
    expect(() =>
      fn('leaks', { x: f32T }, ({ x }) => {
        If(x.gt(0), () => {
          Return(x);
        });
        Return(f32(0));
      }),
    ).toThrow(/SD0113[\s\S]*f32/);
  });

  it('the SD0113 message names the fix — write the token', () => {
    let msg = '';
    try {
      fn('leaks2', { x: f32T }, ({ x }) => {
        Return(x);
      });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("fn('leaks2', params, <the type token>, body)");
  });

  it('the anonymous form infers void too', () => {
    const _fn = fn({ x: f32T }, ({ x }) => {
      Var('t', x.add(1));
    });
    const _h: Exact<ReturnType<typeof _fn>, Node<'void'>> = true;
    expect(_h).toBe(true);
  });

  it('leaves the value-returning overload alone — a node body keeps its own key', () => {
    const g = fn('half', { x: f32T }, ({ x }) => x.mul(0.5));
    const _g: Exact<ReturnType<typeof g>, Node<'f32'>> = true;
    expect(_g).toBe(true);
    expect(emitModule(module({ funcs: [g] }))).toContain('fn half(x: f32) -> f32');
  });
});
