"use typeshade";

class Empty {}
class MathX {
  twice(x: f32): f32 { return x * 2.; }
}
class Scene extends MathX {
  sample(x: f32): f32 { return this.twice(x) + 1.; }
}
class Samples {
  before: f32;
  empty: Empty;
  entries: array<Empty, 2>;
  after: f32;
}

declare const samples: uniform<Samples>;
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;

export function empty(): Empty { return new Empty(); }

@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(xs)) { return; }
  const scene = new Scene();
  out[gid.x] = scene.sample(xs[gid.x]) + samples.before + samples.after;
}
