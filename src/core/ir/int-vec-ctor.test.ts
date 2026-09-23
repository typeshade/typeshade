import { describe, it, expect } from 'vitest';
import {
  fn,
  module,
  construct,
  vec3u,
  vec4u,
  vec3i,
  vec4i,
  vec2u,
  vec2i,
  vec3,
  u32,
  typeKey,
  vec3uT,
  vec4uT,
  vec3iT,
  vec4iT,
  u32T,
  type Node,
} from './index.js';
import { emitModule } from '../backends/wgsl.js';
import { compileModule } from '../oracle.js';

// ═══ #8 S4 — the rest of the integer vector constructors ═══
//
// `vec2u` and `vec2i` were here and the wider ones were not, so `vec3u(1, 2, 3)` — which WGSL
// writes and the `"use typeshade"` surface accepts — had to go through
// `construct(vec3uT, [1, 2, 3])`, whose ARRAY argument is the part that is easy to get wrong:
// the first attempt is `construct(vec3uT, 1, 2, 3)`, which fails inside `args.map`.

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('#8 S4 — vec3u / vec4u / vec3i / vec4i', () => {
  it('emit what the construct() spelling emits', () => {
    const pairs: Array<[Node<string>, Node<string>]> = [
      [vec3u(1, 2, 3), construct(vec3uT, [1, 2, 3])],
      [vec4u(1, 2, 3, 4), construct(vec4uT, [1, 2, 3, 4])],
      [vec3i(-1, 0, 1), construct(vec3iT, [-1, 0, 1])],
      [vec4i(-1, 0, 1, 2), construct(vec4iT, [-1, 0, 1, 2])],
    ];
    for (const [short, long] of pairs) expect(short.expr).toEqual(long.expr);
  });

  it('lift bare numbers to the element kind, not to f32', () => {
    const g = fn('g', {}, vec3uT, () => vec3u(1, 2, 3));
    expect(emitModule(module({ funcs: [g] }))).toContain('vec3<u32>(1u, 2u, 3u)');
    const h = fn('h', {}, vec3iT, () => vec3i(-1, 0, 1));
    expect(emitModule(module({ funcs: [h] }))).toContain('vec3<i32>(-1, 0, 1)');
  });

  it('carry the key the constructed type says', () => {
    const _a: Exact<
      typeof vec3u extends (...a: never[]) => infer R ? R : never,
      Node<'vec3<u32>'>
    > = true;
    expect(_a).toBe(true);
    expect(typeKey(vec3u(0, 0, 0).type)).toBe('vec3<u32>');
    expect(typeKey(vec4u(0, 0, 0, 0).type)).toBe('vec4<u32>');
    expect(typeKey(vec3i(0, 0, 0).type)).toBe('vec3<i32>');
    expect(typeKey(vec4i(0, 0, 0, 0).type)).toBe('vec4<i32>');
  });

  it('take node components too', () => {
    const g = fn('g', { n: u32T }, vec3uT, ({ n }) => vec3u(n, u32(0), n));
    expect(emitModule(module({ funcs: [g] }))).toContain('vec3<u32>(n, 0u, n)');
  });

  it('evaluate to their components on the CPU oracle', () => {
    const m = module({ funcs: [fn('g', {}, vec4iT, () => vec4i(-1, 0, 1, 2))] });
    expect(compileModule(m).fns.g!()).toEqual([-1, 0, 1, 2]);
  });

  it('complete the family without disturbing vec2u, vec2i or vec3', () => {
    expect(typeKey(vec2u(0, 0).type)).toBe('vec2<u32>');
    expect(typeKey(vec2i(0, 0).type)).toBe('vec2<i32>');
    expect(typeKey(vec3(0, 0, 0).type)).toBe('vec3<f32>');
    const f = fn('f', {}, vec3uT, () => vec3(0, 0, 0) as unknown as Node<'vec3<u32>'>);
    expect(emitModule(module({ funcs: [f] }))).toContain('vec3<f32>(0.0, 0.0, 0.0)');
  });
});
