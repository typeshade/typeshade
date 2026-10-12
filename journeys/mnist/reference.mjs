import { INPUTS, CLASSES, random, initialize } from './model.mjs';
export { INPUTS, CLASSES, random, initialize, buffers } from './model.mjs';

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

// Independent f64 inference reference. Never bundled into the browser host.
export function referencePredict(logits) {
  if (logits.length < CLASSES) throw new RangeError('Need 10 logits');
  const scores = Array.from(logits.subarray(0, CLASSES));
  const peak = Math.max(...scores);
  const exps = scores.map((z) => Math.exp(z - peak));
  const sum = exps.reduce((n, v) => n + v, 0);
  const probabilities = exps.map((v) => v / sum);
  const predicted = scores.indexOf(peak);
  return { probabilities, predicted };
}
