import { describe, it, expect } from 'vitest';
import { builtin, location, WGSL_BUILTIN_TYPES, ioStruct, type WgslBuiltinName } from './sot.js';
import {
  fn,
  module,
  vec4,
  toF32,
  typeKey,
  u32T,
  f32T,
  vec2fT,
  vec4fT,
  type Node,
  type ReadonlyNode,
} from './ir/index.js';
import { emitModule } from './backends/wgsl.js';

// ═══ #8 B5 — builtin(name) reads its own type ═══
//
// `builtin('vertex_index', u32T)` writes a fact WGSL already fixed, and writing it is what
// makes disagreeing with it possible: `builtin('vertex_index', f32T)` type-checks today and
// dies at the driver. The one-argument call cannot be wrong.

type Exact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('#8 B5 — builtin(name)', () => {
  it('emits what the two-argument call emits', () => {
    const inferred = fn('vs', { vid: builtin('vertex_index') }, vec4fT, ({ vid }) =>
      vec4(toF32(vid), 0, 0, 1),
    );
    const written = fn('vs', { vid: builtin('vertex_index', u32T) }, vec4fT, ({ vid }) =>
      vec4(toF32(vid), 0, 0, 1),
    );
    expect(emitModule(module({ funcs: [inferred] }))).toBe(
      emitModule(module({ funcs: [written] })),
    );
    expect(emitModule(module({ funcs: [inferred] }))).toContain('@builtin(vertex_index) vid: u32');
  });

  it('types the param node, so the body needs no cast to find out', () => {
    fn('vs', { vid: builtin('vertex_index') }, vec4fT, ({ vid }) => {
      const _k: Exact<typeof vid, ReadonlyNode<'u32'>> = true;
      expect(_k).toBe(true);
      return vec4(toF32(vid), 0, 0, 1);
    });
    fn('cs', { gid: builtin('global_invocation_id') }, vec4fT, ({ gid }) => {
      const _k: Exact<typeof gid, ReadonlyNode<'vec3<u32>'>> = true;
      expect(_k).toBe(true);
      return vec4(toF32(gid.x), 0, 0, 1);
    });
  });

  it('serves an ioStruct field the same way', () => {
    const VsOut = ioStruct('VsOut', { pos: builtin('position'), uv: location(0, vec2fT) });
    expect(typeKey(VsOut.decl.fields[0]!.type)).toBe('vec4<f32>');
    expect(VsOut.decl.fields[0]!.attr).toBe('@builtin(position)');
  });

  it('the table covers every id but clip_distances, whose N the author picks', () => {
    const all: WgslBuiltinName[] = [
      'vertex_index',
      'instance_index',
      'position',
      'front_facing',
      'frag_depth',
      'sample_index',
      'sample_mask',
      'primitive_index',
      'local_invocation_id',
      'local_invocation_index',
      'global_invocation_id',
      'workgroup_id',
      'num_workgroups',
      'subgroup_invocation_id',
      'subgroup_size',
      'clip_distances',
    ];
    const covered = Object.keys(WGSL_BUILTIN_TYPES);
    expect([...covered].sort()).toEqual(all.filter((n) => n !== 'clip_distances').sort());
  });

  it('spells the WGSL types the pipeline actually supplies', () => {
    expect(typeKey(WGSL_BUILTIN_TYPES.vertex_index)).toBe('u32');
    expect(typeKey(WGSL_BUILTIN_TYPES.position)).toBe('vec4<f32>');
    expect(typeKey(WGSL_BUILTIN_TYPES.front_facing)).toBe('bool');
    expect(typeKey(WGSL_BUILTIN_TYPES.frag_depth)).toBe('f32');
    expect(typeKey(WGSL_BUILTIN_TYPES.global_invocation_id)).toBe('vec3<u32>');
    expect(typeKey(WGSL_BUILTIN_TYPES.num_workgroups)).toBe('vec3<u32>');
  });

  it('rejects a one-argument call for the id with no single type', () => {
    // @ts-expect-error — #8 B5: clip_distances is array<f32, N>; the token stays required.
    expect(() => builtin('clip_distances')).toThrow(/supplies no single type/);
  });

  it('leaves the two-argument call exactly as it was', () => {
    // Additive: the written-token form keeps its own key, including the disagreeing one that
    // motivated this change. Narrowing it would retype sources that compile today.
    const spec = builtin('vertex_index', f32T);
    expect(spec.type).toBe(f32T);
    const g = fn('g', { p: builtin('position', vec4fT) }, f32T, ({ p }) => p.x);
    const _k: Exact<ReturnType<typeof g>, Node<'f32'>> = true;
    expect(_k).toBe(true);
  });
});
