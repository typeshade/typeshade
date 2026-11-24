import { andGap, na, raw, type Row } from '../model.js';

export const TEXTURE_VIEW_DESCRIPTOR_ROWS: readonly Row[] = [
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureViewDescriptor.format`',
    covers: ['GPUTextureViewDescriptor.format'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts:1839-1840; src/rhi/webgpu.ts:342-344',
    webgpu: andGap(
      raw(
        'Texture.texture',
        'the host calls createView on the runtime texture and passes the view as a target or a binding; the runtime makes default views only',
      ),
      6,
      'no typed view with this member',
      637,
    ),
    webgl2: na('WebGL2 has no texture views'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureViewDescriptor.dimension`',
    covers: ['GPUTextureViewDescriptor.dimension'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts:1839-1840; src/rhi/webgpu.ts:342-344',
    webgpu: andGap(
      raw(
        'Texture.texture',
        'the host calls createView on the runtime texture and passes the view as a target or a binding; the runtime makes default views only',
      ),
      6,
      'no typed view with this member; roadmap 0.4 item 12 names the cube views (texture_cube, texture_cube_array; docs/roadmap.md:225)',
      637,
    ),
    webgl2: na('WebGL2 has no texture views'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureViewDescriptor.usage`',
    covers: ['GPUTextureViewDescriptor.usage'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts:1839-1840; src/rhi/webgpu.ts:342-344',
    webgpu: andGap(
      raw(
        'Texture.texture',
        'the host calls createView on the runtime texture and passes the view as a target or a binding; the runtime makes default views only',
      ),
      6,
      'no typed view with this member',
      637,
    ),
    webgl2: na('WebGL2 has no texture views'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureViewDescriptor.aspect`',
    covers: ['GPUTextureViewDescriptor.aspect'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts:1839-1840; src/rhi/webgpu.ts:342-344',
    webgpu: andGap(
      raw(
        'Texture.texture',
        'the host calls createView on the runtime texture and passes the view as a target or a binding; the runtime makes default views only',
      ),
      6,
      'no typed view with this member',
      637,
    ),
    webgl2: na('WebGL2 has no texture views'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureViewDescriptor.baseMipLevel`',
    covers: ['GPUTextureViewDescriptor.baseMipLevel'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts:1839-1840; src/rhi/webgpu.ts:342-344',
    webgpu: andGap(
      raw(
        'Texture.texture',
        'the host calls createView on the runtime texture and passes the view as a target or a binding; the runtime makes default views only',
      ),
      6,
      'no typed view with this member',
      637,
    ),
    webgl2: na('WebGL2 has no texture views'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureViewDescriptor.mipLevelCount`',
    covers: ['GPUTextureViewDescriptor.mipLevelCount'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts:1839-1840; src/rhi/webgpu.ts:342-344',
    webgpu: andGap(
      raw(
        'Texture.texture',
        'the host calls createView on the runtime texture and passes the view as a target or a binding; the runtime makes default views only',
      ),
      6,
      'no typed view with this member',
      637,
    ),
    webgl2: na('WebGL2 has no texture views'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureViewDescriptor.baseArrayLayer`',
    covers: ['GPUTextureViewDescriptor.baseArrayLayer'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts:1839-1840; src/rhi/webgpu.ts:342-344',
    webgpu: andGap(
      raw(
        'Texture.texture',
        'the host calls createView on the runtime texture and passes the view as a target or a binding; the runtime makes default views only',
      ),
      6,
      'no typed view with this member',
      637,
    ),
    webgl2: na('WebGL2 has no texture views'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureViewDescriptor.arrayLayerCount`',
    covers: ['GPUTextureViewDescriptor.arrayLayerCount'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts:1839-1840; src/rhi/webgpu.ts:342-344',
    webgpu: andGap(
      raw(
        'Texture.texture',
        'the host calls createView on the runtime texture and passes the view as a target or a binding; the runtime makes default views only',
      ),
      6,
      'no typed view with this member',
      637,
    ),
    webgl2: na('WebGL2 has no texture views'),
  },
  {
    table: 'A',
    kind: 'WebGPU dictionary member',
    name: '`GPUTextureViewDescriptor.swizzle`',
    covers: ['GPUTextureViewDescriptor.swizzle'],
    evidence:
      'src/runtime/runtime.ts:105-170; src/runtime/program.ts:1839-1840; src/rhi/webgpu.ts:342-344',
    webgpu: andGap(
      raw(
        'Texture.texture',
        'the host calls createView on the runtime texture and passes the view as a target or a binding; the runtime makes default views only',
      ),
      6,
      'no typed view with this member',
      637,
    ),
    webgl2: na('WebGL2 has no texture views'),
  },
];
