import { andGap, gap, na, raw, type Row } from '../model.js';

export const DEVICE_LOSS_AND_ERRORS_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUDevice.lost`',
    covers: ['GPUDevice.lost'],
    evidence:
      'src/runtime/runtime.ts#SubmitResult|Runtime.info; src/core/host-entry.ts:703-706; src/rhi/webgl2.ts#GlDevice.destroy',
    webgpu: andGap(
      raw(
        'Runtime.device',
        'rt.device.lost is a property of the GPUDevice that Runtime.device gives. The call layer reads it only to drop a lost device, so the next call requests another (src/core/host-entry.ts:703-706)',
      ),
      8,
      'no typed surface reports the loss to the host',
      639,
    ),
    webgl2: andGap(
      raw(
        'Runtime.device',
        'isContextLost is a member of the context Runtime.device is; the runtime loses the context it made with WEBGL_lose_context (src/rhi/webgl2.ts:1601-1605)',
      ),
      8,
      'no typed surface reports the loss to the host',
      639,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUDevice.pushErrorScope()`',
    covers: ['GPUDevice.pushErrorScope'],
    evidence: 'src/runtime/runtime.ts#RuntimeImpl.submit',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test makes a frame fail validation; Frame.submit() pushes the scope; the out-of-memory and internal filters have no typed spelling; the runtime pushes only a validation scope (src/runtime/runtime.ts:453)',
      645,
    ),
    webgl2: na('WebGPU error scopes; WebGL2 has no error scope'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUDevice.popErrorScope()`',
    covers: ['GPUDevice.popErrorScope'],
    evidence: 'src/runtime/runtime.ts:508; src/rhi/webgpu.ts:442-445',
    webgpu: gap(
      15,
      "typed in code; no test reads it on this target (Rule 11.18): no test provokes an invalid frame, so 'The frame did not validate' is raised in no test; Frame.submit() reads the scope; the out-of-memory and internal filters have no typed spelling; the runtime pushes only a validation scope (src/runtime/runtime.ts:453)",
      645,
    ),
    webgl2: na('WebGPU error scopes; WebGL2 has no error scope'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUDevice.onuncapturederror`',
    covers: ['GPUDevice.onuncapturederror'],
    evidence: 'src/runtime/runtime.ts#SubmitResult|Runtime.info',
    webgpu: andGap(
      raw('Runtime.device', 'rt.device'),
      8,
      'no typed surface reports an uncaptured error',
      639,
    ),
    webgl2: na('a WebGPU device event; the WebGL2 tier has no uncapturederror event'),
  },
];
