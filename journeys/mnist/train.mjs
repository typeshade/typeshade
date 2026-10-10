import { initialize, buffers } from './reference.mjs';
// SGD and batching live in the experiment, not TypeShade Core. Fixed contiguous batches.
export async function train(
  data,
  makeBackend,
  { epochs = 5, batchSize = 32, rate = 0.1, seed = 123, log = () => {} } = {},
) {
  if (
    !Number.isInteger(epochs) ||
    epochs < 1 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    data.labels.length === 0 ||
    data.pixels.length !== data.labels.length * 784
  )
    throw new Error('Invalid training options');
  const host = buffers(data, initialize(seed), Math.min(batchSize, data.labels.length));
  const backend = await makeBackend(host);
  const timings = [];
  const started = performance.now();
  async function dispatch(entry, batch) {
    const begin = performance.now();
    await backend.dispatch(entry, batch);
    return performance.now() - begin;
  }
  async function evaluate() {
    let loss = 0,
      correct = 0;
    for (let offset = 0; offset < data.labels.length; offset += batchSize) {
      const count = Math.min(batchSize, data.labels.length - offset);
      const batch = { count, offset, rate };
      await backend.dispatch('forward', batch);
      await backend.dispatch('objective', batch);
      await backend.dispatch('reduce', batch);
      const stats = await backend.read('stats');
      loss += stats[0] * count;
      correct += stats[1];
    }
    return { loss: loss / data.labels.length, accuracy: correct / data.labels.length };
  }
  try {
    const initial = await evaluate();
    log({ phase: 'initial', tier: backend.tier, ...initial });
    for (let epoch = 1; epoch <= epochs; epoch++) {
      const begin = performance.now();
      let forwardMs = 0,
        backwardMs = 0,
        updateMs = 0;
      for (let offset = 0; offset < data.labels.length; offset += batchSize) {
        const batch = { count: Math.min(batchSize, data.labels.length - offset), offset, rate };
        forwardMs += await dispatch('forward', batch);
        forwardMs += await dispatch('objective', batch);
        backwardMs += await dispatch('backward', batch);
        updateMs += await dispatch('update', batch);
      }
      const epochMs = performance.now() - begin;
      const metrics = await evaluate();
      const row = { epoch, ...metrics, forwardMs, backwardMs, updateMs, epochMs };
      timings.push(row);
      log(row);
    }
    const weights = await backend.read('weights');
    const bias = await backend.read('bias');
    if (![...weights, ...bias].every(Number.isFinite)) throw new Error('Non-finite parameters');
    return {
      tier: backend.tier,
      initial,
      final: timings.at(-1),
      timings,
      weights,
      bias,
      totalMs: performance.now() - started,
      memory: {
        label:
          'Estimated tensor payload bytes; excludes runtime, staging, pipeline and JS overhead',
        bytes: Object.values(host).reduce((n, a) => n + a.byteLength, 0),
      },
      transfers: backend.transfers ?? {
        uploads: 0,
        readbacks: 0,
        label: 'CPU execution: no CPU/GPU transfers',
      },
    };
  } finally {
    await backend.destroy();
  }
}
export async function evaluateModel(data, model, makeBackend, batchSize = 32) {
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    data.labels.length === 0 ||
    data.pixels.length !== data.labels.length * 784
  )
    throw new Error('Invalid evaluation dataset or batch size');
  const backend = await makeBackend(buffers(data, model, Math.min(batchSize, data.labels.length)));
  let loss = 0,
    correct = 0;
  try {
    for (let offset = 0; offset < data.labels.length; offset += batchSize) {
      const count = Math.min(batchSize, data.labels.length - offset);
      const batch = { count, offset, rate: 0 };
      for (const entry of ['forward', 'objective', 'reduce']) await backend.dispatch(entry, batch);
      const stats = await backend.read('stats');
      loss += stats[0] * count;
      correct += stats[1];
    }
    return { loss: loss / data.labels.length, accuracy: correct / data.labels.length };
  } finally {
    await backend.destroy();
  }
}
