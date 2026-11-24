import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const ERRORS_AND_PIPELINE_LAYOUT_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUDeviceLostInfo.reason`',
    covers: ['GPUDeviceLostInfo.reason'],
    evidence:
      'src/runtime/runtime.ts:230-238; src/core/host-entry.ts:704; src/runtime/runtime.ts:769',
    webgpu: andGap(
      raw(
        'Runtime.device',
        'the host reads the loss record through rt.device.lost; the call layer ignores its value (src/core/host-entry.ts:704)',
      ),
      8,
      'no typed surface reports the loss reason to the host; the call layer requests a new device once one is lost (src/runtime/runtime.ts:769)',
      639,
    ),
    webgl2: na(
      'the WebGPU device-loss record; WebGL2 reports loss on its context (see GPUDevice.lost)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUDeviceLostInfo.message`',
    covers: ['GPUDeviceLostInfo.message'],
    evidence: 'src/runtime/runtime.ts:230-238; src/core/host-entry.ts:704',
    webgpu: andGap(
      raw(
        'Runtime.device',
        'the host reads the loss record through rt.device.lost; the call layer ignores its value (src/core/host-entry.ts:704)',
      ),
      8,
      'no typed surface reports the loss record to the host',
      639,
    ),
    webgl2: na(
      'the WebGPU device-loss record; WebGL2 reports loss on its context (see GPUDevice.lost)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUError.message`',
    covers: ['GPUError.message'],
    evidence: 'src/runtime/runtime.ts:500-511; src/rhi/webgpu.ts:442-445',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): the message is read only in the error branch of Frame.submit(), which no test reaches; Frame.submit() rejects with the validation error of the frame',
      645,
    ),
    webgl2: na('the WebGPU error object; WebGL2 has no error scope'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPUExternalTexture`',
    covers: ['GPUExternalTexture'],
    evidence: 'docs/language-design.md:1539',
    webgpu: gap(
      12,
      'refused today with no rule number: texture_external is not spelled on this tree (Appendix A); roadmap 13c names it (docs/roadmap.md:229)',
      162,
    ),
    webgl2: na('WebGPU external texture; WebGL2 has no external texture object'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPUInternalError`',
    covers: ['GPUInternalError'],
    evidence: 'src/runtime/runtime.ts:453',
    webgpu: andGap(
      raw(
        'Runtime.device',
        'the host reads this scope through rt.device.popErrorScope(); the runtime reads only the validation scope (src/runtime/runtime.ts:453)',
      ),
      8,
      'no typed surface reports this error to the host',
      639,
    ),
    webgl2: na('the WebGPU internal error; WebGL2 has no error scope'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPUOutOfMemoryError`',
    covers: ['GPUOutOfMemoryError'],
    evidence: 'src/runtime/runtime.ts:453',
    webgpu: andGap(
      raw(
        'Runtime.device',
        'the host reads this scope through rt.device.popErrorScope(); the runtime reads only the validation scope (src/runtime/runtime.ts:453)',
      ),
      8,
      'no typed surface reports this error to the host',
      639,
    ),
    webgl2: na('the WebGPU out-of-memory error; WebGL2 has no error scope'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUPipelineError.reason`',
    covers: ['GPUPipelineError.reason'],
    evidence: 'src/runtime/program.ts:1579-1586; src/runtime/program.ts:1675-1682',
    webgpu: gap(
      8,
      'the runtime rethrows an Error that holds only the message, so the reason is not passed on (src/runtime/program.ts:1579-1586, 1675-1682)',
      639,
    ),
    webgl2: na('the WebGPU pipeline error; WebGL2 reports a failed program through its info log'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPUPipelineLayout`',
    covers: ['GPUPipelineLayout'],
    evidence: 'src/runtime/program.ts:1550',
    webgpu: typed('journeys/textures/journey.mjs', 'from the manifest'),
    webgl2: na('WebGPU-only concept: WebGL2 has no pipeline layout object'),
  },
];
