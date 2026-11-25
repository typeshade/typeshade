import { describe, it } from 'vitest';
import { bothRefuse, bothTake } from '../core/testing/both-halves.js';

const WITH_ENTRY = (decl: string): string => `"use typeshade"
${decl}
@fragment export function fs(uv: location<0, vec2>): vec4 {
  return vec4(1.);
}
`;

const REMOVED = (written: string): string =>
  `"${written}" was removed (change 0142): a number, a bool, a vector and a matrix are values. Return the value, and write [a, b] = f(a, b) for more than one.`;

describe('the removed qualifier types are the compiler refusal alone', () => {
  it('reports inout<f32> once, with no TS2304 for the name', () => {
    bothRefuse(
      WITH_ENTRY('function f(a: inout<f32>): f32 {\n  return a;\n}'),
      'TS8028',
      REMOVED('inout<f32>'),
    );
  });

  it('reports out<f32> once, with no TS2304 for the name', () => {
    bothRefuse(
      WITH_ENTRY('function f(a: out<f32>): void {\n  a = 1.;\n}'),
      'TS8028',
      REMOVED('out<f32>'),
    );
  });

  it('takes a class that the file names inout', () => {
    bothTake(
      WITH_ENTRY('class inout {\n  x: f32 = 1.;\n}\nfunction f(a: inout): f32 {\n  return a.x;\n}'),
    );
  });
});

describe('an attribute type with a malformed argument is the compiler refusal alone', () => {
  const LOCATION = '@location takes one non-negative integer literal: @location(0).';

  it('reports a string location once, with no TS2344 for the argument', () => {
    bothRefuse(
      `"use typeshade";
@fragment export function fs(uv: location<"x", vec2>): vec4 {
  return vec4(1.);
}
`,
      'TS8028',
      LOCATION,
    );
  });

  it('reports a negative location once, with no TS2344 for the argument', () => {
    bothRefuse(
      `"use typeshade";
@fragment export function fs(uv: location<-1, vec2>): vec4 {
  return vec4(1.);
}
`,
      'TS8028',
      LOCATION,
    );
  });

  it('reports an unknown builtin name once, with no TS2344 for the name', () => {
    const names =
      'vertex_index, instance_index, position, front_facing, frag_depth, sample_index, sample_mask, primitive_index, local_invocation_id, local_invocation_index, global_invocation_id, workgroup_id, num_workgroups, subgroup_invocation_id, subgroup_size, subgroup_id, num_subgroups, clip_distances';
    bothRefuse(
      `"use typeshade";
@vertex export function vs(i: builtin<"bogus", u32>): vec4 {
  return vec4(1.);
}
`,
      'TS8024',
      `Unknown builtin "bogus". Supported names: ${names}.`,
    );
  });
});
