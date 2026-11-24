import { describe, it, expect } from 'vitest';
import {
  fn,
  module,
  If,
  Return,
  storageBuffer,
  resource,
  builtin,
  bitcastU32,
  f32T,
  u32T,
  vec3uT,
  vec4uT,
  voidT,
} from '../ir/index.js';
import { createComputeRunner } from '../../compute.js';

function twoDimensionalKernel() {
  const input = storageBuffer('feat_data', f32T, { group: 0, binding: 0, access: 'read' });
  const out = storageBuffer('out_value', u32T, { group: 0, binding: 1, access: 'read_write' });
  const dispatch = resource('u_dispatch', vec4uT, { group: 0, binding: 2 });
  const kernel = fn(
    'scale_features',
    { gid: builtin('global_invocation_id', vec3uT) },
    voidT,
    ({ gid }) => {
      const i = gid.x;
      If(i.ge(dispatch.node.x), () => {
        Return();
      });
      out.at(i).assign(bitcastU32(input.at(i)));
    },
    { stage: 'compute', portable: true, workgroupSize: [8, 8] },
  );
  return module({
    bindings: [input.binding, out.binding, dispatch.binding],
    funcs: [kernel],
  });
}

describe('createComputeRunner — the analyzer verdict throws before any later stage', () => {
  it('a two-dimensional workgroup shape is refused with the analyzer sentence', async () => {
    await expect(createComputeRunner(twoDimensionalKernel(), { prefer: ['cpu'] })).rejects.toThrow(
      /^createComputeRunner: .*workgroup shape \[8, 8, 1\]/,
    );
  });
});
