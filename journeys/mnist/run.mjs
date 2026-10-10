import { parseArgs } from 'node:util';
import { loadMnist } from './dataset.mjs';
import { cpuBackend } from './cpu.mjs';
import { train, evaluateModel } from './train.mjs';
import { initialize } from './reference.mjs';
const { values } = parseArgs({
  options: {
    data: { type: 'string', default: 'journeys/mnist/.data' },
    download: { type: 'boolean', default: false },
    train: { type: 'string', default: '1024' },
    test: { type: 'string', default: '1000' },
    epochs: { type: 'string', default: '5' },
    batch: { type: 'string', default: '32' },
    rate: { type: 'string', default: '0.1' },
    seed: { type: 'string', default: '123' },
    tier: { type: 'string', default: 'cpu' },
    software: { type: 'boolean', default: false },
  },
});
const training = await loadMnist(values.data, 'train', Number(values.train), values.download);
const testing = await loadMnist(values.data, 'test', Number(values.test), values.download);
const options = {
  epochs: Number(values.epochs),
  batchSize: Number(values.batch),
  rate: Number(values.rate),
  seed: Number(values.seed),
};
console.log(
  JSON.stringify({
    configuration: options,
    trainCount: training.labels.length,
    testCount: testing.labels.length,
    sha256: { ...training.hashes, ...testing.hashes },
  }),
);
let makeBackend = cpuBackend,
  cleanup = () => {};
if (values.tier === 'webgpu') {
  const { browserBackend } = await import('./webgpu-node.mjs');
  const gpu = await browserBackend({ software: values.software });
  makeBackend = gpu.makeBackend;
  cleanup = gpu.cleanup;
} else if (values.tier !== 'cpu') throw new Error('Expected cpu or webgpu tier');
try {
  const initialTest = await evaluateModel(
    testing,
    initialize(options.seed),
    makeBackend,
    options.batchSize,
  );
  const result = await train(training, makeBackend, {
    ...options,
    log: (row) => console.log(JSON.stringify(row)),
  });
  const finalTest = await evaluateModel(testing, result, makeBackend, options.batchSize);
  const { weights: _weights, bias: _bias, ...report } = result;
  console.log(
    JSON.stringify({
      ...report,
      initialTest,
      finalTest,
      timingLabel:
        'Wall time per synchronized dispatch, includes submission/host overhead; epoch excludes evaluation; not timestamp-query kernel time',
    }),
  );
} finally {
  await cleanup();
}
