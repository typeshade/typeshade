import { createRuntime, resident } from '../../src/runtime.ts';
// This module runs in a browser. The compiler stays in the Node host.
export async function webgpuBackend(host, pack) {
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
    uploadBytes: 0,
    readbacks: 0,
    readbackBytes: 0,
    label: 'Observed queue.writeBuffer and buffer.mapAsync calls, includes uniforms and staging',
  };
  const queue = rt.device.queue;
  const writeBuffer = queue.writeBuffer;
  queue.writeBuffer = function (buffer, offset, data, dataOffset, size) {
    transfers.uploads++;
    transfers.uploadBytes += size ?? data.byteLength;
    return writeBuffer.call(this, buffer, offset, data, dataOffset, size);
  };
  const createBuffer = rt.device.createBuffer;
  rt.device.createBuffer = function (descriptor) {
    const buffer = createBuffer.call(this, descriptor);
    const mapAsync = buffer.mapAsync;
    buffer.mapAsync = function (...args) {
      transfers.readbacks++;
      transfers.readbackBytes += args[2] ?? descriptor.size;
      return mapAsync.apply(this, args);
    };
    return buffer;
  };
  return {
    tier: rt.tier,
    transfers,
    async dispatch(entry, batch) {
      const n =
        entry === 'reduce'
          ? 1
          : entry === 'backward' || entry === 'update'
            ? Math.ceil(7840 / 64)
            : Math.ceil(batch.count / 64);
      const frame = rt.frame();
      const supplied = { ...bindings, batch };
      const reached = Object.fromEntries(
        pack.entries
          .find((e) => e.name === entry)
          .bindings.map(({ name }) => [name, supplied[name]]),
      );
      frame.dispatch(pipelines[entry], reached, n);
      await frame.submit();
    },
    async read(name) {
      return bindings[name].read();
    },
    destroy() {
      for (const value of Object.values(bindings)) value.destroy();
      queue.writeBuffer = writeBuffer;
      rt.device.createBuffer = createBuffer;
      rt.destroy();
    },
  };
}
