"use typeshade";

// One training batch of `softmax.shade.ts` (softmax regression on 28 x 28 digits: 784 pixels and a
// bias input, 10 classes), as four kernel functions instead of four compute entries: forward,
// objective, backward and update. Each loop writes one array at its own index, so a host calls
// them over `Resident` arrays, one after another or inside one `fuse` scope (change 0058).
// `bench-submissions.mjs` times the two. The weights hold the bias as the last of the 785 inputs
// of a class, and the last of the 785 values of a pixel row is 1.

const INPUTS: u32 = 785;
const CLASSES: u32 = 10;

/** The logit of each class for each row: `logits[row * 10 + c]`. */
export function forward(
  logits: array<f32>,
  pixels: array<f32>,
  weights: array<f32>,
): void {
  for (let i: u32 = 0; i < logits.length; i++) {
    const row = i / CLASSES;
    const c = i % CLASSES;
    let z: f32 = 0.;
    for (let p: u32 = 0; p < INPUTS; p++) {
      z += pixels[row * INPUTS + p] * weights[p * CLASSES + c];
    }
    logits[i] = z;
  }
}

/** The gradient of the mean cross-entropy at each logit: softmax minus the one-hot label, over
 *  the rows in the batch. */
export function objective(
  delta: array<f32>,
  logits: array<f32>,
  labels: array<u32>,
  rows: u32,
): void {
  for (let i: u32 = 0; i < delta.length; i++) {
    const row = i / CLASSES;
    const c = i % CLASSES;
    let peak: f32 = logits[row * CLASSES];
    for (let k: u32 = 1; k < CLASSES; k++) {
      peak = max(peak, logits[row * CLASSES + k]);
    }
    let total: f32 = 0.;
    for (let k: u32 = 0; k < CLASSES; k++) {
      total += exp(logits[row * CLASSES + k] - peak);
    }
    const hit: f32 = c === labels[row] ? 1. : 0.;
    delta[i] = (exp(logits[i] - peak) / total - hit) / f32(rows);
  }
}

/** The gradient of each weight: the sum over the rows of its pixel times the delta of its class. */
export function backward(
  grad: array<f32>,
  pixels: array<f32>,
  delta: array<f32>,
  rows: u32,
): void {
  for (let k: u32 = 0; k < grad.length; k++) {
    const p = k / CLASSES;
    const c = k % CLASSES;
    let sum: f32 = 0.;
    for (let row: u32 = 0; row < rows; row++) {
      sum += pixels[row * INPUTS + p] * delta[row * CLASSES + c];
    }
    grad[k] = sum;
  }
}

/** Stochastic gradient descent, in place. */
export function update(weights: array<f32>, grad: array<f32>, rate: f32): void {
  for (let k: u32 = 0; k < weights.length; k++) {
    weights[k] = weights[k] - rate * grad[k];
  }
}
