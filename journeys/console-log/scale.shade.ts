"use typeshade";

// A kernel that says what it is doing, the way a TypeScript developer says it: console.log with
// a label and the values, and a warning from a helper when a value is large. The host compiles
// it with `console: 'gpu'`, and the lines come back from WebGPU as the CPU would print them.

class Sample {
  value: f32;
  scaled: vec2;
}

declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;

function doubled(v: f32): f32 {
  const s = v * 2.;
  if (s > 10.) {
    console.warn("large value", s);
  }
  return s;
}

@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(xs)) {
    return;
  }
  const x = xs[gid.x];
  const sample: Sample = { value: x, scaled: vec2(x, x * 0.5) };
  console.log("i =", gid.x, sample, x > 1.);
  out[gid.x] = doubled(x);
}
