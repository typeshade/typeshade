import { describe, it, expect } from 'vitest';
import type { GpuDeviceLike } from '../../compute.js';

describe('GpuDeviceLike', () => {
  it('accepts a real GPUDevice without a cast', () => {
    const real = null as unknown as GPUDevice;
    const like: GpuDeviceLike = real;
    expect(like).toBeNull();
  });
});
