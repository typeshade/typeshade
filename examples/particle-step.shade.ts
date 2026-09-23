"use typeshade"

/* @example
{
  "title": "Methods that change their object",
  "blurb": "A `class Particle` whose `step`, `bounce` and `tick` assign to `this`, called on a storage element: each takes and returns the struct and the call statement writes the receiver back, `ps[gid.x] = Particle_tick(ps[gid.x], dt)` (§26). WGSL-only: a storage buffer and a compute stage have no WebGL2 form.",
  "renderable": false,
  "reason": "missing capabilities: storageBuffer, compute"
}
*/

// Methods that change their object (design #86 step 2, §26): a `class Particle` whose `step`,
// `bounce` and `tick` assign to `this`, called on a storage element. Each such method takes and
// returns the struct (`Particle_step(self_in: Particle, dt: f32) -> Particle`), and the call
// statement writes the receiver back: `ps[gid.x].tick(dt)` is
// `ps[gid.x] = Particle_tick(ps[gid.x], dt)`. `tick` calls `step` and `bounce` on `this`, which
// is what makes it a changing method too. `speed` reads its object and keeps the plain
// parameter. WGSL-only: a storage buffer and a compute stage have no WebGL2 form.

declare const ps: storage<array<Particle>, "read_write">
declare const delta: uniform<f32>

class Particle {
  pos: vec2
  vel: vec2
  age: u32 = 0
  step(dt: f32): void {
    this.pos = this.pos + this.vel * dt
    this.age++
  }
  bounce(): void {
    if (this.pos.y < 0.) {
      this.pos.y = -this.pos.y
      this.vel.y = -this.vel.y * 0.8
    }
  }
  tick(dt: f32): void {
    this.step(dt)
    this.bounce()
  }
  speed(): f32 {
    return length(this.vel)
  }
}

@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= u32(ps.length)) {
    return
  }
  ps[gid.x].tick(delta)
  if (ps[gid.x].speed() < 0.01) {
    ps[gid.x].vel = vec2(0., 0.)
  }
}
