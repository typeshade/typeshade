"use typeshade";

class Batch {
  count: u32;
  offset: u32;
  rate: f32;
}
declare const batch: uniform<Batch>;
declare const pixels: storage<array<f32>>;
declare const labels: storage<array<u32>>;
declare const weights: storage<array<f32>, "read_write">;
declare const bias: storage<array<f32>, "read_write">;
declare const logits: storage<array<f32>, "read_write">;
declare const delta: storage<array<f32>, "read_write">;
declare const losses: storage<array<f32>, "read_write">;
declare const stats: storage<array<f32>, "read_write">;
declare const gradW: storage<array<f32>, "read_write">;
declare const gradB: storage<array<f32>, "read_write">;
declare const probabilities: storage<array<f32>, "read_write">;
declare const predicted: storage<array<u32>, "read_write">;

function stableProbability(z: f32, peak: f32, total: f32): f32 {
  return exp(z - peak) / total;
}

@compute([64])
export function forward(@builtin("global_invocation_id") gid: vec3u) {
  const row = gid.x;
  if (row >= batch.count) { return; }
  for (let c: u32 = 0; c < 10; c++) {
    let z = bias[c];
    for (let p: u32 = 0; p < 784; p++) {
      z += pixels[(batch.offset + row) * 784 + p] * weights[p * 10 + c];
    }
    logits[row * 10 + c] = z;
  }
}

@compute([64])
export function objective(@builtin("global_invocation_id") gid: vec3u) {
  const row = gid.x;
  if (row >= batch.count) { return; }
  let peak = logits[row * 10];
  for (let c: u32 = 1; c < 10; c++) { peak = max(peak, logits[row * 10 + c]); }
  let total: f32 = 0.;
  for (let c: u32 = 0; c < 10; c++) { total += exp(logits[row * 10 + c] - peak); }
  const label = labels[batch.offset + row];
  // Subtract before adding log(total), retaining small losses at large offsets.
  losses[row] = (peak - logits[row * 10 + label]) + log(total);
  for (let c: u32 = 0; c < 10; c++) {
    delta[row * 10 + c] = (stableProbability(logits[row * 10 + c], peak, total) - (c === label ? 1. : 0.)) / f32(batch.count);
  }
}

@compute([1])
export function reduce() {
  let total: f32 = 0.;
  let correct: f32 = 0.;
  for (let row: u32 = 0; row < batch.count; row++) {
    total += losses[row];
    let best: u32 = 0;
    for (let c: u32 = 1; c < 10; c++) {
      if (logits[row * 10 + c] > logits[row * 10 + best]) { best = c; }
    }
    if (best === labels[batch.offset + row]) { correct += 1.; }
  }
  stats[0] = total / f32(batch.count);
  stats[1] = correct;
}

// Explicit backward, not automatic differentiation. Storage-array reverse mode from
// change 0056 is not implemented on the inspected main. One writer per parameter.
@compute([64])
export function backward(@builtin("global_invocation_id") gid: vec3u) {
  const k = gid.x;
  if (k < 7840) {
    const p = k / 10;
    const c = k % 10;
    let sum: f32 = 0.;
    for (let row: u32 = 0; row < batch.count; row++) {
      sum += pixels[(batch.offset + row) * 784 + p] * delta[row * 10 + c];
    }
    gradW[k] = sum;
  }
  if (k < 10) {
    let sum: f32 = 0.;
    for (let row: u32 = 0; row < batch.count; row++) { sum += delta[row * 10 + k]; }
    gradB[k] = sum;
  }
}

@compute([64])
export function update(@builtin("global_invocation_id") gid: vec3u) {
  const k = gid.x;
  if (k < 7840) { weights[k] -= batch.rate * gradW[k]; }
  if (k < 10) { bias[k] -= batch.rate * gradB[k]; }
}

// One label-free inference entry, shared by the browser and the experiment host.
// The first forward row is the digit being classified. All probability math stays
// inside TypeShade, not in a second JavaScript implementation.
@compute([1])
export function predict() {
  let peak = logits[0];
  let best: u32 = 0;
  for (let c: u32 = 1; c < 10; c++) {
    const z = logits[c];
    if (z > peak) { peak = z; best = c; }
  }
  let total: f32 = 0.;
  for (let c: u32 = 0; c < 10; c++) { total += exp(logits[c] - peak); }
  for (let c: u32 = 0; c < 10; c++) {
    probabilities[c] = stableProbability(logits[c], peak, total);
  }
  predicted[0] = best;
}
