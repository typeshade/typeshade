"use typeshade";

// Optional values (Rule 7.10, change 0088), as an author writes them: a result that may be
// absent, a test of it, a fallback, a callback that returns one, and a narrowed local.

class Hit {
  t: f32;
  side: i32;
}

declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;

/** The square root, or nothing below zero. */
function root(x: f32): f32 | undefined {
  if (x < 0.) {
    return undefined;
  }
  return sqrt(x);
}

/** Half of a positive value; the result is inferred as `f32 | undefined`. */
function halfOf(x: f32) {
  if (x <= 0.) {
    return undefined;
  }
  return x * 0.5;
}

/** A curve's value where it has one, or `fallback`. */
function sampleOr(f: (x: f32) => f32 | undefined, x: f32, fallback: f32): f32 {
  const v = f(x);
  if (v === undefined) {
    return fallback;
  }
  return v;
}

function plain(x: f32): f32 {
  return x + 100.;
}

/** A hit for a value at or above one, or nothing. */
function hitOf(x: f32): Hit | undefined {
  if (x < 1.) {
    return undefined;
  }
  const h = new Hit();
  h.t = x - 1.;
  h.side = x >= 4. ? 1 : -1;
  return h;
}

/** The nearer of two optional distances. */
function nearest(a: f32 | undefined, b: f32 | undefined): f32 {
  if (a !== undefined && b !== undefined) {
    return min(a, b);
  }
  return a ?? b ?? -1.;
}

/** The journey's value for `x`: every form in one expression, so the CPU oracle can call it. */
export function value(x: f32): f32 {
  // A local declared with no initializer starts absent; one path gives it a value.
  let bonus: f32 | undefined;
  if (x > 2.) {
    bonus = 10.;
  }
  const h = hitOf(x);
  const r = root(x) ?? -100.;
  const s = sampleOr(root, x - 1., 0.5) + sampleOr(plain, x, 0.);
  const n = nearest(halfOf(x), root(x - 3.));
  const side = f32(h?.side ?? 0);
  const t = h?.t ?? 1000.;
  return r + s + n + side * 0.125 + t * 0.001 + (bonus ?? 0.) + (h === undefined ? 0.5 : 0.);
}

@compute([64])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(xs)) {
    return;
  }
  out[gid.x] = value(xs[gid.x]);
}
