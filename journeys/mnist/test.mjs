import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpuBackend, compileExperiment } from './cpu.mjs';
import {
  reference,
  referenceUpdate,
  referenceTrain,
  initialize,
  fixture,
  buffers,
  close,
} from './reference.mjs';
import { train } from './train.mjs';
import { parseIdx } from './dataset.mjs';
import { compile, grad, compileModuleJs } from '../../dist/src/index.js';

for (const settings of [
  { precision: 'f64', oracle: true },
  { precision: 'f64' },
  { precision: 'f32' },
]) {
  test(`forward, stable loss/reduction, explicit gradients and SGD: ${JSON.stringify(settings)}`, async () => {
    const data = fixture(11),
      model = initialize();
    // Nonzero offset and an incomplete batch cover indexing and normalization.
    const offset = 3,
      count = 7,
      rate = 0.17;
    const expected = reference(data, model, offset, count);
    const updated = referenceUpdate(model, expected, rate);
    const before = model.weights.slice();
    const host = buffers(data, model, count);
    // f64 buffers preserve oracle precision at stores for the f64 checks.
    if (settings.precision === 'f64')
      for (const name of [
        'weights',
        'bias',
        'logits',
        'delta',
        'losses',
        'stats',
        'gradW',
        'gradB',
      ])
        host[name] = Float64Array.from(host[name]);
    const cpu = cpuBackend(host, settings);
    const batch = { count, offset, rate };
    await cpu.dispatch('forward', batch);
    close(host.logits, expected.logits, settings.precision === 'f64' ? 1e-12 : 2e-5);
    await cpu.dispatch('objective', batch);
    await cpu.dispatch('reduce', batch);
    await cpu.dispatch('backward', batch);
    for (const name of ['losses', 'delta', 'stats', 'gradW', 'gradB'])
      close(host[name], expected[name], settings.precision === 'f64' ? 1e-12 : 2e-5);
    await cpu.dispatch('update', batch);
    close(host.weights, updated.weights);
    close(host.bias, updated.bias);
    assert(host.weights.some((v, i) => v !== before[i]));
  });
}
test('loss stays finite at large logits and is invariant to a common offset', async () => {
  const data = fixture(2),
    host = buffers(data, initialize(), 2);
  const backend = cpuBackend(host);
  const batch = { count: 2, offset: 0, rate: 0.1 };
  host.logits.set(Array.from({ length: 20 }, (_, i) => (i % 10) * 2));
  await backend.dispatch('objective', batch);
  const original = host.losses.slice();
  for (let i = 0; i < host.logits.length; i++) host.logits[i] += 10000;
  await backend.dispatch('objective', batch);
  close(host.losses, original, 1e-6);
  assert([...host.delta].every(Number.isFinite));
});
test('explicit backward agrees with independent central differences', async () => {
  const data = fixture(4),
    host = buffers(data, initialize(), 4);
  for (const key of ['weights', 'bias', 'gradW', 'gradB', 'logits', 'delta', 'losses'])
    host[key] = Float64Array.from(host[key]);
  const backend = cpuBackend(host, { precision: 'f64' });
  const batch = { count: 4, offset: 0, rate: 0.1 };
  for (const entry of ['forward', 'objective', 'backward']) await backend.dispatch(entry, batch);
  const h = 1e-5;
  for (const [name, gradient, indices] of [
    ['weights', 'gradW', Array.from({ length: 24 }, (_, i) => (i * 337) % 7840)],
    ['bias', 'gradB', Array.from({ length: 10 }, (_, i) => i)],
  ]) {
    for (const i of indices) {
      const original = host[name][i];
      host[name][i] = original + h;
      const plus = reference(data, host).stats[0];
      host[name][i] = original - h;
      const minus = reference(data, host).stats[0];
      host[name][i] = original;
      close([host[gradient][i]], [(plus - minus) / (2 * h)], 1e-7);
    }
  }
});
test('fixed-subset training decreases loss, improves accuracy and reproduces exactly on CPU', async () => {
  const data = fixture(23);
  const options = { epochs: 3, batchSize: 8, rate: 0.1 };
  const first = await train(data, cpuBackend, options);
  const second = await train(data, cpuBackend, options);
  assert(first.final.loss < first.initial.loss);
  assert(first.final.accuracy > first.initial.accuracy);
  assert(first.weights.some((v, i) => v !== initialize().weights[i]));
  const independent = referenceTrain(data, options);
  close(first.weights, independent.weights);
  close(first.bias, independent.bias);
  assert.deepEqual(first.weights, second.weights);
  assert.deepEqual(first.bias, second.bias);
  assert.equal(first.final.loss, second.final.loss);
});
test('IDX dimensions, normalization, labels and malformed payloads', () => {
  const images = Buffer.alloc(16 + 784 * 2),
    labels = Buffer.alloc(10);
  [2051, 2, 28, 28].forEach((v, i) => images.writeUInt32BE(v, i * 4));
  labels.writeUInt32BE(2049, 0);
  labels.writeUInt32BE(2, 4);
  images[16] = 255;
  images[17] = 128;
  labels[8] = 9;
  const got = parseIdx(images, labels, 1);
  assert.equal(got.pixels[0], 1);
  assert.equal(got.pixels[1], Math.fround(128 / 255));
  assert.equal(got.labels[0], 9);
  assert.equal(got.labels.length, 1);
  assert.throws(() => parseIdx(images.subarray(0, 20), labels), /payload/);
  labels[8] = 10;
  assert.throws(() => parseIdx(images, labels), /label/);
  assert.throws(() => parseIdx(Buffer.alloc(1), Buffer.alloc(1)), /header/);
});
test('implemented scalar AD works; storage-array AD is explicitly refused', () => {
  const source = `"use typeshade";
export function scalar(x: f32, k: f32): f32 { return exp(x * k); }
export function arrayLoss(xs: array<f32>): f32 {
  let sum: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { sum += xs[i] * xs[i]; }
  return sum;
}
`;
  const result = compile(source);
  assert.equal(result.diagnostics.length, 0);
  for (const mode of ['forward', 'reverse']) {
    const derivative = grad(result.module, 'scalar', 'k', { mode });
    const cpu = compileModuleJs(derivative.module);
    const value = cpu.fns[derivative.name](0.5, 2, ...(mode === 'reverse' ? [1] : []));
    close([mode === 'reverse' ? value.k : value], [0.5 * Math.exp(1)], 1e-12);
    assert.throws(() => grad(result.module, 'arrayLoss', 'xs', { mode }), /array<f32>/);
  }
  assert.throws(
    () => grad(compileExperiment(), 'forward', 'weights', { mode: 'reverse' }),
    /returns void/,
  );
});
