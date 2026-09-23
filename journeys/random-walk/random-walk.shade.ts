"use typeshade";

// A random walk, written the way a TypeScript developer writes one: a class that keeps a
// generator's state and advances it in the method that returns each draw, a walker whose getter
// says how far it went and whose method is handed the step to take, arrow functions that draw
// from the generator and move the walker they close over, and no return type where the body
// says it.

class Random {
  seed: u32;

  constructor(seed: u32) {
    this.seed = seed;
  }

  /** The next draw, uniform in [0, 1). */
  next() {
    this.seed = this.seed * 1664525 + 1013904223;
    return f32(this.seed >> 8) / 16777216;
  }
}

class Walker {
  x: f32 = 0;
  y: f32 = 0;

  get dist() {
    return sqrt(this.x * this.x + this.y * this.y);
  }

  /** Takes sixteen steps, handing each its number. */
  sixteen(step: (i: i32) => void) {
    for (let i = 0; i < 16; i++) {
      step(i);
    }
  }
}

class Params {
  stride: f32;
  bias: f32;
}

declare const params: uniform<Params>;
declare let out: storage<array<f32>>;

@compute([64])
export function walk(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x * 3 >= out.length) {
    return;
  }
  let rng = new Random(gid.x + 1);
  let w = new Walker();
  const draw = (scale: f32) => (rng.next() - 0.5) * scale;
  w.sixteen((i) => {
    w.x += draw(params.stride) + params.bias;
    w.y += draw(params.stride) * f32(i % 2);
  });
  out[gid.x * 3] = w.x;
  out[gid.x * 3 + 1] = w.y;
  out[gid.x * 3 + 2] = w.dist;
}
