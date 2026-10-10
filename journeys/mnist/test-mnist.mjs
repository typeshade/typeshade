import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { loadMnist } from './dataset.ts';
import { cpuBackend } from './cpu.mjs';
import { train, evaluateModel } from './train.ts';
import { initialize, referenceTrain, close } from './reference.mjs';
const { values } = parseArgs({
  options: {
    train: { type: 'string', default: '1024' },
    test: { type: 'string', default: '1000' },
    epochs: { type: 'string', default: '5' },
    webgpu: { type: 'boolean', default: false },
    software: { type: 'boolean', default: false },
  },
});
const data = await loadMnist('journeys/mnist/.data', 'train', Number(values.train));
const testing = await loadMnist('journeys/mnist/.data', 'test', Number(values.test));
const options = { epochs: Number(values.epochs), batchSize: 32, rate: 0.1, seed: 123 };
console.log(
  JSON.stringify({
    configuration: options,
    trainCount: data.labels.length,
    testCount: testing.labels.length,
  }),
);
const first = await train(data, cpuBackend, {
  ...options,
  log: (row) => console.log(JSON.stringify({ run: 'cpu', ...row })),
});
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
if (values.webgpu) {
  const { browserBackend } = await import('./webgpu-node.mjs');
  const gpu = await browserBackend({ software: values.software });
  try {
    const gpuFirst = await train(data, gpu.makeBackend, {
      ...options,
      log: (row) => console.log(JSON.stringify({ run: 'webgpu-first', ...row })),
    });
    const gpuSecond = await train(data, gpu.makeBackend, {
      ...options,
      log: (row) => console.log(JSON.stringify({ run: 'webgpu-repeat', ...row })),
    });
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
        timings: gpuFirst.timings,
        memory: gpuFirst.memory,
        computation: gpuFirst.computation,
      }),
    );
  } finally {
    await gpu.cleanup();
  }
}
