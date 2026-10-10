// Browser-only WebGL2 backend for the same MNIST TypeShade pack used by WebGPU.
// WebGL2 has no native compute shaders: the runtime executes Pack.gl.computes
// through generated GLSL ES 3.00 passes. This is intentionally not a CPU fallback.
import { createRuntime, resident } from '../../src/runtime.ts';

const ENTRY_NAMES = ['forward', 'objective', 'reduce', 'backward', 'update'];

export async function webgl2Backend(host, pack) {
  for (const name of ENTRY_NAMES) {
    const lowered = pack.gl?.computes?.[name];
    if (lowered === undefined || 'none' in lowered)
      throw new Error(
        `MNIST entry "${name}" cannot run on WebGL2: ${lowered?.none ?? 'no pass program'}`,
      );
  }

  const rt = await createRuntime({ prefer: ['webgl2'], programs: [pack] });
  if (rt.tier !== 'webgl2') throw new Error(`Unexpected MNIST tier: ${rt.tier}`);
  const program = rt.load(pack);
  const pipelines = {};
  const bindings = Object.fromEntries(
    Object.entries(host).map(([name, value]) => [name, resident(value)]),
  );
  try {
    for (const name of ENTRY_NAMES) pipelines[name] = await program.compute(name);
  } catch (error) {
    for (const value of Object.values(bindings)) value.destroy();
    rt.destroy();
    throw error;
  }

  const gl = rt.device;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const info = {
    version: gl.getParameter(gl.VERSION),
    vendor: gl.getParameter(gl.VENDOR),
    renderer: gl.getParameter(gl.RENDERER),
    unmaskedVendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : undefined,
    unmaskedRenderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : undefined,
  };

  let submissions = 0;
  let disposed = false;
  return {
    tier: rt.tier,
    info,
    transfers: {
      label: 'WebGL2 pass emulation; device memory/transfer counters not instrumented',
    },
    setBatch(pixels, labels) {
      host.pixels.fill(0);
      host.pixels.set(pixels);
      host.labels.fill(0);
      host.labels.set(labels);
      bindings.pixels.write(host.pixels);
      bindings.labels.write(host.labels);
    },
    async dispatch(entry, batch) {
      if (disposed) throw new Error('WebGL2 MNIST backend already destroyed');
      if (!ENTRY_NAMES.includes(entry)) throw new Error(`Unknown MNIST entry: ${entry}`);
      const workgroups =
        entry === 'reduce'
          ? 1
          : entry === 'backward' || entry === 'update'
            ? Math.ceil(7840 / 64)
            : Math.ceil(batch.count / 64);
      const values = { ...bindings, batch };
      const reached = Object.fromEntries(
        pack.entries
          .find((item) => item.name === entry)
          .bindings.map(({ name }) => [name, values[name]]),
      );
      const frame = rt.frame();
      frame.dispatch(pipelines[entry], reached, workgroups);
      await frame.submit();
      submissions++;
    },
    async read(name) {
      if (!Object.hasOwn(bindings, name)) throw new Error(`Unknown MNIST binding: ${name}`);
      return bindings[name].read();
    },
    telemetry() {
      return { submissions, tier: rt.tier, ...info };
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      for (const value of Object.values(bindings)) value.destroy();
      rt.destroy();
    },
  };
}
