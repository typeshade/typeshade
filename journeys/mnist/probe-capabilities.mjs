import assert from 'node:assert/strict';
import { compile, grad } from '../../dist/src/index.js';
import { compileExperiment } from './cpu.mjs';
// Unsupported-feature reproductions. A refusal here is the expected current main behavior.
const arraySource = `"use typeshade";
export function sumSquares(xs: array<f32>): f32 {
  let sum: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { sum += xs[i] * xs[i]; }
  return sum;
}
`;
const storageSource = `"use typeshade";
declare const weights: storage<array<f32>>;
export function storageLoss(i: u32): f32 { return weights[i] * weights[i]; }
`;
const scatterSource = `"use typeshade";
export function histogram(xs: array<f32>, indices: array<u32>, bins: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { bins[indices[i]] += xs[i]; }
}
`;
export function probeCapabilities() {
  const array = compile(arraySource);
  assert.equal(array.diagnostics.length, 0);
  const refusals = [];
  for (const mode of ['forward', 'reverse']) {
    assert.throws(
      () => grad(array.module, 'sumSquares', 'xs', { mode }),
      (error) => {
        assert.equal(error.code, 'SD0118');
        assert.match(error.message, /array<f32>/);
        refusals.push({
          pattern: 'array parameter AD',
          mode,
          code: error.code,
          message: error.message,
        });
        return true;
      },
    );
  }
  assert.throws(
    () => grad(compileExperiment(), 'forward', 'weights', { mode: 'reverse' }),
    (error) => {
      assert.equal(error.code, 'SD0118');
      assert.match(error.message, /returns void/);
      refusals.push({ pattern: 'compute entry AD', code: error.code, message: error.message });
      return true;
    },
  );
  const storage = compile(storageSource);
  assert.equal(storage.diagnostics.length, 0);
  assert.throws(
    () => grad(storage.module, 'storageLoss', 'weights', { mode: 'reverse' }),
    (error) => {
      assert.equal(error.code, 'SD0118');
      assert.match(error.message, /no parameter/);
      refusals.push({ pattern: 'storage binding AD', code: error.code, message: error.message });
      return true;
    },
  );
  const scatter = compile(scatterSource);
  assert(scatter.diagnostics.some((d) => d.code === 'TS8070'));
  assert(!scatter.diagnostics.some((d) => d.category === 'error'));
  return { arraySource, scatterSource, refusals, scatterDiagnostics: scatter.diagnostics };
}
if (import.meta.url === new URL(process.argv[1], 'file://').href)
  console.log(JSON.stringify(probeCapabilities()));
