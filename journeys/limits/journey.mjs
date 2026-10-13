// The limits journey (change 0051, the program runtime's device limits). The first half shows
// WebGPU's default device refusing an entry of nine storage buffers, by name (R4). The second half
// runs the entry on a device the runtime requests with the limit the entry needs. It runs only
// where the adapter allows nine storage buffers per stage. On the headless Chromium of the gate
// (SwiftShader) the adapter allows eight, so the harness reports the second half as not run.

const SIZE = 256;

export default {
  title:
    'Device limits: a default device refuses nine storage buffers by name, a requested one runs them',
  runs: [
    {
      kind: 'limits',
      host: 'limits.mjs',
      program: 'nine.shade.ts',
      need: 9,
      size: SIZE,
      // What the default device says. `have` is its own maxStorageBuffersPerShaderStage.
      refusal: (have) =>
        new RegExp(
          `^The entry "main" \\(nine\\.shade\\.ts:\\d+\\) needs maxStorageBuffersPerShaderStage 9; this device has ${have}\\. Request the limit in requestDevice`,
        ),
      // Element i is the sum of i + k over k = 0 to 7: 8 i + 28, exact in f32 at this size.
      expected: () => Array.from({ length: SIZE }, (_, i) => 8 * i + 28),
      tolerance: 0,
    },
  ],
};
