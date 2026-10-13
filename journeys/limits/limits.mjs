// The limits journey's host (change 0051): the runtime's device limits on its public exports
// alone. It calls nothing on a WebGPU object, and the harness fails the journey on any other
// import or any WebGPU call in this file.
//
// `refused` runs the entry on the device the host gives: WebGPU's default device, which binds
// eight storage buffers per stage. The runtime refuses the entry before it calls WebGPU (R4).
// `requested` runs the entry on a device that `createRuntime({ programs })` requests. The runtime
// asks the adapter for the nine storage buffers the entry needs, so it runs only where the adapter
// allows them.

import { createRuntime, resident } from 'typeshade/runtime';

/** The runtime's refusal of `program`'s entry `main` on `device`, or `null` when it runs. */
export async function refused({ device, program }) {
  const rt = await createRuntime({ device });
  try {
    await rt.load(program).compute('main');
    return null;
  } catch (e) {
    return e.message;
  }
}

/** Eight arrays of `size` numbers, summed into `out`, on a device the runtime requests for
 *  `program`. Returns `out`, read back. */
export async function requested({ program, size }) {
  const rt = await createRuntime({ programs: [program] });
  const pipeline = await rt.load(program).compute('main');
  const inputs = {};
  for (let k = 0; k < 8; k++) {
    inputs[`a${k}`] = Float32Array.from({ length: size }, (_, i) => i + k);
  }
  const out = resident(new Float32Array(size));
  const f = rt.frame();
  f.dispatch(pipeline, { ...inputs, out }, [size / 64, 1, 1]);
  await f.submit();
  return [...(await out.read())];
}
