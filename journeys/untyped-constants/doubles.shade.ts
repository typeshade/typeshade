"use typeshade";

// Change 0134, item 2: a constant of no fixed type beside an f64 carries the full double, as
// the written number does. Before, each was the f32 value of the constant.

declare const src: storage<array<f64>, "read">;
declare const dst: storage<array<f64>, "read_write">;

const C = 0.1;
const K = 7;
const M = K / 3;

@compute([64])
export function evaluate(gid: builtin<"global_invocation_id">): void {
  if (gid.x >= src.length) return;
  const x = src[gid.x];
  const pick = gid.x % 3;
  if (pick == 0) {
    dst[gid.x] = x * C;
  } else if (pick == 1) {
    dst[gid.x] = x * (K / 3);
  } else {
    dst[gid.x] = x * M;
  }
}
