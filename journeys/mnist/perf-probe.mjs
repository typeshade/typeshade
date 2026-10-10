// Compare the same MNIST computation under four execution policies.
// Wall-time diagnostic only: never interpret these as GPU timestamp measurements.
import { parseArgs } from 'node:util';
import { loadMnist } from './dataset.ts';
import { browserBackend } from './webgpu-node.mjs';
import { cpuBackend } from './cpu.mjs';
import { train } from './train.ts';
import { fixture, close } from './reference.mjs';

const { values } = parseArgs({
  options: {
    mnist: { type: 'boolean', default: false },
    count: { type: 'string', default: '256' },
    batch: { type: 'string', default: '32' },
    epochs: { type: 'string', default: '2' },
    rate: { type: 'string', default: '0.1' },
    seed: { type: 'string', default: '123' },
    repeats: { type: 'string', default: '1' },
    software: { type: 'boolean', default: false },
  },
});

const count = Number(values.count);
const repeats = Number(values.repeats);
if (!Number.isInteger(count) || count < 1 || !Number.isInteger(repeats) || repeats < 1)
  throw new Error('count/repeats must be positive integers');

let data = fixture(count);
if (values.mnist) data = await loadMnist('journeys/mnist/.data', 'train', count);

const options = {
  epochs: Number(values.epochs),
  batchSize: Number(values.batch),
  rate: Number(values.rate),
  seed: Number(values.seed),
};
const cpu = await train(data, cpuBackend, options);
const modes = ['baseline', 'browser', 'submit', 'combined'];
const browser = await browserBackend({ software: values.software });
const runs = [];

try {
  for (const mode of modes) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      // Fresh model weights and residents per run. Match data, order and seed.
      const makeBackend = (host) => browser.makeBackend(host, { executionMode: mode });
      const result = await train(data, makeBackend, options);
      const weightError = close(result.weights, cpu.weights);
      const biasError = close(result.bias, cpu.bias);
      const actual = [result.final.loss, result.final.accuracy];
      const expected = [cpu.final.loss, cpu.final.accuracy];
      close(actual, expected);
      const row = {
        mode,
        repeat,
        trainingWallMs: result.timings.reduce((sum, epoch) => sum + epoch.epochMs, 0),
        endToEndWallMs: result.totalMs,
        epochWallMs: result.timings.map((epoch) => epoch.epochMs),
        stageTimingDomain: result.timings[0].timingDomain,
        finalLoss: result.final.loss,
        finalAccuracy: result.final.accuracy,
        maxWeightErrorVsCpu: weightError,
        maxBiasErrorVsCpu: biasError,
        queueSubmissionsIncludingEvaluations: result.transfers.submissions,
        uploadsIncludingEvaluations: result.transfers.uploads,
        readbacksIncludingEvaluations: result.transfers.readbacks,
        uploadBytesIncludingEvaluations: result.transfers.uploadBytes,
      };
      runs.push(row);
      console.log(JSON.stringify(row));
    }
  }
} finally {
  await browser.cleanup();
}

const summary = {
  kind: 'mnist-execution-overhead',
  environment: {
    platform: process.platform,
    node: process.version,
    requestedSoftware: values.software,
  },
  data: {
    source: values.mnist ? 'MNIST' : 'deterministic synthetic',
    examples: data.labels.length,
  },
  options,
  repeats,
  modes: {
    baseline: 'five Playwright calls per batch; four awaited GPU queue submissions',
    browser: 'one Playwright call per epoch; four awaited GPU queue submissions per batch',
    submit: 'five Playwright calls per batch; one awaited GPU queue submission per batch',
    combined: 'one Playwright call per epoch; one awaited GPU queue submission per batch',
  },
  timingWarning: [
    'All reported times are host wall times, not GPU timestamp kernel times.',
    'Stages in grouped modes do not independently measure GPU completion.',
  ].join(' '),
  cpu: {
    trainingWallMs: cpu.timings.reduce((sum, epoch) => sum + epoch.epochMs, 0),
    endToEndWallMs: cpu.totalMs,
    finalAccuracy: cpu.final.accuracy,
  },
  runs,
};
console.log(JSON.stringify(summary, null, 2));
