import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from '../compiler/ts/host-face.js';
import { array } from '../runtime.js';
import { fuse } from '../fuse.js';
import { configure } from './resident.js';
import { DispatchBatch } from './host-entry.js';

const RUNTIME = resolve(__dirname, 'host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  configure({ runtime: null });
  vi.restoreAllMocks();
});

const SOURCE = `"use typeshade";
export function bump(xs: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] + 1.;
  }
}
export function relu(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = max(x[i], 0.);
  }
}
`;

async function load(): Promise<Record<'bump' | 'relu', (...a: unknown[]) => Promise<unknown>>> {
  const generated = hostFace(SOURCE, {
    fileName: '/app/ops.shade.ts',
    runtime: RUNTIME,
    fuse: false,
  });
  expect(generated.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-fuse-plan-'));
  dirs.push(dir);
  const file = join(dir, 'ops.shade.mjs');
  writeFileSync(file, generated.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as never;
}

function deviceThatRefusesShadersWith(word: string) {
  let submits = 0;
  const buffer = (size: number) => ({
    mapAsync: async () => undefined,
    getMappedRange: () => new ArrayBuffer(size),
    unmap: () => undefined,
    destroy: () => undefined,
  });
  const pass = {
    setPipeline: () => undefined,
    setBindGroup: () => undefined,
    dispatchWorkgroups: () => undefined,
    end: () => undefined,
  };
  const encoder = {
    beginComputePass: () => pass,
    copyBufferToBuffer: () => undefined,
    finish: () => ({}),
  };
  const device = {
    createShaderModule: (d: { code: string }) => ({
      getCompilationInfo: async () => ({
        messages: d.code.includes(word)
          ? [{ type: 'error', message: 'refused', lineNum: 1, linePos: 1 }]
          : [],
      }),
    }),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBuffer: (d: { size: number }) => buffer(d.size),
    createBindGroup: () => ({}),
    createCommandEncoder: () => encoder,
    pushErrorScope: () => undefined,
    popErrorScope: async () => null,
    queue: {
      writeBuffer: () => undefined,
      submit: () => {
        submits++;
      },
    },
    lost: new Promise<never>(() => undefined),
  };
  configure({ runtime: { device } as never });
  return { submits: () => submits, device };
}

it('discards the batch of a plan that fails before its dispatches are submitted', async () => {
  const gpu = deviceThatRefusesShadersWith('max(');
  const discard = vi.spyOn(DispatchBatch.prototype, 'discard');
  const flush = vi.spyOn(DispatchBatch.prototype, 'flush');
  const m = await load();
  const [x, y] = [array(Float32Array.of(1, 2)), array(new Float32Array(2))];
  await expect(
    fuse(() => {
      void m.bump(x);
      void m.relu(y, x);
    }),
  ).rejects.toThrow('refused');
  expect(discard).toHaveBeenCalledTimes(1);
  expect(flush).not.toHaveBeenCalled();
  expect(gpu.submits()).toBe(0);
});

function runtimeCountingDeviceReads() {
  const gpu = deviceThatRefusesShadersWith('never-present');
  const device = gpu.device;
  let reads = 0;
  configure({
    runtime: {
      get device() {
        reads++;
        return device;
      },
    } as never,
  });
  reads = 0;
  return { reads: () => reads, submits: gpu.submits };
}

async function runTwoCallsOn(tiers: readonly ('webgpu' | 'cpu')[]) {
  const reads = runtimeCountingDeviceReads();
  configure({ prefer: tiers });
  const m = await load();
  const [x, y] = [array(Float32Array.of(1, 2)), array(new Float32Array(2))];
  await fuse(() => {
    void m.bump(x);
    void m.relu(y, x);
  });
  return reads.reads();
}

it('reads no device for a plan whose tiers do not include webgpu', async () => {
  expect(await runTwoCallsOn(['cpu'])).toBe(0);
});

it('reads the device for a plan whose tiers include webgpu', async () => {
  expect(await runTwoCallsOn(['webgpu'])).toBeGreaterThan(0);
});
