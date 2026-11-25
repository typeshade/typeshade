// Why: the position is flipped in y and its depth moved from 0..w to -w..w so that a texture's rows,
// a fragment's `position` and a stored depth are WebGPU's; only the compile gate holds this on a real context.
//
// Buffers. A storage buffer is a data texture the draw programs read (change 0046), as X-GIS's
// `storage-data-texture.ts` makes one, with the element type the buffer carries
// (`elem`). Each buffer keeps its bytes on the host.
//
// Immediate. WebGL2 has no command buffer, so the encoder runs each command when it is recorded
// (`caps.immediate`), as X-GIS's WebGL2 encoder does. A pass is begun, drawn and ended at its
// record, and `submit` has nothing left to run. A read of a texture waits on a fence.
//
// Flat values. WebGPU takes a `flat` interstage value from the first vertex of a primitive, and
// GLSL ES 3.00 from the last. A pipeline whose vertex program declares a `flat out` draws with the
// first vertex: with `WEBGL_provoking_vertex` where the context has it, set for the pass and given
// back at its end, and otherwise through an element buffer of its own that names each triangle's
// first vertex last (`firstVertexLast`), which draws the same triangles. A line has no such form,
// since a line turned round covers other pixels at its ends, so without the extension a line
// pipeline with a flat value is refused.
//
// Binding by name. A program reads a uniform block, a texture or a data texture by the name it
// declares, which a bind group layout entry carries (`name`), and GLSL ES 3.00 fuses a texture with
// one sampler (`samplerBinding`). The pipeline gives each binding its block binding point or texture unit
// once, when it is linked; a draw binds the bind groups set on the pass to those units.

import type { RhiDevice } from './rhi.js';
import { GlDevice } from './webgl2/device.js';
export { glReadBindings } from './webgl2/pipeline.js';
export { firstVertexLast } from './webgl2/first-vertex-last.js';
export { DATA_WIDTH } from './webgl2/data-texture.js';
export { GL_TOPOLOGY, GL_BLEND_FACTOR, GL_BLEND_OPERATION } from './webgl2/draw-state.js';
export { textureKindOf } from './webgl2/format.js';
export type { GlTextureKind } from './webgl2/types.js';

export function webgl2Device(gl: WebGL2RenderingContext): RhiDevice {
  return new GlDevice(gl);
}
