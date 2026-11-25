import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostFace } from '../compiler/ts/host-face.js';
import { array } from '../runtime.js';
import { fuse } from '../fuse.js';
import { configure } from './resident.js';

const RUNTIME = resolve(__dirname, 'host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  configure({ runtime: null });
  configure({});
});

type Call = (...a: unknown[]) => Promise<unknown>;

async function load(source: string, file: string): Promise<Record<string, Call>> {
  const generated = hostFace(source, {
    fileName: `/app/${file}.shade.ts`,
    runtime: RUNTIME,
    fuse: true,
  });
  expect(generated.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-fuse-settle-'));
  dirs.push(dir);
  const path = join(dir, `${file}.shade.mjs`);
  writeFileSync(path, generated.code!);
  return (await import(/* @vite-ignore */ pathToFileURL(path).href)) as never;
}

function recordingDevice() {
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
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBuffer: (d: { size: number }) => buffer(d.size),
    createBindGroup: () => ({}),
    createCommandEncoder: () => encoder,
    pushErrorScope: () => undefined,
    popErrorScope: async () => null,
    queue: { writeBuffer: () => undefined, submit: () => undefined },
    lost: new Promise<never>(() => undefined),
  };
  configure({ runtime: { device } as never });
}

const scaleSource = (name: string, scale: number): string =>
  `"use typeshade";\nconst SCALE: f32 = ${scale}.;\nexport function ${name}(out: array<f32>, x: array<f32>): void {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = x[i] * SCALE;\n  }\n}\n`;

const OPS = `"use typeshade";
export function fill(out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = 1.;
  }
}
export function relu(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = max(x[i], 0.);
  }
}
`;

describe('a group whose fused entry cannot be built', () => {
  it('keeps its own reason on its first call and words the others by the failed entry', async () => {
    recordingDevice();
    const [ops, left, right] = await Promise.all([
      load(OPS, 'ops'),
      load(scaleSource('scaled', 2), 'left'),
      load(scaleSource('scaledAgain', 3), 'right'),
    ]);
    const [t, out, x] = [
      array(new Float32Array(4)),
      array(new Float32Array(4)),
      array(Float32Array.of(1, 2, 3, 4)),
    ];
    const report = await fuse(() => {
      void ops.fill!(t);
      void left.scaled!(t, x);
      void right.scaledAgain!(out, t);
    });
    expect(report.groups.map((g) => [g.calls, g.why])).toEqual([
      [['fill'], undefined],
      [
        ['scaled'],
        'fill and scaled run as two dispatches because scaled writes an array fill also writes',
      ],
      [
        ['scaledAgain'],
        'scaled and scaledAgain run as two dispatches because the fused entry could not be built: const "SCALE" is declared differently in /app/left.shade.ts and in /app/right.shade.ts',
      ],
    ]);
  });
});

describe('a call that no tier it may use can run', () => {
  it('fails with the reason of each tier it may use', async () => {
    configure({ prefer: ['webgpu', 'webgl2'] });
    const ops = await load(OPS, 'ops');
    const [t, out] = [array(new Float32Array(2)), array(new Float32Array(2))];
    await expect(
      fuse(() => {
        void ops.fill!(t);
        void ops.relu!(out, t);
      }),
    ).rejects.toThrow(
      'fill(): no tier it may use can run it (webgpu: there is no WebGPU device; webgl2: there is no WebGL2 context).',
    );
  });
});
