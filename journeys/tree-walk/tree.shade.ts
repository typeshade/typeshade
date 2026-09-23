"use typeshade";

// A tree stored as an array: each invocation sums the values under one root with an explicit
// stack, the way a BVH is walked (`while (sp > 0)`), then refines a square root by Newton's
// method until it settles (`while (true)` with a `break`). A second entry strides over the
// values to a count the host sets. Three loops over data, none of them bounded by a constant
// (Rule 7.5, #209).

class Params {
  count: u32;
  roots: u32;
}

declare const params: uniform<Params>;
declare const values: storage<array<f32>>;
declare const sums: storage<array<f32>, "read_write">;
declare const partial: storage<array<f32>, "read_write">;

@compute([64])
export function subtree(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x >= params.roots) {
    return;
  }
  let stack: array<u32, 32> = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let sp: u32 = 1;
  stack[0] = gid.x;
  let total = 0;
  while (sp > 0) {
    sp -= 1;
    const node = stack[sp];
    total += values[node];
    const left = node * 2 + 1;
    if (left < params.count) {
      stack[sp] = left;
      sp += 1;
    }
    if (left + 1 < params.count) {
      stack[sp] = left + 1;
      sp += 1;
    }
  }
  sums[gid.x] = sqrtNewton(total);
}

function sqrtNewton(x: f32): f32 {
  const a = max(x, 0);
  let r = max(a, 1);
  while (true) {
    const next = 0.5 * (r + a / r);
    if (abs(next - r) < 0.0001) {
      break;
    }
    r = next;
  }
  return r;
}

@compute([64])
export function strided(@builtin("local_invocation_index") lid: u32) {
  let s = 0;
  for (let i = lid; i < params.count; i += 64) {
    s += values[i];
  }
  partial[lid] = s;
}
