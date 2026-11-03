// The program runtime on the render hardware interface (change 0120, M1): its WebGPU tier reaches
// the device, the queue, the encoders and the buffers only through `src/rhi/`, so its code names
// none of the members only a native object has. What it records through the RHI is held by
// `runtime.test.ts` and `render-state-parity.test.ts`, which see the native calls the WebGPU
// backend makes, and by `src/rhi/webgpu.test.ts`, which holds each RHI call to its native call.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The members only a native `GPUDevice`, its queue, an encoder or a buffer has. */
const NATIVE = [
  'queue',
  'createRenderPipelineAsync',
  'createComputePipelineAsync',
  'createPipelineLayout',
  'mapAsync',
  'getMappedRange',
  'unmap',
  'getCurrentTexture',
  'pushErrorScope',
  'popErrorScope',
  'onSubmittedWorkDone',
  'copyTextureToBuffer',
  'finish',
];

/** The source of `file` without its comments, which may name a native member. */
const code = (file: string): string =>
  readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

/** The members of `NATIVE` that `source` calls or reads. */
const named = (source: string): string[] =>
  NATIVE.filter((name) => new RegExp(`\\.${name}\\b`).test(source));

describe('the program runtime on the RHI', () => {
  for (const file of ['runtime.ts', 'program.ts', 'resources.ts'])
    it(`src/runtime/${file} names no native WebGPU member`, () => {
      const source = code(`./${file}`);
      expect(source).toContain('rhi');
      expect(named(source)).toEqual([]);
    });

  it('finds a native member where the code names one', () => {
    // The instrument's known positive: the backend names them, the runtime does not.
    expect(named(code('../rhi/webgpu.ts'))).toEqual(NATIVE);
  });
});
