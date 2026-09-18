struct Particle {
  pos: vec2<f32>,
  vel: vec2<f32>,
  age: u32,
}

@group(0) @binding(0) var<storage, read_write> ps: array<Particle>;
@group(0) @binding(1) var<uniform> delta: f32;

fn Particle_step(self_: ptr<storage, Particle, read_write>, dt: f32) {
  (*self_).pos = ((*self_).pos + ((*self_).vel * dt));
  (*self_).age += 1u;
}

fn Particle_bounce(self_: ptr<storage, Particle, read_write>) {
  if (((*self_).pos.y < 0.0)) {
    (*self_).pos.y = (-(*self_).pos.y);
    (*self_).vel.y = ((-(*self_).vel.y) * 0.8);
  }
}

fn Particle_tick(self_: ptr<storage, Particle, read_write>, dt: f32) {
  Particle_step(self_, dt);
  Particle_bounce(self_);
}

fn Particle_speed(self_: Particle) -> f32 {
  return length(self_.vel);
}

fn Particle_new() -> Particle {
  let _cse0 = vec2<f32>(0.0, 0.0);
  var self_: Particle = Particle(_cse0, _cse0, 0u);
  self_.age = 0u;
  return self_;
}

@compute @workgroup_size(64)
fn k(@builtin(global_invocation_id) gid: vec3<u32>) {
  if ((gid.x >= u32(arrayLength(&ps)))) {
    return;
  }
  Particle_tick(&ps[gid.x], delta);
  if ((Particle_speed(ps[gid.x]) < 0.01)) {
    ps[gid.x].vel = vec2<f32>(0.0, 0.0);
  }
}
