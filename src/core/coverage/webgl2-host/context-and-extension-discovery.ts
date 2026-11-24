import { andGap, na, raw, type Row, typed } from '../model.js';

export const CONTEXT_AND_EXTENSION_DISCOVERY_ROWS: readonly Row[] = [
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Context creation and attributes: alpha, depth, stencil, antialias, premultipliedAlpha, powerPreference, failIfMajorPerformanceCaveat, desynchronized, getContextAttributes',
    covers: [
      'webgl:WebGLContextAttributes.alpha',
      'webgl:WebGLContextAttributes.antialias',
      'webgl:WebGLContextAttributes.depth',
      'webgl:WebGLContextAttributes.desynchronized',
      'webgl:WebGLContextAttributes.failIfMajorPerformanceCaveat',
      'webgl:WebGLContextAttributes.powerPreference',
      'webgl:WebGLContextAttributes.premultipliedAlpha',
      'webgl:WebGLContextAttributes.stencil',
      'webgl:WebGLRenderingContextBase.getContextAttributes',
    ],
    evidence:
      'src/runtime/runtime.ts:51-58; src/core/gl-context.ts:18; src/core/host-draw.ts:319-325',
    note: "the runtime makes a plain context, or takes the host's context through createRuntime({ device }); the call layer makes an opaque, non-antialiased one",
    webgpu: andGap(
      raw(
        'createRuntime({ device })',
        'GPUCanvasConfiguration: the host configures its canvas context with its own device; also: typed (opaque, Rule 8.24)',
      ),
      8,
      'the adapter options (GPUPowerPreference) have no typed form; the host requests its own adapter',
      639,
    ),
    webgl2: andGap(
      raw('createRuntime({ device })', 'the host makes its own context and passes it in'),
      8,
      'the context attributes have no typed form; the runtime makes its own context with the browser defaults (src/core/gl-context.ts:18)',
      639,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`preserveDrawingBuffer`',
    covers: ['webgl:WebGLContextAttributes.preserveDrawingBuffer'],
    evidence:
      'src/rhi/webgl2.ts (the pass draws into a texture and turns it over onto the screen); docs/use-typeshade-surface.md:7961-7962 (load starts from what the screen shows)',
    note: 'WebGPU has no equivalent: the canvas texture is new each frame',
    webgpu: na('no WebGPU form: the canvas texture is new each frame'),
    webgl2: andGap(
      raw(
        'createRuntime({ device })',
        "the host's own context is the raw route; also: typed in effect (load: 'load' starts from what the screen shows, surface §69)",
      ),
      11,
      'no typed form; WebGL2-only attribute; no door yet (Rule 11.16)',
      642,
    ),
    webgl2Only: { door: 'none' },
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Context loss: `isContextLost`, `WEBGL_lose_context`',
    covers: [
      'webgl:WebGLRenderingContextBase.isContextLost',
      'webgl:WEBGL_lose_context.loseContext',
      'webgl:WEBGL_lose_context.restoreContext',
    ],
    evidence: 'src/rhi/webgl2.ts:1601-1605 (destroy loses the context the runtime made)',
    note: 'rt.destroy() loses the context it made; no typed loss handling on either tier',
    webgpu: andGap(
      raw('Runtime.device', 'GPUDevice.lost, reached through the device'),
      8,
      'typed loss handling: no typed form for a lost device',
      639,
    ),
    webgl2: andGap(
      raw('Runtime.device', 'the host loses or restores its context through rt.device'),
      8,
      'typed loss handling: no typed form for a lost or restored context',
      639,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Extension discovery `getSupportedExtensions`/`getExtension`',
    covers: [
      'webgl:WebGLRenderingContextBase.getExtension',
      'webgl:WebGLRenderingContextBase.getSupportedExtensions',
    ],
    evidence: 'src/rhi/webgl2.ts:256-261 (turns on three extensions)',
    note: "the runtime turns on EXT_color_buffer_float, EXT_color_buffer_half_float and OES_texture_float_linear; every other extension is the host's",
    webgpu: typed(
      'src/compiler/ts/builtin-values.test.ts',
      'reflect().requiredFeatures, Rule 10.2',
    ),
    webgl2: andGap(
      raw('Runtime.device', 'also: typed for EXT_color_buffer_float'),
      8,
      'every extension except EXT_color_buffer_float has no typed spelling; each has its own row of this table',
      639,
    ),
  },
];
