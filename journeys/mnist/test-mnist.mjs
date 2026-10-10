import assert from 'node:assert/strict';
import { loadMnist } from './dataset.mjs';
import { cpuBackend } from './cpu.mjs';
import { train, evaluateModel } from './train.mjs';
import { initialize, referenceTrain, close } from './reference.mjs';
const data = await loadMnist('journeys/mnist/.data', 'train', 1024);
const testing = await loadMnist('journeys/mnist/.data', 'test', 1000);
const options = { epochs: 5, batchSize: 32, rate: 0.1, seed: 123 };
const first = await train(data, cpuBackend, options);
const second = await train(data, cpuBackend, options);
const independent = referenceTrain(data, options);
const errors = {
  weights: close(first.weights, independent.weights),
  bias: close(first.bias, independent.bias),
};
assert.deepEqual(first.weights, second.weights);
assert.deepEqual(first.bias, second.bias);
assert.equal(first.final.loss, second.final.loss);
assert(first.final.loss < first.initial.loss);
assert(first.final.accuracy > first.initial.accuracy);
const initialTest = await evaluateModel(testing, initialize(), cpuBackend);
const finalTest = await evaluateModel(testing, first, cpuBackend);
assert(finalTest.accuracy > initialTest.accuracy);
console.log(
  JSON.stringify({
    test: 'Real MNIST CPU training/reference/reproducibility',
    initial: first.initial,
    final: first.final,
    initialTest,
    finalTest,
    maxAbsoluteErrors: errors,
  }),
);
if (process.argv.includes('--webgpu')) {
  const { browserBackend } = await import('./webgpu-node.mjs');
  const gpu = await browserBackend({ software: process.argv.includes('--software') });
  try {
    const gpuFirst = await train(data, gpu.makeBackend, options);
    const gpuSecond = await train(data, gpu.makeBackend, options);
    const gpuErrors = {
      weightsVsCpu: close(gpuFirst.weights, first.weights),
      biasVsCpu: close(gpuFirst.bias, first.bias),
      weightsRepeat: close(gpuFirst.weights, gpuSecond.weights),
      biasRepeat: close(gpuFirst.bias, gpuSecond.bias),
    };
    close([gpuFirst.final.loss], [gpuSecond.final.loss]);
    assert(gpuFirst.final.loss < gpuFirst.initial.loss);
    assert(gpuFirst.final.accuracy > gpuFirst.initial.accuracy);
    const testMetrics = await evaluateModel(testing, gpuFirst, gpu.makeBackend);
    assert(testMetrics.accuracy > initialTest.accuracy);
    console.log(
      JSON.stringify({
        test: 'Real MNIST WebGPU training/CPU comparison/reproducibility',
        initial: gpuFirst.initial,
        final: gpuFirst.final,
        testMetrics,
        maxAbsoluteErrors: gpuErrors,
        transfers: gpuFirst.transfers,
      }),
    );
  } finally {
    await gpu.cleanup();
  }
}
