"use typeshade";

// Which points lie inside a box, tested the way a TypeScript developer tests it: the point and
// the box's corners are vectors, `box.lo <= p` compares them component by component, and `all`
// asks whether every component agrees. They are vectors of doubles because the box sits near
// 1e7, where an f32 has no bits left below 1: its quarter-unit margins exist only in the double.

class Box {
  lo: vec3f64;
  hi: vec3f64;
}

declare const box: uniform<Box>;
declare const points: storage<array<vec3f64>>;
declare const inside: storage<array<f32>, "read_write">;

@compute([64])
export function test(@builtin("global_invocation_id") gid: vec3u) {
  const i = gid.x;
  if (i >= inside.length) {
    return;
  }
  const p = points[i];
  inside[i] = all(box.lo <= p) && all(p <= box.hi) ? 1. : 0.;
}
