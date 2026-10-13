// The device's limits as the program runtime reports them (change 0051, part 2, Rule 11.11):
// `copyLimits` reads a `GPUSupportedLimits`-shaped object whose attributes sit on its prototype,
// as WebIDL makes them, and returns a frozen record keyed by WebGPU's names.

import { describe, expect, it } from 'vitest';
import { copyLimits } from './limits.js';

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
