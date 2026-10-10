import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { webgl2BrowserBackend } from './webgl2-node.mjs';
import { cpuBackend } from './cpu.mjs';
import { train, evaluateModel } from './train.ts';
import { loadMnist } from './dataset.ts';
import { buffers, fixture, initialize, reference, referenceUpdate, close } from './reference.mjs';

const { values } = parseArgs({
  options: {
    stagesOnly: { type: 'boolean', default: false },
    mnist: { type: 'boolean', default: false },
    count: { type: 'string', default: '32' },
    test: { type: 'string', default: '32' },
    epochs: { type: 'string', default: '1' },
  },
});
const browser = await webgl2BrowserBackend();
try {
  const data = fixture(11);
  const model = initialize();
  const batch = { offset: 3, count: 7, rate: 0.17 };
  const expected = reference(data, model, batch.offset, batch.count);
  const updated = referenceUpdate(model, expected, batch.rate);
  const backend = await browser.makeBackend(buffers(data, model, batch.count));
  try {
    assert.equal(backend.tier, 'webgl2', 'Never accept a CPU/WebGPU fallback as WebGL2');
    const errors = {};
    for (const entry of ['forward', 'objective', 'reduce', 'backward'])
      await backend.dispatch(entry, batch);
    for (const name of ['logits', 'losses', 'delta', 'stats', 'gradW', 'gradB'])
      errors[name] = close(await backend.read(name), expected[name], 2e-5);
    await backend.dispatch('update', batch);
    errors.weights = close(await backend.read('weights'), updated.weights, 2e-5);
    errors.bias = close(await backend.read('bias'), updated.bias, 2e-5);
    console.log(
      JSON.stringify({
        test: 'Five real WebGL2 TypeShade passes against independent f64 reference',
        tier: backend.tier,
        renderer: browser.glInfo,
        errors,
        telemetry: await backend.telemetry(),
      }),
    );
  } finally {
    await backend.destroy();
  }
  if (values.stagesOnly) {
    console.log(JSON.stringify({ status: 'stages-only passed; training not requested' }));
  } else {
    const count = Number(values.count);
    const options = {
      epochs: Number(values.epochs),
      batchSize: Math.min(32, count),
      rate: 0.1,
      seed: 123,
    };
    const training = values.mnist
      ? await loadMnist('journeys/mnist/.data', 'train', count)
      : fixture(count);
    const testing = values.mnist
      ? await loadMnist('journeys/mnist/.data', 'test', Number(values.test))
      : fixture(count);
    const cpu = await train(training, cpuBackend, options);
    const webgl2 = await train(training, browser.makeBackend, {
      ...options,
      log: (row) => console.log(JSON.stringify({ tier: 'webgl2', ...row })),
    });
    assert.equal(webgl2.tier, 'webgl2');
    assert(webgl2.final.loss < webgl2.initial.loss);
    const errors = {
      weights: close(webgl2.weights, cpu.weights, 2e-5),
      bias: close(webgl2.bias, cpu.bias, 2e-5),
      trainingLoss: close([webgl2.final.loss], [cpu.final.loss], 2e-5),
      trainingAccuracy: close([webgl2.final.accuracy], [cpu.final.accuracy], 2e-5),
    };
    const cpuTest = await evaluateModel(testing, cpu, cpuBackend, options.batchSize);
    const webgl2Test = await evaluateModel(testing, webgl2, browser.makeBackend, options.batchSize);
    errors.testLoss = close([webgl2Test.loss], [cpuTest.loss], 2e-5);
    errors.testAccuracy = close([webgl2Test.accuracy], [cpuTest.accuracy], 2e-5);
    console.log(
      JSON.stringify({
        test: values.mnist ? 'Real MNIST WebGL2 training and test' : 'Synthetic MNIST WebGL2 training',
        renderer: browser.glInfo,
        trainingCount: training.labels.length,
        testCount: testing.labels.length,
        options,
        initial: webgl2.initial,
        final: webgl2.final,
        finalTest: webgl2Test,
        cpuTrainingWallMs: cpu.timings.reduce((n, x) => n + x.epochMs, 0),
        webgl2TrainingWallMs: webgl2.timings.reduce((n, x) => n + x.epochMs, 0),
        errors,
      }),
    );
  }
} finally {
  await browser.cleanup();
}
