"use typeshade";

/* @example
{
  "title": "A loop over an array of structs",
  "blurb": "The particle step as a loop over `array<Particle>`: each iteration reads and writes only its own particle, so the loop runs on the GPU, one invocation per particle. A host passes an array of plain objects, `{ pos: [x, y, z, w], vel: [...] }`, and gets it back updated in place, or keeps it on the device across frames with `resident(ps)`.",
  "renderable": false,
  "reason": "no entry point"
}
*/

class Particle {
  pos: vec4;
  vel: vec4;
}

// One frame: gravity, then a bounce off the floor at y = 0 that keeps 80% of the speed.
export function step(ps: array<Particle>, dt: f32) {
  const g = vec4(0., -9.8, 0., 0.) * dt;
  for (let i: u32 = 0; i < ps.length; i++) {
    let v = ps[i].vel + g;
    let p = ps[i].pos + v * dt;
    if (p.y < 0.) {
      p.y = -p.y;
      v.y = -v.y * 0.8;
    }
    ps[i].pos = p;
    ps[i].vel = v;
  }
}
