"use typeshade";

// Backend reserved words are ordinary TypeScript variable names (change 0032).
const target: f32 = 2.;
const target_: f32 = 3.;
const target_1: f32 = 4.;
let shared: f32 = 0.;

declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;

function remap(filter: f32): f32 {
  let discard = filter * target;
  shared = discard;
  return shared + target_ + target_1;
}

@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(xs)) { return; }
  const as = xs[gid.x];
  out[gid.x] = remap(as) + as;
}
