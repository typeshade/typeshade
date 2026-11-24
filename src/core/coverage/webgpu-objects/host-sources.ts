import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const HOST_SOURCES_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`HTMLCanvasElement.getContext()`',
    covers: ['HTMLCanvasElement.getContext'],
    evidence: 'src/runtime/runtime.ts#RuntimeOptions; src/core/host-draw.ts:315-331',
    webgpu: typed(
      'scripts/compile-gate.ts',
      'the call layer calls getContext("webgpu") on a canvas a host call passes (src/core/host-draw.ts:315-316; Rule 8.24)',
    ),
    webgl2: typed(
      'scripts/user-journey.ts',
      'the call layer calls getContext("webgl2") on a canvas a host call passes (src/core/host-draw.ts:319; Rule 8.24)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`OffscreenCanvas.getContext()`',
    covers: ['OffscreenCanvas.getContext'],
    evidence:
      'src/runtime/runtime.ts#RuntimeOptions; docs/language-design.md:905; src/core/host-draw.ts#hostResidents; src/core/host-draw.ts:315-331',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test draws into an OffscreenCanvas on WebGPU; the call layer takes an OffscreenCanvas as a draw target and calls getContext("webgpu") on it (src/core/host-draw.ts:184, 315-316; Rule 8.24)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the tests that ask an OffscreenCanvas stand-in for a WebGL2 context get none back (`src/compiler/ts/host-draw.test.ts`, `src/fuse.test.ts:2028`, `examples/host-examples.test.ts:72`), so the WebGL2 painter is never entered; the call layer calls getContext("webgl2") on an OffscreenCanvas draw target (src/core/host-draw.ts:184, 319)',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`HTMLVideoElement`',
    covers: ['HTMLVideoElement'],
    evidence:
      'docs/language-design.md:857; changes/0050-texture-write.md:331; src/core/gl-image.ts:54-74',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test uploads a video; an image source of a call-layer texture (Rule 8.21)',
      645,
    ),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test uploads a video through uploadImage; the WebGL2 call layer uploads an image source at each call (src/core/gl-image.ts:54-74); the WebGL2 draw refuses a Texture, not an image',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`__GPUDeviceEventMap.uncapturederror`',
    covers: ['__GPUDeviceEventMap.uncapturederror'],
    evidence: 'src/runtime/runtime.ts#SubmitResult|Runtime.info',
    webgpu: andGap(
      raw('Runtime.device', 'rt.device is the GPUDevice; the runtime listens to no event'),
      8,
      'no typed surface reports an uncaptured error',
      639,
    ),
    webgl2: na('a WebGPU device event; the WebGL2 tier has no uncapturederror event'),
  },
];
