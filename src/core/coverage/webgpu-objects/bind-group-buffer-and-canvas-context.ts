import { gap, na, raw, type Row, typed } from '../model.js';

export const BIND_GROUP_BUFFER_AND_CANVAS_CONTEXT_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPUBindGroup`',
    covers: ['GPUBindGroup'],
    evidence: 'src/runtime/runtime.ts:349-363',
    webgpu: typed('src/runtime/runtime.test.ts', 'cached by identity'),
    webgl2: na('WebGPU-only concept: WebGL2 has no bind group object'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface',
    name: '`GPUBindGroupLayout`',
    covers: ['GPUBindGroupLayout'],
    evidence: 'src/runtime/program.ts:1541-1544',
    webgpu: typed('src/runtime/runtime.test.ts', 'from the manifest'),
    webgl2: na('WebGPU-only concept: WebGL2 has no bind group layout object'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBuffer.size`',
    covers: ['GPUBuffer.size'],
    evidence: 'src/core/resident.ts#residentBrand|ElementView',
    webgpu: raw(
      'GPUBuffer',
      'the host reads the size of its own GPUBuffer; the typed Buffer returns no size',
    ),
    webgl2: na(
      'a WebGLBuffer has no size or usage member; the runtime sizes its buffers from the host value',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBuffer.usage`',
    covers: ['GPUBuffer.usage'],
    evidence: 'src/core/resident.ts#residentBrand|ElementView',
    webgpu: raw(
      'GPUBuffer',
      'the host reads the usage of its own GPUBuffer; the typed Buffer returns no usage',
    ),
    webgl2: na(
      'a WebGLBuffer has no size or usage member; the runtime sizes its buffers from the host value',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBuffer.mapState`',
    covers: ['GPUBuffer.mapState'],
    evidence: 'src/core/resident.ts:85; src/core/resident.ts:228-237',
    webgpu: raw(
      'GPUBuffer',
      'the host reads the map state of its own GPUBuffer; the typed Buffer reports freshness (src/core/resident.ts:85), not map state',
    ),
    webgl2: na(
      'WebGPU-only concept: WebGL2 has no GPUBuffer mapping state; a Buffer is read from its host copy (src/core/resident.ts:228-237)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBuffer.mapAsync()`',
    covers: ['GPUBuffer.mapAsync'],
    evidence:
      'src/core/resident.ts:61; src/core/resident.ts:228-237; src/rhi/webgl2.ts:762; src/core/host-entry.ts:654-661',
    webgpu: typed('src/runtime/runtime.test.ts', 'Buffer.read() and Texture.read()'),
    webgl2: typed('scripts/compile-gate.ts', 'Buffer.read() and Texture.read()'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBuffer.getMappedRange()`',
    covers: ['GPUBuffer.getMappedRange'],
    evidence:
      'src/core/resident.ts:61; src/core/resident.ts:228-237; src/rhi/webgl2.ts:762; src/core/host-entry.ts:654-661',
    webgpu: typed('src/runtime/runtime.test.ts', 'Buffer.read() and Texture.read()'),
    webgl2: typed('scripts/compile-gate.ts', 'Buffer.read() and Texture.read()'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBuffer.unmap()`',
    covers: ['GPUBuffer.unmap'],
    evidence:
      'src/core/resident.ts:61; src/core/resident.ts:228-237; src/rhi/webgl2.ts:762; src/core/host-entry.ts:654-661',
    webgpu: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test observes the unmap; the typed surface is Buffer.read() and Texture.read()',
      645,
    ),
    webgl2: na('WebGL2 has no buffer mapping to end'),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUBuffer.destroy()`',
    covers: ['GPUBuffer.destroy'],
    evidence:
      'src/core/resident.ts:71; src/core/resident.ts:249-257; src/runtime/gl-draw.ts:752-753',
    webgpu: typed('journeys/mnist/test-webgpu.mjs', 'Buffer.dispose()'),
    webgl2: gap(
      15,
      'typed in code; no test reads it on this target (Rule 11.18): no test reads the disposed-Buffer guard of the WebGL2 tier; the typed surface is Buffer.dispose()',
      645,
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCanvasContext.canvas`',
    covers: ['GPUCanvasContext.canvas'],
    evidence:
      'src/runtime/runtime.ts#RuntimeOptions; src/runtime/runtime.ts:105-170; src/runtime/runtime.ts:526-530; src/rhi/webgpu.ts:346-348',
    webgpu: raw(
      'createRuntime({ device })',
      'the host holds the canvas of its own context; PassTargets.color reads only getCurrentTexture (src/runtime/runtime.ts:530)',
    ),
    webgl2: na(
      'WebGPU-only concept: WebGL2 has no GPUCanvasContext; a WebGL2 context is made with its attributes (WebGLContextAttributes)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCanvasContext.configure()`',
    covers: ['GPUCanvasContext.configure'],
    evidence:
      'src/runtime/runtime.ts#RuntimeOptions; src/runtime/runtime.ts:105-170; src/core/host-draw.ts:728-731',
    webgpu: raw(
      'createRuntime({ device })',
      'the call layer configures a context it makes, with the preferred format and an opaque alpha mode (src/core/host-draw.ts:728-731); the host configures its own context with the device it passes in',
    ),
    webgl2: na(
      'WebGPU-only concept: WebGL2 has no GPUCanvasContext; a WebGL2 context is made with its attributes (WebGLContextAttributes)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCanvasContext.unconfigure()`',
    covers: ['GPUCanvasContext.unconfigure'],
    evidence:
      'src/runtime/runtime.ts#RuntimeOptions; src/runtime/runtime.ts:105-170; src/core/host-draw.ts:731',
    webgpu: raw(
      'createRuntime({ device })',
      'the host unconfigures its own context; the call layer never does (src/core/host-draw.ts:731)',
    ),
    webgl2: na(
      'WebGPU-only concept: WebGL2 has no GPUCanvasContext; a WebGL2 context is made with its attributes (WebGLContextAttributes)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCanvasContext.getConfiguration()`',
    covers: ['GPUCanvasContext.getConfiguration'],
    evidence:
      'src/runtime/runtime.ts#RuntimeOptions; src/runtime/runtime.ts:105-170; src/core/host-draw.ts:731',
    webgpu: raw(
      'createRuntime({ device })',
      'the host reads the configuration of its own context; the call layer never does (src/core/host-draw.ts:731)',
    ),
    webgl2: na(
      'WebGPU-only concept: WebGL2 has no GPUCanvasContext; a WebGL2 context is made with its attributes (WebGLContextAttributes)',
    ),
  },
  {
    table: 'A',
    kind: 'WebGPU interface member',
    name: '`GPUCanvasContext.getCurrentTexture()`',
    covers: ['GPUCanvasContext.getCurrentTexture'],
    evidence:
      'src/runtime/runtime.ts#RuntimeOptions; src/runtime/runtime.ts:105-170; src/runtime/runtime.ts#FrameImpl.submit; src/rhi/webgpu.ts:346-348',
    webgpu: raw(
      'createRuntime({ device })',
      'a context the host configured, as a PassTargets.color entry (src/runtime/runtime.ts:530)',
    ),
    webgl2: na(
      'WebGPU-only concept: WebGL2 has no GPUCanvasContext; a WebGL2 context is made with its attributes (WebGLContextAttributes)',
    ),
  },
];
