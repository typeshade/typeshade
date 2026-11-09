// The page side of the RHI conformance leg (`rhi-conformance-arm.ts`, change 0120, M2): the suite of
// `src/rhi/rhi-conformance.ts` run on the WebGPU backend over a `GPUDevice` and on the WebGL2
// backend over a context of its own, bundled for the browser. Then the instrument: the suite again
// on a WebGL2 device whose reads come back one higher in their last byte, and whose validation scope
// reports an error, so that every case's comparison is seen to fail.

import { runConformance, type CaseResult } from '../src/rhi/rhi-conformance.js';
import type { RhiDevice } from '../src/rhi/rhi.js';
import { webgl2Device } from '../src/rhi/webgl2.js';
import { webgpuDevice } from '../src/rhi/webgpu.js';

export interface RhiConformanceReport {
  readonly adapter: string;
  readonly webgpu: readonly CaseResult[];
  readonly webgl2: readonly CaseResult[];
  /** The suite on a WebGL2 device whose reads are perturbed: every case must differ. */
  readonly perturbed: readonly CaseResult[];
}

/** `device` with every read one higher in its last byte, and a validation scope that fails. */
function perturbed(device: RhiDevice): RhiDevice {
  const bump = (bytes: Uint8Array): Uint8Array => {
    const out = bytes.slice();
    if (out.length > 0) out[out.length - 1] = (out[out.length - 1]! + 1) & 0xff;
    return out;
  };
  return new Proxy(device, {
    get(target, key) {
      if (key === 'readTexture')
        return async (t: never, n: number) => bump(await target.readTexture(t, n));
      if (key === 'readBuffer')
        return async (b: never) => bump(new Uint8Array(await target.readBuffer(b))).buffer;
      if (key === 'popValidationScope')
        return async () => (await target.popValidationScope()) ?? 'perturbed';
      const v = Reflect.get(target, key, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/** A WebGL2 context on a canvas of its own. */
function glContext(): WebGL2RenderingContext {
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2');
  if (gl === null) throw new Error('WebGL2 is not reachable in this browser');
  return gl;
}

async function run(): Promise<RhiConformanceReport> {
  const gpu = (
    navigator as {
      gpu?: {
        requestAdapter(): Promise<{
          requestDevice(): Promise<object>;
          info?: { description?: string };
        } | null>;
      };
    }
  ).gpu;
  if (gpu === undefined) throw new Error('navigator.gpu is absent: WebGPU is not reachable');
  const adapter = await gpu.requestAdapter();
  if (adapter === null) throw new Error('requestAdapter() returned null: no WebGPU adapter');
  const device = await adapter.requestDevice();
  const webgpu = await runConformance(webgpuDevice(device));
  (device as { destroy?(): void }).destroy?.();
  const webgl2 = await runConformance(webgl2Device(glContext()));
  const instrument = await runConformance(perturbed(webgl2Device(glContext())));
  return {
    adapter: adapter.info?.description ?? 'unknown',
    webgpu,
    webgl2,
    perturbed: instrument,
  };
}

(globalThis as Record<string, unknown>)['__runRhiConformance'] = run;
