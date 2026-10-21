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

// A map that skips an element: on WebGL2 (Rule 11.8) the skipped texel keeps what the array held.
export function scaleNonNegative(xs: array<f32>, out: array<f32>, a: f32) {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] < 0.) {
      continue;
    }
    out[i] = xs[i] * a;
  }
}

// An array's length read inside an iteration is the host's (#367). The call bound each buffer
// padded to 16 bytes, so on WebGPU five `u32`s were an array of 8 to `out.length`, and
// `% bins.length` over five bins lost the counts that belonged to the fifth and past it.
export function stamp(out: array<u32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = out.length;
  }
}

export function countMod(ks: array<u32>, bins: array<u32>) {
  for (let i: u32 = 0; i < ks.length; i++) {
    bins[ks[i] % bins.length] += 1;
  }
}

// A kernel function that reads an image and stores into a texture a device made (change 0077):
// each texel once, at vec2u(i % w, i / w), its colour inverted and its alpha kept.
export function invertImage(
  src: texture_2d<f32>,
  dst: texture_storage_2d<"rgba8unorm", "write">,
  w: u32,
  h: u32,
) {
  for (let i: u32 = 0; i < w * h; i++) {
    const c = textureLoad(src, vec2u(i % w, i / w), 0);
    textureStore(dst, vec2u(i % w, i / w), vec4(1.0 - c.rgb, c.a));
  }
}

// An array's methods (change 0079): on a kernel function's array each is the loop it stands
// for, so each runs on WebGPU as the for loop would. `reduce` with `+` folds in the tree order,
// `findIndex` is a `min` of the index where the predicate holds, its `Last` form a `max`, and
// `some` and `includes` an `|`.
export function methodStats(xs: array<f32>, t: f32): vec4 {
  const n = xs.reduce((a, x) => a + select(0., 1., x > t), 0.);
  return vec4(
    n,
    f32(xs.findIndex((x) => x > t)),
    f32(xs.findLastIndex((x) => x > t)),
    xs.some((x) => x > t) ? 1. : 0.,
  );
}

export function methodFill(xs: array<f32>, out: array<f32>, v: f32) {
  out.fill(v);
  xs.forEach((x, i) => {
    if (x > v) {
      out[i] = x;
    }
  });
}

export function methodSearch(ys: array<i32>, v: i32): vec4 {
  return vec4(f32(ys.indexOf(v)), f32(ys.lastIndexOf(v)), ys.includes(v) ? 1. : 0., 0.);
}

// A loop that pushes (change 0078): on WebGPU it counts, scans and stores, and the elements land
// in the order of the iterations, as on the CPU tier. `out.length` is the count appended, which
// may exceed the capacity the host array gives.
export function pushAbove(xs: array<f32>, t: f32, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      out.push(i);
    }
  }
  return out.length;
}

export function pushPairs(xs: array<u32>, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] % 3 == 0) {
      out.push(xs[i]);
      out.push(i);
    }
  }
  return out.length;
}
