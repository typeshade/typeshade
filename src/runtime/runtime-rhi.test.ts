// The program runtime on the render hardware interface (change 0120, M1 and M2): its WebGPU tier
// reaches the device, the queue, the encoders and the buffers only through `src/rhi/`, and its
// WebGL2 tier reaches the context only through `src/rhi/webgl2.ts`, so their code names none of the
// members only a native object has. What each records through the RHI is held by `runtime.test.ts`,
// `render-state-parity.test.ts`, `gl-draw.test.ts` and `gl-names.test.ts`, which see the native
// calls the backends make, and by `src/rhi/webgpu.test.ts`, which holds each RHI call to its native
// call. The WebGL2 tier's dispatch still runs through the call layer's executor
// (`core/gl-compute.ts`), which change 0120's milestone M4 moves.

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

/** The members only a native `WebGL2RenderingContext` or one of its extensions has. */
const NATIVE_GL = [
  'getExtension',
  'getParameter',
  'loseContext',
  'createFramebuffer',
  'bindFramebuffer',
  'framebufferTexture2D',
  'blitFramebuffer',
  'drawBuffers',
  'texStorage2D',
  'texSubImage2D',
  'deleteTexture',
  'samplerParameteri',
  'bindSampler',
  'bufferData',
  'bindBufferBase',
  'uniformBlockBinding',
  'getUniformBlockIndex',
  'getUniformLocation',
  'uniform1i',
  'useProgram',
  'createVertexArray',
  'bindVertexArray',
  'vertexAttribPointer',
  'drawArraysInstanced',
  'drawElementsInstanced',
  'clearBufferfv',
  'readPixels',
  'stencilFuncSeparate',
  'polygonOffset',
  'blendColor',
  'depthRange',
];

/** The source of `file` without its comments, which may name a native member. */
const code = (file: string): string =>
  readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

/** The members of `among` that `source` calls or reads. */
const named = (source: string, among: readonly string[] = NATIVE): string[] =>
  among.filter((name) => new RegExp(`\\.${name}\\b`).test(source));

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

  for (const file of ['gl.ts', 'gl-draw.ts'])
    it(`src/runtime/${file} names no native WebGL2 member`, () => {
      const source = code(`./${file}`);
      expect(source).toContain('rhi');
      expect(named(source, NATIVE_GL)).toEqual([]);
    });

  it('finds a native WebGL2 member where the code names one', () => {
    // The instrument's known positive: the WebGL2 backend names every one of them.
    expect(named(code('../rhi/webgl2.ts'), NATIVE_GL)).toEqual(NATIVE_GL);
  });
});
