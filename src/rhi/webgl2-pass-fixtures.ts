import type { RhiColorAttachment, RhiDepthStencilAttachment, RhiDevice } from './rhi.js';
import { webgl2Device } from './webgl2.js';
import { fakeGl, renderPass, type FakeGlOptions } from './webgl2-fake-gl.js';

export const FULL = 4294967295;

export function setup(options?: FakeGlOptions) {
  const fake = fakeGl(options);
  return { ...fake, device: webgl2Device(fake.gl) };
}

export const colour = (
  device: RhiDevice,
  format = 'rgba8unorm',
  over: Partial<RhiColorAttachment> = {},
): RhiColorAttachment => ({
  view: device.createView(device.createTexture({ size: [6, 4, 1], format, usage: ['render'] })),
  loadOp: 'load',
  storeOp: 'store',
  clearValue: [0, 0, 0, 0],
  ...over,
});

export const depth = (
  device: RhiDevice,
  over: Partial<RhiDepthStencilAttachment> = {},
  format = 'depth24plus-stencil8',
): RhiDepthStencilAttachment => ({
  view: device.createView(device.createTexture({ size: [6, 4, 1], format, usage: ['render'] })),
  ...over,
});

export interface Recorded {
  readonly begin: string[];
  readonly end: string[];
  readonly all: string[];
}

export function recorded(
  fake: ReturnType<typeof setup>,
  desc: Parameters<typeof renderPass>[1],
  during: (pass: Parameters<Parameters<typeof renderPass>[2] & object>[0]) => void = () =>
    undefined,
): Recorded {
  const { device, calls } = fake;
  const d = desc(device);
  const start = calls.length;
  const p = device.createCommandEncoder().beginRenderPass(d);
  const begun = calls.length;
  during(p);
  const ending = calls.length;
  p.end();
  return {
    begin: calls.slice(start, begun),
    end: calls.slice(ending),
    all: calls.slice(start),
  };
}

export const at = (calls: readonly string[], prefix: string): number =>
  calls.findIndex((c) => c.startsWith(prefix));
