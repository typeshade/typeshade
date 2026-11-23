"use typeshade";

// Step 8. A class groups data with methods. A function that writes its Ball changes the caller's Ball.
interface Frame {
  size: vec2;
  time: f32;
}

declare const frame: uniform<Frame>;

class Ball {
  constructor(
    public pos: vec2,
    readonly rise: f32,
    readonly radius: f32,
  ) {}

  bounce(time: f32): void {
    this.pos.y = this.radius - 0.8 + this.rise * abs(sin(3.0 * time + 4.0 * this.pos.x));
  }

  cover(p: vec2): f32 {
    return 1.0 - smoothstep(0.0, 0.01, length(p - this.pos) - this.radius);
  }
}

function drop(ball: Ball, time: f32): void {
  ball.bounce(time);
}

@fragment
export function fs(p: builtin<"position">): vec4 {
  const uv = (2.0 * p.xy - frame.size) / frame.size.y;
  const flipped = vec2(uv.x, -uv.y);
  const red = new Ball(vec2(-0.5, 0.0), 1.2, 0.2);
  const blue = new Ball(vec2(0.4, 0.0), 0.8, 0.15);
  drop(red, frame.time);
  drop(blue, frame.time);
  const a = red.cover(flipped);
  const b = blue.cover(flipped);
  return vec4(0.1 + 0.8 * a, 0.1 + 0.3 * a + 0.3 * b, 0.15 + 0.8 * b, 1.0);
}
