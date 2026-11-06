"use typeshade";

// The position keeps the f64 arithmetic non-constant. The float flavor reaches the runtime's
// guard, while the integer flavor needs none; neither entry asks its host for a binding.
export const guarded = fragment(function guarded(p: builtin<"position", vec4>): vec4 {
  const x: f64 = 12345.678 + f64(p.x) * 0.000001;
  return vec4(f32(fract(x * 1000.)), p.y / 32., 0., 1.);
});
