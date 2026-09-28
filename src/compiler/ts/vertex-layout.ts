// The vertex layout moved to `src/core/vertex-layout.ts`, where `reflect()` and the manifest read
// it without the front end (change 0025). This path keeps the names it always exported.
export {
  vertexLayoutOf,
  vertexLayoutOfFunc,
  type GpuVertexAttr,
  type GpuVertexLayout,
} from '../../core/vertex-layout.js';
