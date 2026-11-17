"use typeshade";

// ═══ typeshade/algorithms: copy, fill and the maps (change 0072, §72) ═══
//
// Each function is a kernel function (Rule 8.22) with one loop at `i` that writes every element
// of `out` (Rule 8.23), so a pooled array needs no zeroing and the planner fuses it with its
// neighbours (Rule 11.13). A unary map whose operation is a builtin's name is named `<op>Map`
// here, since a kernel function cannot carry a builtin's name (proposal 0072, Amendment 1); the
// host face `../index.ts` exports it under the builtin's name.

/** `out[i] = x[i]`. */
export function copy(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = x[i];
}

/** `out[i] = value`. */
export function fill(out: array<f32>, value: f32): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = value;
}

/** `out[i] = start + i * step`, with `i` converted to `f32` first. */
export function sequence(out: array<f32>, start: f32, step: f32): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = start + f32(i) * step;
}

/** `out[i] = a[i] + b[i]`. */
export function add(out: array<f32>, a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = a[i] + b[i];
}

/** `out[i] = a[i] - b[i]`. */
export function sub(out: array<f32>, a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = a[i] - b[i];
}

/** `out[i] = a[i] * b[i]`. */
export function mul(out: array<f32>, a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = a[i] * b[i];
}

/** `out[i] = a[i] / b[i]`. */
export function div(out: array<f32>, a: array<f32>, b: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = a[i] / b[i];
}

/** `out[i] = x[i] * k`. */
export function scale(out: array<f32>, x: array<f32>, k: f32): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = x[i] * k;
}

/** `out[i] = abs(x[i])`. The host face exports it as `abs`. */
export function absMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = abs(x[i]);
}

/** `out[i] = -x[i]`. The host face exports it as `neg`. */
export function negMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = -x[i];
}

/** `out[i] = sqrt(x[i])`. The host face exports it as `sqrt`. */
export function sqrtMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = sqrt(x[i]);
}

/** `out[i] = 1 / sqrt(x[i])`, the builtin `inverseSqrt`. The host face exports it as `rsqrt`. */
export function rsqrtMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = inverseSqrt(x[i]);
}

/** `out[i] = exp(x[i])`. The host face exports it as `exp`. */
export function expMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = exp(x[i]);
}

/** `out[i] = log(x[i])`. The host face exports it as `log`. */
export function logMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = log(x[i]);
}

/** `out[i] = exp(x[i]) - 1`, with a series where `|x| < 0.01`, where the subtraction would lose
 *  digits (TypeNN's formula). The host face exports it as `expm1`. */
export function expm1Map(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    const v = x[i];
    let y: f32 = 0.0;
    if (v > -0.01 && v < 0.01) {
      const square = v * v;
      y = v + square * (0.5 + v * (0.1666666667 + v * (0.0416666667 + v * 0.0083333333)));
    } else {
      y = exp(v) - 1.0;
    }
    out[i] = y;
  }
}

/** `out[i] = log(1 + x[i])`, with a series where `|x| < 0.01`, where the addition would lose
 *  digits (TypeNN's formula). The host face exports it as `log1p`. */
export function log1pMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    const v = x[i];
    let y: f32 = 0.0;
    if (v > -0.01 && v < 0.01) {
      const square = v * v;
      y = v - square * (0.5 - v * (0.3333333333 - v * (0.25 - v * 0.2)));
    } else {
      y = log(1.0 + v);
    }
    out[i] = y;
  }
}

/** `out[i] = floor(x[i])`. The host face exports it as `floor`. */
export function floorMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = floor(x[i]);
}

/** `out[i] = ceil(x[i])`. The host face exports it as `ceil`. */
export function ceilMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = ceil(x[i]);
}

/** `out[i] = round(x[i])`, to the nearest even at a half on every tier. The host face exports it
 *  as `round`. */
export function roundMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = round(x[i]);
}

/** `out[i] = sign(x[i])`: -1, 0 or 1. The host face exports it as `sign`. */
export function signMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = sign(x[i]);
}

/** `out[i] = sin(x[i])`. The host face exports it as `sin`. */
export function sinMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = sin(x[i]);
}

/** `out[i] = cos(x[i])`. The host face exports it as `cos`. */
export function cosMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = cos(x[i]);
}

/** `out[i] = tan(x[i])`. The host face exports it as `tan`. */
export function tanMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = tan(x[i]);
}

/** `out[i] = tanh(x[i])`. The host face exports it as `tanh`. */
export function tanhMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = tanh(x[i]);
}

/** `out[i] = 1 / (1 + exp(-x[i]))`, computed through `exp` of the non-positive side so that `exp`
 *  never overflows (TypeNN's formula). The host face exports it as `sigmoid`. */
export function sigmoidMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    const v = x[i];
    let y: f32 = 0.0;
    if (v >= 0.0) {
      y = 1.0 / (1.0 + exp(-v));
    } else {
      const e = exp(v);
      y = e / (1.0 + e);
    }
    out[i] = y;
  }
}

/** `out[i] = max(x[i], 0)`. The host face exports it as `relu`. */
export function reluMap(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = max(x[i], 0.0);
}

/** `out[i] = clamp(x[i], lo, hi)`. The host face exports it as `clip`. */
export function clipMap(out: array<f32>, x: array<f32>, lo: f32, hi: f32): void {
  for (let i: u32 = 0; i < out.length; i++) out[i] = clamp(x[i], lo, hi);
}
