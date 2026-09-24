"use typeshade";

// Kernel functions a host file calls through the import (change 0013): loops over arrays, which
// run on the GPU, one invocation per iteration, because the compiler proves their iterations
// independent. No @compute, no binding, no global_invocation_id.

export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}

export function render(k: vec4, size: u32, out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}

class Particle {
  pos: vec4;
  vel: vec4;
}

export function drift(ps: array<Particle>, dt: f32) {
  const g = vec4(0., -9.8, 0., 0.) * dt;
  for (let i: u32 = 0; i < ps.length; i++) {
    ps[i].vel = ps[i].vel + g;
    ps[i].pos = ps[i].pos + ps[i].vel * dt;
  }
}

export function odds(out: array<f32>, n: i32) {
  for (let i = n - 1; i >= 0; i--) {
    if (i % 2 === 0) {
      continue;
    }
    out[i * 3] = 1.;
    out[i * 3 + 1] = 2.;
    out[i * 3 + 2] = f32(i);
  }
}
