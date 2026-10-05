"use typeshade";

// A blur whose window, gain and clamping are fixed when its pipeline is made: overrides (surface
// §15), which the host sets by name for each pipeline it creates (surface §69). The window is a
// loop bound the driver can unroll for each pipeline, which a value read from a buffer in every
// invocation cannot be.

const radius: override<i32> = 1;
const gain: override<f32> = 1.;
const clamped: override<bool> = false;

declare const input: storage<array<f32>>;
declare const output: storage<array<f32>, "read_write">;

@compute([64])
export function blur(@builtin("global_invocation_id") gid: vec3u) {
  const n = i32(arrayLength(input));
  const i = i32(gid.x);
  if (i >= n) {
    return;
  }
  let sum = 0.;
  for (let k = -radius; k <= radius; k++) {
    sum += input[clamp(i + k, 0, n - 1)];
  }
  let v = gain * sum / f32(2 * radius + 1);
  if (clamped) {
    v = min(v, 1.);
  }
  output[gid.x] = v;
}
