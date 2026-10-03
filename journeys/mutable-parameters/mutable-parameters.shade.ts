"use typeshade";

class Painter {
  gain: f32 = 2.;
  shade(col: vec3): vec3 {
    const original = col;
    const brighten = (): void => { col += vec3(0.125); };
    brighten();
    col *= this.gain;
    return original + col;
  }
}

declare const out: storage<array<f32>, "read_write">;

@compute([1])
export function paint(@builtin("global_invocation_id") gid: vec3u) {
  const col = vec3(f32(gid.x) / 8., 0.25, 0.5);
  const painter = new Painter();
  const result = painter.shade(col);
  out[gid.x * 4] = result.x;
  out[gid.x * 4 + 1] = result.y;
  out[gid.x * 4 + 2] = result.z;
  out[gid.x * 4 + 3] = col.x;
}
