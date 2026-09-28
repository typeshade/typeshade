"use typeshade";

/* @example
{
  "title": "A loop that runs as a kernel",
  "blurb": "The roadmap's terrain: `render` loops over every texel of `out`, an array with no size, so it is a kernel function (Rule 8.22). The compiler proves its iterations independent, and a host that imports it calls `await render(k, 512, img)`: each loop runs on WebGPU, one invocation per iteration, and fills `img` in place, with no `@compute`, binding or `global_invocation_id` written. Where there is no WebGPU it runs on the CPU tier.",
  "renderable": false,
  "reason": "no entry point"
}
*/

// A kernel function is an exported function that takes an array with no size. Each `for` at the
// top of its body is a candidate loop, and one whose iterations touch only their own elements
// (here `out[i]`) runs on the GPU. `height` is an ordinary helper: a host calls it on the CPU,
// and the kernel's loop calls it on the GPU.

export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}

export function render(k: vec4, size: u32, out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}
