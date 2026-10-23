import { createRuntime } from 'typeshade/runtime';
import { createRuntime as baselineRuntime } from './baseline.ts';
import manifest from './program.json';
import enabled from './enabled.json';

async function run() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('The console variant journey requires WebGPU.');
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener('uncapturederror', (e) => errors.push(e.error.message));
  const checks = [];
  const check = (ok, name) => {
    if (!ok) throw new Error(name);
    checks.push(name);
  };
  check(
    manifest.schema === 2 && !manifest.console && !manifest.ir && !!manifest.variants?.console,
    'schema 2 retains an optional variant without IR or default recording',
  );
  for (const [label, make, options, records] of [
    ['old reader default', baselineRuntime, undefined, false],
    ['new reader default', createRuntime, undefined, false],
    ['new reader enabled', createRuntime, { console: true }, true],
    ['new reader disabled', createRuntime, { console: false }, false],
  ]) {
    const events = [];
    const rt = await make({ device, console: (e) => events.push(e), consoleBytes: 256 });
    const program = rt.load(manifest, options);
    check(program.recording === records, `${label}: recording policy`);
    const output = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const staging = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const pipeline = await program.compute('main');
    const frame = rt.frame();
    frame.dispatch(pipeline, { out: output }, 1);
    const result = await frame.submit();
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(output, 0, staging, 0, 4);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const value = new Float32Array(staging.getMappedRange())[0];
    staging.unmap();
    output.destroy();
    staging.destroy();
    check(value === 7.25, `${label}: actual GPU result`);
    check(
      JSON.stringify(events.map((e) => [e.method, e.args, e.invocation])) ===
        JSON.stringify(records ? [['log', ['retained', 0, 7.25], [0, 0, 0]]] : []),
      `${label}: decoded GPU events`,
    );
    check(
      JSON.stringify(result.console) ===
        JSON.stringify(records ? [{ entry: 'main', lines: 1, dropped: 0 }] : []),
      `${label}: actual submit counts`,
    );
    rt.destroy();
  }
  const rt = await createRuntime({ device });
  check(
    rt.load(enabled).recording && !rt.load(enabled, { console: false }).recording,
    'legacy enabled builds retain their defaults and explicit disable',
  );
  const historical = { ...manifest };
  delete historical.variants;
  let refused = false;
  try {
    rt.load(historical, { console: true });
  } catch (e) {
    refused = e instanceof TypeError && e.message.includes('no recorded variant');
  }
  check(refused, 'a stripped historical manifest refuses explicit recording without IR');
  rt.destroy();
  await device.queue.onSubmittedWorkDone();
  check(errors.length === 0, `no GPU validation errors: ${errors.join('; ')}`);
  device.destroy();
  return checks;
}
globalThis.consoleVariantResult = run().then(
  (checks) => ({ checks }),
  (e) => ({ error: String(e) }),
);
