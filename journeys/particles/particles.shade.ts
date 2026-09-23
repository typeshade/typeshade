"use typeshade";

// A particle system, the first compute shader most people write: each invocation integrates
// one particle under gravity and bounces it off the floor. The host runs it once per frame.

class Particle {
  pos: vec4;
  vel: vec4;
}

class Sim {
  dt: f32;
  gravity: f32;
  floor: f32;
  bounce: f32;
}

declare const sim: uniform<Sim>;
declare const particles: storage<array<Particle>, "read_write">;

@compute([64])
export function step(@builtin("global_invocation_id") gid: vec3u) {
  if (gid.x >= particles.length) {
    return;
  }
  const p = particles[gid.x];
  let pos: vec3 = p.pos.xyz;
  let vel: vec3 = p.vel.xyz;
  vel = vel + vec3(0, -sim.gravity * sim.dt, 0);
  pos = pos + vel * sim.dt;
  if (pos.y < sim.floor) {
    pos.y = sim.floor;
    vel.y = -vel.y * sim.bounce;
  }
  particles[gid.x] = { pos: vec4(pos, 1), vel: vec4(vel, 0) };
}
