// ═══ What a fuse scope of five kernel calls costs the host, per scope, on a recording device ═══
//
// A `fuse()` scope runs its kernel calls as dispatches of one batch: each scope takes the
// pipelines of its entries (built once), then makes the buffers, bind groups and command buffers
// of the dispatches it records, and submits them. This script times the host side of that work
// for a five-call chain over `Resident` arrays, and counts what the device was asked to make per
// scope: buffers by usage, bind groups and `writeBuffer` calls. It runs on a recording device
// (Node has no WebGPU), so it measures the CPU cost of the call layer, not a GPU.
//
//   bun scripts/bench-fuse-scope.ts [scopes] [repetitions]
//
// The scope is run once to warm the caches, then `scopes` times per repetition; the median of the
// repetitions is printed with the minimum and the maximum, and the counts are those of the last
// scope. The script is not a CI gate: a timing depends on the machine it runs on.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from '../src/compiler/ts/host-face.js';
import { fuse } from '../src/fuse.js';
import { configure, resident, type Resident } from '../src/core/resident.js';

const RUNTIME = new URL('../src/core/host-runtime.ts', import.meta.url).pathname;
const UNIFORM = 64;
const STORAGE = 128;

const OPS = `"use typeshade";
export function add(out: array<f32>, a: array<f32>, b: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] + b[i];
  }
}
export function mul(out: array<f32>, a: array<f32>, b: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] * b[i];
  }
}
export function relu(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = max(x[i], 0.);
  }
}
`;

/** What the recording device was asked to make and to write, since the last reset. */
interface Counts {
  uniformBuffers: number;
  storageBuffers: number;
  otherBuffers: number;
  bindGroups: number;
  writes: number;
  dispatches: number;
  submissions: number;
}

const counts: Counts = {
  uniformBuffers: 0,
  storageBuffers: 0,
  otherBuffers: 0,
  bindGroups: 0,
  writes: 0,
  dispatches: 0,
  submissions: 0,
};

/** A device that makes buffers and bind groups and records what it was asked for. */
function recordingDevice() {
  const buffer = (size: number, usage: number) => {
    if ((usage & UNIFORM) !== 0) counts.uniformBuffers++;
    else if ((usage & STORAGE) !== 0) counts.storageBuffers++;
    else counts.otherBuffers++;
    return {
      mapAsync: async () => {},
      getMappedRange: () => new ArrayBuffer(size),
      unmap: () => {},
      destroy: () => {},
    };
  };
  const pass = {
    setPipeline: () => {},
    setBindGroup: () => {},
    dispatchWorkgroups: () => counts.dispatches++,
    end: () => {},
  };
  const encoder = {
    beginComputePass: () => pass,
    copyBufferToBuffer: () => {},
    finish: () => ({}),
  };
  return {
    createShaderModule: () => ({
      getCompilationInfo: async () => ({ messages: [] }),
    }),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBuffer: (d: { size: number; usage: number }) => buffer(d.size, d.usage),
    createBindGroup: () => {
      counts.bindGroups++;
      return {};
    },
    createCommandEncoder: () => encoder,
    pushErrorScope: () => {},
    popErrorScope: async () => null,
    queue: {
      writeBuffer: () => counts.writes++,
      submit: () => counts.submissions++,
    },
    lost: new Promise<never>(() => {}),
  };
}

/** The five calls of the chain: add, mul, relu, add, mul, over six residents. */
async function scope(
  ops: Record<string, (...a: unknown[]) => unknown>,
  r: Resident<Float32Array>[],
) {
  const [t, u, out, a, b, c] = r as [
    Resident<Float32Array>,
    Resident<Float32Array>,
    Resident<Float32Array>,
    Resident<Float32Array>,
    Resident<Float32Array>,
    Resident<Float32Array>,
  ];
  return fuse(() => {
    void ops.add!(t, a, b);
    void ops.mul!(u, t, c);
    void ops.relu!(out, u);
    void ops.add!(t, out, a);
    void ops.mul!(u, t, c);
  });
}

const scopes = Number(process.argv[2] ?? 200);
const reps = Number(process.argv[3] ?? 7);

const generated = hostFace(OPS, { fileName: '/app/ops.shade.ts', runtime: RUNTIME, fuse: true });
const dir = mkdtempSync(join(tmpdir(), 'typeshade-bench-'));
try {
  const file = join(dir, 'ops.shade.mjs');
  writeFileSync(file, generated.code!);
  const ops = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<
    string,
    (...a: unknown[]) => unknown
  >;
  configure({ runtime: { device: recordingDevice() as unknown as object } });
  const n = 64;
  const arrays = (): Resident<Float32Array>[] =>
    Array.from({ length: 6 }, (_, i) => resident(new Float32Array(n).fill(i + 1)));
  const r = arrays();
  // Warm-up: pipelines, fused entries and the first uploads are made once.
  await scope(ops, r);
  const times: number[] = [];
  for (let rep = 0; rep < reps; rep++) {
    Object.keys(counts).forEach((k) => ((counts as unknown as Record<string, number>)[k] = 0));
    const t0 = performance.now();
    for (let s = 0; s < scopes; s++) await scope(ops, r);
    times.push((performance.now() - t0) / scopes);
  }
  // The counts of one scope after the caches are warm.
  Object.keys(counts).forEach((k) => ((counts as unknown as Record<string, number>)[k] = 0));
  await scope(ops, r);
  const sorted = [...times].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  console.log(
    `fuse scope of 5 calls over 6 residents, ${n} elements, ${scopes} scopes x ${reps} repetitions`,
  );
  console.log(
    `CPU per scope: median ${median.toFixed(3)} ms, min ${sorted[0]!.toFixed(3)} ms, max ${sorted[sorted.length - 1]!.toFixed(3)} ms`,
  );
  console.log(`per warm scope: ${JSON.stringify(counts)}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
