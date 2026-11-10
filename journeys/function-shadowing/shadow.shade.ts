"use typeshade";
interface Frame { value: f32; }
declare const u: uniform<Frame>;
declare const out: storage<array<f32>, "read_write">;
const K: f32 = 50.;

function local(): f32 {
  const u = vec2(3., 4.);
  return u.x + u.y;
}
function parameter(u: f32): f32 { return u + 1.; }
function captured(K: f32): f32 {
  function add(): f32 { K = K + 2.; return K; }
  K = K + 1.;
  return add() + K;
}
@compute([1, 1, 1])
export function main(): void {
  out[0] = local();
  out[1] = parameter(2.);
  out[2] = captured(3.);
  out[3] = u.value + K;
}
