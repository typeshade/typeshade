// Shared, deterministic host-side tensor initialization and allocation.
// Model computation remains in softmax.shade.ts. CPU numerical reference is
// deliberately separate and imported by tests only.
export const INPUTS = 784;
export const CLASSES = 10;
export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
export function initialize(seed = 123) {
  const rng = random(seed);
  return {
    weights: Float32Array.from({ length: INPUTS * CLASSES }, () => (rng() - 0.5) * 0.02),
    bias: new Float32Array(CLASSES),
  };
}
export function buffers(data, model, size) {
  return {
    pixels: data.pixels,
    labels: data.labels,
    weights: model.weights,
    bias: model.bias,
    logits: new Float32Array(size * CLASSES),
    delta: new Float32Array(size * CLASSES),
    losses: new Float32Array(size),
    stats: new Float32Array(2),
    gradW: new Float32Array(INPUTS * CLASSES),
    gradB: new Float32Array(CLASSES),
    probabilities: new Float32Array(CLASSES),
    predicted: new Uint32Array(1),
  };
}
