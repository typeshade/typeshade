// Host owns the device. TypeShade is compile-time only.
//   const s = compile(src)
//   s.wgsl / s.glsl.vertex / s.glsl.fragment / s.module

export function createRenderPipeline(device: GPUDevice, wgsl: string): GPURenderPipeline {
  const module = device.createShaderModule({ code: wgsl })
  return device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
    },
    primitive: { topology: 'triangle-list' },
  })
}

export function drawTriangle(pass: GPURenderPassEncoder, pipeline: GPURenderPipeline): void {
  pass.setPipeline(pipeline)
  pass.draw(3)
}
