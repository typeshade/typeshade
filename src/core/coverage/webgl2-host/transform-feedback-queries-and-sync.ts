import { andGap, gap, na, raw, type Row, typed } from '../model.js';

export const TRANSFORM_FEEDBACK_QUERIES_AND_SYNC_ROWS: readonly Row[] = [
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Transform feedback: `createTransformFeedback`, `bindTransformFeedback`, `transformFeedbackVaryings`, `beginTransformFeedback`, `endTransformFeedback`, `pauseTransformFeedback`, `resumeTransformFeedback`, `getTransformFeedbackVarying`, `deleteTransformFeedback`',
    covers: [
      'webgl:WebGL2RenderingContextBase.beginTransformFeedback',
      'webgl:WebGL2RenderingContextBase.bindTransformFeedback',
      'webgl:WebGL2RenderingContextBase.createTransformFeedback',
      'webgl:WebGL2RenderingContextBase.deleteTransformFeedback',
      'webgl:WebGL2RenderingContextBase.endTransformFeedback',
      'webgl:WebGL2RenderingContextBase.getTransformFeedbackVarying',
      'webgl:WebGL2RenderingContextBase.pauseTransformFeedback',
      'webgl:WebGL2RenderingContextBase.resumeTransformFeedback',
      'webgl:WebGL2RenderingContextBase.transformFeedbackVaryings',
    ],
    evidence:
      'changes/0054-webgl2-compute.md (a compute entry runs on WebGL2 as a pass program); src/core/gl-compute.ts:801',
    note: "WebGPU captures vertex output through a compute pass; TypeShade's compute entries run on both tiers",
    webgpu: na('no WebGPU form: vertex output is captured through a compute pass'),
    webgl2: na(
      'a compute entry is the portable form (Rule 11.8, change 0054): WebGL2-only mechanism',
    ),
    webgl2Only: { door: 'none' },
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Timer queries: `EXT_disjoint_timer_query_webgl2` (timestamps, `TIME_ELAPSED`)',
    covers: ['webgl:EXT_disjoint_timer_query_webgl2'],
    evidence:
      'src/rhi/webgl2.ts#GlRenderPass (the pass makes no query call); src/runtime/gl.ts#GlFrameImpl.record|GlFrameImpl.submit (the frame runs its draws after submit returns); src/core/resident.ts:267-278 (kernelQueue.run)',
    note: 'timestamps are not spellable on either tier; the query methods that a timer query also uses are in the occlusion row',
    webgpu: andGap(
      raw('Runtime.device', 'a host GPUQuerySet of type timestamp, made on the runtime device'),
      4,
      'timer queries (timestamps) have no typed form',
      542,
    ),
    webgl2: gap(
      4,
      'no typed timer query on WebGL2: the frame runs its draws after submit() returns, so a query begun and ended around the synchronous call wraps none',
      542,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Occlusion queries: `createQuery`, `beginQuery`, `endQuery`, `getQuery`, `getQueryParameter` (`ANY_SAMPLES_PASSED`), `deleteQuery`',
    covers: [
      'webgl:WebGL2RenderingContextBase.beginQuery',
      'webgl:WebGL2RenderingContextBase.createQuery',
      'webgl:WebGL2RenderingContextBase.deleteQuery',
      'webgl:WebGL2RenderingContextBase.endQuery',
      'webgl:WebGL2RenderingContextBase.getQuery',
      'webgl:WebGL2RenderingContextBase.getQueryParameter',
    ],
    evidence:
      'src/rhi/webgl2.ts#GlRenderPass (the pass makes no query call); src/runtime/gl.ts#GlFrameImpl.record|GlFrameImpl.submit (the frame runs its draws after submit returns); src/core/resident.ts:267-278 (kernelQueue.run)',
    note: 'no typed occlusion query on either tier; the same methods carry the timer queries of the row above; issue 542 tracks timestamps only',
    webgpu: andGap(
      raw(
        'RenderPipeline.draw(pass, …)',
        'the host begins and ends the query on its own pass, and RenderPipeline.draw(pass, …) records the draws into it',
      ),
      4,
      'no typed spelling begins or ends an occlusion query',
      635,
    ),
    webgl2: gap(
      4,
      'no typed query on WebGL2: the frame runs its draws after submit() returns, so a query begun and ended around the synchronous call wraps none',
      635,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Sync: `fenceSync`, `clientWaitSync`, `waitSync`, `deleteSync`, `getSyncParameter`, `flush`, `finish`',
    covers: [
      'webgl:WebGL2RenderingContextBase.clientWaitSync',
      'webgl:WebGL2RenderingContextBase.deleteSync',
      'webgl:WebGL2RenderingContextBase.fenceSync',
      'webgl:WebGL2RenderingContextBase.getSyncParameter',
      'webgl:WebGL2RenderingContextBase.waitSync',
      'webgl:WebGLRenderingContextBase.finish',
      'webgl:WebGLRenderingContextBase.flush',
    ],
    evidence:
      'src/core/gl-compute.ts:272-275 (fenceSync, clientWaitSync in gpuDone); src/runtime/gl.ts#GlFrameImpl.record|GlFrameImpl.submit (the frame runs its draws after submit returns); src/runtime/resources.ts',
    note: 'the promise of submit() and read() is the typed form; the runtime polls clientWaitSync and calls neither waitSync nor getSyncParameter',
    webgpu: typed('src/runtime/runtime.test.ts', 'onSubmittedWorkDone through submit()'),
    webgl2: typed('journeys/hdr-target/journey.mjs', 'through submit and read'),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`OVR_multiview2`',
    covers: ['webgl:OVR_multiview2.framebufferTextureMultiviewOVR'],
    evidence:
      'src/core/backends/glsl.ts:617 (the multiview row of the GLSL capability profile); docs/language-design.md:1121 (multiview is declarable, §10.1); docs/use-typeshade-surface.md:5916-5917 (multiview is still unspellable from a use typeshade source)',
    note: 'the `multiview` capability emits the directive and renders single-view; no spelling reaches the views',
    webgpu: na('WebGPU has no multiview'),
    webgl2: gap(
      11,
      'declarable through the §10 door (multiview), but it renders single-view: no gl_ViewID_OVR or num_views spelling (src/core/backends/capability-reachability.test.ts)',
      642,
    ),
    webgl2Only: { door: '§10', capability: 'multiview' },
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: 'Debug: `WEBGL_debug_renderer_info`, `getError`',
    covers: ['webgl:WEBGL_debug_renderer_info', 'webgl:WebGLRenderingContextBase.getError'],
    evidence: 'src/core/host-kernel-gl.ts:185 (getError)',
    note: 'the host reads them on rt.device',
    webgpu: andGap(
      raw('Runtime.device', 'GPUAdapterInfo (device.adapterInfo); also: typed (pushErrorScope)'),
      8,
      'no typed surface reports adapter info',
      639,
    ),
    webgl2: andGap(
      raw('Runtime.device', 'the host reads them on rt.device'),
      8,
      'no typed surface reports the renderer strings or the error state',
      639,
    ),
  },
  {
    table: 'D',
    kind: 'WebGL2 capability',
    name: '`WEBGL_debug_shaders` (`getTranslatedShaderSource`)',
    covers: ['webgl:WEBGL_debug_shaders.getTranslatedShaderSource'],
    evidence: 'src/core/gl-compute.ts:99-131 (the runtime compiles and links its own shaders)',
    note: 'a debugging aid; the runtime holds the shader handles, so a host has no handle to translate; no caller of the key in src/',
    webgpu: na(
      'a debugging aid: WebGPU has no driver translation of a shader; the manifest holds the WGSL (Rule 11.10)',
    ),
    webgl2: na(
      'a debugging aid: the shader handles stay inside the runtime; the manifest holds the GLSL (Rule 11.10)',
    ),
  },
];
