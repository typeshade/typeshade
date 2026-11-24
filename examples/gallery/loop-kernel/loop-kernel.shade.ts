"use typeshade";

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
