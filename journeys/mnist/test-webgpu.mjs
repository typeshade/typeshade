import assert from 'node:assert/strict';
import { browserBackend } from './webgpu-node.mjs';
import { buffers, fixture, initialize, reference, referenceUpdate, close } from './reference.mjs';
import { train } from './train.ts';
const gpu = await browserBackend({ software: process.argv.includes('--software') });
try {
  const data = fixture(11),
    model = initialize(),
    batch = { offset: 3, count: 7, rate: 0.17 };
  const expected = reference(data, model, batch.offset, batch.count);
  const updated = referenceUpdate(model, expected, batch.rate);
  const backend = await gpu.makeBackend(buffers(data, model, batch.count));
  const errors = {};
  try {
    for (const entry of ['forward', 'objective', 'reduce', 'backward'])
      await backend.dispatch(entry, batch);
    for (const name of ['logits', 'losses', 'delta', 'stats', 'gradW', 'gradB'])
      errors[name] = close(await backend.read(name), expected[name], 2e-5);
    await backend.dispatch('update', batch);
    for (const name of ['weights', 'bias'])
      errors[name] = close(await backend.read(name), updated[name], 2e-5);
    console.log(
      JSON.stringify({
        test: 'WebGPU stages vs independent f64 reference',
        maxAbsoluteErrors: errors,
        transfers: backend.transfers,
      }),
    );
  } finally {
    await backend.destroy();
  }
  const reuseData = fixture(65);
  const reuse = await gpu.makeBackend(buffers(reuseData, initialize(), 32));
  try {
    for (const entry of ['forward', 'objective', 'backward', 'update'])
      await reuse.dispatch(entry, { count: 32, offset: 0, rate: 0.1 });
    const before = await reuse.telemetry();
    for (const entry of ['forward', 'objective', 'backward', 'update'])
      await reuse.dispatch(entry, { count: 32, offset: 32, rate: 0.1 });
    const after = await reuse.telemetry();
    assert.equal(after.bufferAllocations, before.bufferAllocations);
    assert.equal(after.readbacks, 0);
    console.log(
      JSON.stringify({
        test: 'Resident tensors reused between training batches without readback',
        deviceTensorBytes: reuse.deviceTensorBytes,
        deviceInfo: reuse.deviceInfo,
        newBufferAllocations: after.bufferAllocations - before.bufferAllocations,
        transfers: after,
      }),
    );
    const batch = { count: 32, offset: 32, rate: 0.1 };
    await reuse.dispatch('reduce', batch);
    const a = await reuse.telemetry();
    await reuse.dispatch('reduce', batch);
    const b = await reuse.telemetry();
    const values = await reuse.read('stats');
    await reuse.dispatch('reduce', batch);
    const c = await reuse.telemetry();
    close(await reuse.read('stats'), values);
    console.log(
      JSON.stringify({
        test: 'Statistics readback freshness/upload probe',
        reduceWithoutReadUploadBytes: b.uploadBytes - a.uploadBytes,
        reduceAfterReadUploadBytes: c.uploadBytes - b.uploadBytes,
        extraStatsReuploadBytes: c.uploadBytes - b.uploadBytes - (b.uploadBytes - a.uploadBytes),
      }),
    );
  } finally {
    await reuse.destroy();
    const released = await reuse.telemetry();
    assert.equal(released.liveRequestedBufferBytes, 0);
  }
  const options = { epochs: 3, batchSize: 8, rate: 0.1 };
  const first = await train(fixture(23), gpu.makeBackend, options);
  const second = await train(fixture(23), gpu.makeBackend, options);
  assert(first.final.loss < first.initial.loss);
  assert(first.final.accuracy > first.initial.accuracy);
  assert(first.weights.some((v, i) => v !== initialize().weights[i]));
  close(first.weights, second.weights, 2e-5);
  close(first.bias, second.bias, 2e-5);
  close([first.final.loss], [second.final.loss], 2e-5);
  console.log(
    JSON.stringify({
      test: 'WebGPU training and reproducibility',
      initial: first.initial,
      final: first.final,
      transfers: first.transfers,
    }),
  );
} finally {
  await gpu.cleanup();
}
