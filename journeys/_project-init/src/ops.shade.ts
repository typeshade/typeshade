"use typeshade";

export function twice(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i] * 2.; }
}

// Shared diagnostics accept shader decorators; ordinary tsc is not the shader checker.
@compute([1])
export function empty(@builtin("global_invocation_id") id: vec3u) {}
