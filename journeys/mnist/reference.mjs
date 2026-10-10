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
export function fixture(count = 30) {
  const rng = random(41);
  const pixels = new Float32Array(count * INPUTS);
  const labels = Uint32Array.from({ length: count }, (_, i) => i % CLASSES);
  for (let row = 0; row < count; row++)
    for (let p = 0; p < INPUTS; p++)
      pixels[row * INPUTS + p] = p % CLASSES === labels[row] ? 0.8 + rng() * 0.2 : rng() * 0.05;
  return { pixels, labels };
}
// Independent f64 reference: no TypeShade imports and no intermediate f32 rounding.
export function reference(data, model, offset = 0, count = data.labels.length) {
  const logits = new Float64Array(count * CLASSES);
  const losses = new Float64Array(count);
  const delta = new Float64Array(count * CLASSES);
  const gradW = new Float64Array(INPUTS * CLASSES);
  const gradB = new Float64Array(CLASSES);
  let correct = 0;
  for (let row = 0; row < count; row++) {
    for (let c = 0; c < CLASSES; c++) {
      let z = model.bias[c];
      for (let p = 0; p < INPUTS; p++)
        z += data.pixels[(offset + row) * INPUTS + p] * model.weights[p * CLASSES + c];
      logits[row * CLASSES + c] = z;
    }
    const z = logits.subarray(row * CLASSES, (row + 1) * CLASSES);
    const peak = Math.max(...z);
    const exps = Array.from(z, (v) => Math.exp(v - peak));
    const total = exps.reduce((a, b) => a + b, 0);
    const label = data.labels[offset + row];
    losses[row] = peak - z[label] + Math.log(total);
    if (z.indexOf(peak) === label) correct++;
    for (let c = 0; c < CLASSES; c++) {
      const d = (exps[c] / total - Number(c === label)) / count;
      delta[row * CLASSES + c] = d;
      gradB[c] += d;
      for (let p = 0; p < INPUTS; p++)
        gradW[p * CLASSES + c] += data.pixels[(offset + row) * INPUTS + p] * d;
    }
  }
  return {
    logits,
    losses,
    delta,
    gradW,
    gradB,
    stats: [losses.reduce((a, b) => a + b, 0) / count, correct],
  };
}
export function referenceUpdate(model, gradients, rate) {
  return {
    weights: Float64Array.from(model.weights, (v, i) => v - rate * gradients.gradW[i]),
    bias: Float64Array.from(model.bias, (v, i) => v - rate * gradients.gradB[i]),
  };
}
export function buffers(data, model, size) {
  return {
    pixels: data.pixels,
    labels: data.labels,
    weights: model.weights,
    bias: model.bias,
    logits: new Float32Array(size * 10),
    delta: new Float32Array(size * 10),
    losses: new Float32Array(size),
    stats: new Float32Array(2),
    gradW: new Float32Array(7840),
    gradB: new Float32Array(10),
  };
}
export function close(actual, expected, tolerance = 2e-5) {
  if (actual.length !== expected.length) throw new Error('Length mismatch');
  let worst = 0;
  for (let i = 0; i < actual.length; i++) {
    const error = Math.abs(actual[i] - expected[i]);
    if (!Number.isFinite(actual[i]) || error > tolerance * (1 + Math.abs(expected[i])))
      throw new Error(`Element ${i}: ${actual[i]} vs ${expected[i]} (tolerance ${tolerance})`);
    worst = Math.max(worst, error);
  }
  return worst;
}

export function referenceTrain(data, { epochs = 5, batchSize = 32, rate = 0.1, seed = 123 } = {}) {
  let model = initialize(seed);
  for (let epoch = 0; epoch < epochs; epoch++)
    for (let offset = 0; offset < data.labels.length; offset += batchSize) {
      const count = Math.min(batchSize, data.labels.length - offset);
      model = referenceUpdate(model, reference(data, model, offset, count), rate);
    }
  return model;
}
