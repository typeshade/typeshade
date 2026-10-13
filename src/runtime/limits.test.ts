// Verifies: Rule 11.11.
// The device's limits as the program runtime reports them (change 0051, part 2, Rule 11.11):
// `copyLimits` reads a `GPUSupportedLimits`-shaped object whose attributes sit on its prototype,
// as WebIDL makes them, and returns a frozen record keyed by WebGPU's names.

import { describe, expect, it } from 'vitest';
import { copyLimits, deriveLimits } from './limits.js';

/** An object shaped like `GPUSupportedLimits`: its attributes are accessors on the prototype. */
function webIdlLimits(values: Record<string, number>): object {
  const proto = {};
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(proto, name, { get: () => value, enumerable: true });
  }
  return Object.create(proto) as object;
}

describe('copyLimits', () => {
  it('copies the prototype accessors, which an object spread does not', () => {
    const device = webIdlLimits({ maxStorageBuffersPerShaderStage: 10, maxBufferSize: 268435456 });
    expect({ ...device }).toEqual({});
    expect(copyLimits(device)).toEqual({
      maxStorageBuffersPerShaderStage: 10,
      maxBufferSize: 268435456,
    });
  });

  it('returns a frozen record', () => {
    const copy = copyLimits(webIdlLimits({ maxBindGroups: 4 }));
    expect(Object.isFrozen(copy)).toBe(true);
    expect(() => {
      (copy as Record<string, number>).maxBindGroups = 9;
    }).toThrow(TypeError);
  });

  it('reports an empty frozen record for a stand-in with no limits', () => {
    const copy = copyLimits(undefined);
    expect(copy).toEqual({});
    expect(Object.isFrozen(copy)).toBe(true);
  });
});

/** A compute pack whose one entry reaches `names`, each binding as `bindings` gives it. */
function computePack(
  bindings: { name: string; group: number; binding: number; kind: string }[],
  extra: object = {},
) {
  return {
    features: [],
    bindings: bindings.map((b) => ({
      name: b.name,
      space: 'x',
      group: b.group,
      binding: b.binding,
      type: 'f32',
      stages: ['compute'],
      resource: { resourceKind: b.kind },
    })),
    entries: [
      {
        name: 'main',
        stage: 'compute',
        workgroupSize: [8, 4, 1],
        bindings: bindings.map((b) => ({ name: b.name, writes: false })),
      },
    ],
    ...extra,
  } as never;
}

describe('deriveLimits (change 0051, the derivation table)', () => {
  it('counts each resource kind per stage, and the groups and binding numbers reached', () => {
    const pack = computePack([
      { name: 'a', group: 0, binding: 0, kind: 'storage-buffer' },
      { name: 'u', group: 1, binding: 3, kind: 'uniform-buffer' },
      { name: 't', group: 1, binding: 4, kind: 'texture' },
      { name: 's', group: 1, binding: 5, kind: 'sampler' },
      { name: 'w', group: 1, binding: 6, kind: 'storage-texture' },
    ]);
    expect(deriveLimits([pack], false)).toEqual({
      maxStorageBuffersPerShaderStage: 1,
      maxUniformBuffersPerShaderStage: 1,
      maxSampledTexturesPerShaderStage: 1,
      maxSamplersPerShaderStage: 1,
      maxStorageTexturesPerShaderStage: 1,
      maxBindGroups: 2,
      maxBindingsPerBindGroup: 7,
      maxComputeWorkgroupSizeX: 8,
      maxComputeWorkgroupSizeY: 4,
      maxComputeWorkgroupSizeZ: 1,
      maxComputeInvocationsPerWorkgroup: 32,
    });
  });

  it('counts the console buffer one past group 0 for a program that records, and not otherwise', () => {
    const bindings = [
      { name: 'a', group: 0, binding: 0, kind: 'storage-buffer' },
      { name: 'b', group: 0, binding: 1, kind: 'storage-buffer' },
    ];
    expect(deriveLimits([computePack(bindings)], false).maxStorageBuffersPerShaderStage).toBe(2);
    const recorded = computePack(bindings, { console: {} });
    expect(deriveLimits([recorded], false)).toMatchObject({
      maxStorageBuffersPerShaderStage: 3,
      maxBindingsPerBindGroup: 3,
    });
    // A manifest with its IR counts the console buffer once the host gives an emitter.
    const withIr = computePack(bindings, { ir: {} });
    expect(deriveLimits([withIr], false).maxStorageBuffersPerShaderStage).toBe(2);
    expect(deriveLimits([withIr], true).maxStorageBuffersPerShaderStage).toBe(3);
  });

  it('keeps the largest need of any entry', () => {
    const wide = computePack([
      { name: 'a', group: 0, binding: 0, kind: 'storage-buffer' },
      { name: 'b', group: 0, binding: 1, kind: 'storage-buffer' },
      { name: 'c', group: 0, binding: 2, kind: 'storage-buffer' },
    ]);
    const narrow = computePack([{ name: 'a', group: 0, binding: 0, kind: 'storage-buffer' }]);
    expect(deriveLimits([narrow, wide], false).maxStorageBuffersPerShaderStage).toBe(3);
  });

  it('places the _fp64 guard one past the console buffer, which takes one past group 0', () => {
    const guardedBindings = [
      { name: 'a', group: 0, binding: 0, kind: 'storage-buffer' },
      { name: '_fp64', group: 0, binding: 1, kind: 'texture' },
    ];
    const guarded = computePack(guardedBindings);
    expect(deriveLimits([guarded], false)).toMatchObject({
      maxBindingsPerBindGroup: 2,
      maxSampledTexturesPerShaderStage: 1,
    });
    expect(deriveLimits([computePack(guardedBindings, { console: {} })], false)).toMatchObject({
      maxStorageBuffersPerShaderStage: 2,
      maxSampledTexturesPerShaderStage: 1,
      maxBindingsPerBindGroup: 3,
    });
  });

  it('places the console buffer past every group 0 binding of the module, not only those reached', () => {
    const pack = computePack(
      [
        { name: 'a', group: 0, binding: 0, kind: 'storage-buffer' },
        { name: 'far', group: 0, binding: 5, kind: 'storage-buffer' },
      ],
      {
        entries: [
          {
            name: 'main',
            stage: 'compute',
            workgroupSize: [8, 4, 1],
            bindings: [{ name: 'a', writes: false }],
          },
        ],
        console: {},
      },
    );
    expect(deriveLimits([pack], false).maxBindingsPerBindGroup).toBe(7);
  });
});
