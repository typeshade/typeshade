// Why: GLSL folds a texture's layer differently for a 2d array (a vec3(uv, layer)) and a cube
// array (no sampler in GLSL ES 3.00), so an id's text must never depend on the texture it reads.
export function arraySuffix(dim: string): '' | 'Array' | 'CubeArray' {
  return dim === '2d-array' ? 'Array' : dim === 'cube-array' ? 'CubeArray' : '';
}
