"use typeshade";

declare const out: storage<array<f32>, "read_write">;
class Counter { static hits = 0.; }
class Point {
  constructor(public x: f32) {}
  get pair(): array<f32, 2> {
    Counter.hits += 1.;
    return array(this.x, this.x + 1.);
  }
}
function values(x: f32): array<f32, 3> {
  Counter.hits += 1.;
  return array(x, x + 1., x + 2.);
}
@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x >= 64) { return; }
  Counter.hits = 0.;
  const x = f32(gid.x);
  const [first, , last] = values(x);
  let [copy] = [x, x + 1.];
  copy += 10.;
  const [i, j]: [u32, u32] = [gid.x, 2];
  const [{ x: one }, { pair: [p, q] }] = array(new Point(x), new Point(x + 1.));
  function captured(): f32 { return one + p; }
  const [] = values(x);
  const offset = gid.x * 8;
  out[offset] = first;
  out[offset + 1] = last;
  out[offset + 2] = copy;
  out[offset + 3] = f32(i + j);
  out[offset + 4] = one;
  out[offset + 5] = captured();
  out[offset + 6] = q;
  out[offset + 7] = Counter.hits;
}
