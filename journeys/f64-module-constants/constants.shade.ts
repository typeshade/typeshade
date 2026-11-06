"use typeshade";

// Change 0123: each value exercises a separate module-constant precision boundary.
const TENTH: f64 = 0.1;
const THIRD: f64 = f64(1 / 3);
const TAU: f64 = 2 * Math.PI;
const HALF_TAU: f64 = TAU / 2;
const ROOT: f64 = sqrt(f64(2));
const NARROW: f64 = f64(f32(0.1));
const PRIOR: f32 = 0.1;
const WIDE: f64 = f64(PRIOR);
const PRIOR_SINE: f32 = sin(0.1);
const WIDE_SINE: f64 = f64(PRIOR_SINE);
const NARROW_SINE: f64 = f64(sin(f32(0.1)));
const LARGE: f32 = 16777216;
const CANCELLED: f64 = f64((LARGE + 1) - LARGE);
const GAIN: f64 = 1 + 1 / 1073741824;

namespace Fractions {
  export const NEGATIVE: f64 = -1 / 3;
}

class Offsets {
  static BIAS: f64 = -0.125;
}

declare const src: storage<array<f64>>;
declare const dst: storage<array<f64>, "read_write">;

function coefficient(index: u32): f64 {
  if (index === 0) return TENTH;
  if (index === 1) return THIRD;
  if (index === 2) return TAU;
  if (index === 3) return HALF_TAU;
  if (index === 4) return ROOT;
  if (index === 5) return NARROW;
  if (index === 6) return WIDE;
  if (index === 7) return WIDE_SINE;
  if (index === 8) return NARROW_SINE;
  if (index === 9) return CANCELLED;
  if (index === 10) return Fractions.NEGATIVE;
  return Offsets.BIAS;
}

export const evaluate = compute([64], function evaluate(
  gid: builtin<"global_invocation_id", vec3u>,
): void {
  if (gid.x >= src.length) return;
  // A runtime multiply and add also exercise each flavor's emulation helpers.
  dst[gid.x] = src[gid.x] * GAIN + coefficient(gid.x % 12);
});
