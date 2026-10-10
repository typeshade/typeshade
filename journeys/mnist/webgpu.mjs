import { createRuntime, resident } from '../../src/runtime.ts';
// This module runs in a browser. The compiler stays in the Node host.
export async function webgpuBackend(host, pack, { batchSubmissions = false } = {}) {
  const rt = await createRuntime({ prefer: ['webgpu'], programs: [pack] });
  if (rt.tier !== 'webgpu') throw new Error(`Unexpected tier ${rt.tier}`);
  const program = rt.load(pack);
  const pipelines = {};
  for (const entry of ['forward', 'objective', 'reduce', 'backward', 'update'])
    pipelines[entry] = await program.compute(entry);
  const bindings = Object.fromEntries(
    Object.entries(host).map(([name, value]) => [name, resident(value)]),
  );
  // Actual queue writes count uniforms as well as storage uploads. Actual mapAsync calls
  // count readbacks. Install after pipeline creation; restore when this backend is released.
  const transfers = {
    uploads: 0,
    bufferAllocations: 0,
    liveRequestedBufferBytes: 0,
    peakRequestedBufferBytes: 0,
    uploadBytes: 0,
    uploadEnqueueMs: 0,
    readbackWallMs: 0,
    readbacks: 0,
    readbackBytes: 0,
    label: 'Observed queue.writeBuffer and buffer.mapAsync calls, includes uniforms and staging',
  };
  const queue = rt.device.queue;
  const writeBuffer = queue.writeBuffer;
  queue.writeBuffer = function (buffer, offset, data, dataOffset, size) {
    transfers.uploads++;
    transfers.uploadBytes += size ?? data.byteLength;
    const begin = performance.now();
    try {
      return writeBuffer.call(this, buffer, offset, data, dataOffset, size);
    } finally {
      transfers.uploadEnqueueMs += performance.now() - begin;
    }
  };
  const createBuffer = rt.device.createBuffer;
  rt.device.createBuffer = function (descriptor) {
    const buffer = createBuffer.call(this, descriptor);
    transfers.bufferAllocations++;
    transfers.liveRequestedBufferBytes += descriptor.size;
    transfers.peakRequestedBufferBytes = Math.max(
      transfers.peakRequestedBufferBytes,
      transfers.liveRequestedBufferBytes,
    );
    const destroy = buffer.destroy;
    let alive = true;
    buffer.destroy = function () {
      if (alive) {
        transfers.liveRequestedBufferBytes -= descriptor.size;
        alive = false;
      }
      return destroy.call(this);
    };
    const mapAsync = buffer.mapAsync;
    buffer.mapAsync = async function (...args) {
      transfers.readbacks++;
      transfers.readbackBytes += args[2] ?? descriptor.size;
      const begin = performance.now();
      try {
        return await mapAsync.apply(this, args);
      } finally {
        transfers.readbackWallMs += performance.now() - begin;
      }
    };
    return buffer;
  };
  let pendingFrame;
  return {
    tier: rt.tier,
    deviceInfo: {
      maxStorageBufferBindingSize: rt.device.limits.maxStorageBufferBindingSize,
      features: [...rt.device.features],
      adapterInfo: rt.device.adapterInfo
        ? {
            vendor: rt.device.adapterInfo.vendor,
            architecture: rt.device.adapterInfo.architecture,
            isFallbackAdapter: rt.device.adapterInfo.isFallbackAdapter,
          }
        : null,
    },
    transfers,
    setBatch(pixels, labels) {
      // Fixed-size resident inputs reuse the same device buffers, even for a final short batch.
      host.pixels.fill(0);
      host.pixels.set(pixels);
      host.labels.fill(0);
      host.labels.set(labels);
      bindings.pixels.write(host.pixels);
      bindings.labels.write(host.labels);
    },
    async dispatch(entry, batch) {
      const n =
        entry === 'reduce'
          ? 1
          : entry === 'backward' || entry === 'update'
            ? Math.ceil(7840 / 64)
            : Math.ceil(batch.count / 64);
      // Four training stages (or three evaluation stages) can share one ordered
      // command buffer. Avoid queue.onSubmittedWorkDone() at each intermediate stage.
      if (batchSubmissions && entry === 'forward' && pendingFrame)
        throw new Error('Previous MNIST batch was not submitted');
      const frame = batchSubmissions ? (pendingFrame ??= rt.frame()) : rt.frame();
      const supplied = { ...bindings, batch };
      const reached = Object.fromEntries(
        pack.entries
          .find((e) => e.name === entry)
          .bindings.map(({ name }) => [name, supplied[name]]),
      );
      frame.dispatch(pipelines[entry], reached, n);
      if (!batchSubmissions || entry === 'update' || entry === 'reduce') {
        pendingFrame = undefined;
        await frame.submit();
      }
    },
    async read(name) {
      return bindings[name].read();
    },
    destroy() {
      if (pendingFrame) throw new Error('Cannot destroy a backend with unsubmitted MNIST work');
      for (const value of Object.values(bindings)) value.destroy();
      queue.writeBuffer = writeBuffer;
      rt.device.createBuffer = createBuffer;
      rt.destroy();
    },
  };
}
