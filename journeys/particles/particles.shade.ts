"use typeshade";

// A particle system, the first compute shader most people write: each iteration integrates one
// particle under gravity and bounces it off the floor. It is written as a loop over the
// particles (change 0013): no @compute, no global_invocation_id, no binding and no packing. The
// compiler proves the iterations independent, so a host that imports it runs the loop on the
// GPU, one invocation per particle, once per frame.

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

export function step(particles: array<Particle>, sim: Sim) {
  for (let i: u32 = 0; i < particles.length; i++) {
    const p = particles[i];
    let pos: vec3 = p.pos.xyz;
    let vel: vec3 = p.vel.xyz;
    vel = vel + vec3(0, -sim.gravity * sim.dt, 0);
    pos = pos + vel * sim.dt;
    if (pos.y < sim.floor) {
      pos.y = sim.floor;
      vel.y = -vel.y * sim.bounce;
    }
    particles[i] = { pos: vec4(pos, 1), vel: vec4(vel, 0) };
  }
}
