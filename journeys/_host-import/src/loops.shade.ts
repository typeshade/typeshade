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

// Reductions (Rule 7.2): a sum is combined in the tree order, 256 at a time and then the
// partials the same way, on the GPU and on the CPU alike, so both give the same bits.
export function stats(xs: array<f32>, scaled: array<f32>, k: f32): vec3 {
  let sum = 0.;
  let top = -1e30;
  for (let i: u32 = 0; i < xs.length; i++) {
    scaled[i] = xs[i] * k;
    sum += xs[i];
    top = max(top, xs[i]);
  }
  return vec3(sum, top, sum / f32(xs.length));
}

export function tally(xs: array<i32>): i32 {
  let n: i32 = 0;
  for (const x of xs) {
    n += x;
  }
  return n;
}

// A scatter: two iterations may add to the same bin, so each add is an atomic on the GPU, which
// is exact in any order for an integer.
export function histogram(xs: array<f32>, bins: array<u32>, lo: f32, scale: f32) {
  const top = bins.length - 1;
  for (let i: u32 = 0; i < xs.length; i++) {
    const k = min(u32(max((xs[i] - lo) * scale, 0.)), top);
    bins[k] += 1;
  }
}
