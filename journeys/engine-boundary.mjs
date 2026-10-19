// The engine boundary of the journeys (proposal 0064, PR-1, S6). An engine's source may import the
// runtime's public subpath only, and it may not reach for WebGPU itself: the runtime makes and
// records every buffer, texture, pipeline and pass call. `_harness.mjs` checks each engine and
// fuse host with this module, and `src/journeys-boundary.test.ts` reads it.

/** A WebGPU call or global an engine's own code must not reach for: the runtime makes and
 *  records everything, and `raw` is the pass the runtime hands a host that owns its frame. The
 *  typed pass methods (`setViewport`, `setScissorRect`, `setBlendConstant`, `draw`) are not in the
 *  pattern: they are the runtime's own calls. */
export const WEBGPU_CALL =
  /\bnavigator\s*\.\s*gpu\b|\bGPU[A-Z]\w*|\.\s*(createBuffer|createTexture|createView|createSampler|createBindGroup|createBindGroupLayout|createPipelineLayout|createShaderModule|createRenderPipeline|createRenderPipelineAsync|createComputePipeline|createComputePipelineAsync|createCommandEncoder|beginRenderPass|beginComputePass|setPipeline|setBindGroup|setVertexBuffer|setIndexBuffer|writeBuffer|writeTexture|queue|raw|mapAsync|getMappedRange)\b/;

/** Why a source is not held to `imports`, or '' when it is. `imports` is what the source may import
 *  (`allows`) and the reason a import it does not allow is refused (`why`). A call of WebGPU is an
 *  offence whatever the imports. */
export function engineOffence(
  source,
  imports = {
    allows: (spec) => spec === 'typeshade/runtime',
    why: "is not the runtime's public subpath",
  },
) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const m of code.matchAll(
    /\bimport\s*(?:[^'"]*?\bfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g,
  )) {
    const spec = m[1] ?? m[2];
    if (!imports.allows(spec)) return `imports "${spec}", which ${imports.why}`;
  }
  const call = WEBGPU_CALL.exec(code);
  return call ? `calls WebGPU itself: "${call[0].trim()}"` : '';
}
