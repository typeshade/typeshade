// The host half of the particle journey, as its author would write it: pack the particles the
// way WGSL lays them out (two vec4 per particle, 32 bytes), pack the uniform (four f32), run
// the kernel once per frame for 20 frames, and step the same simulation in plain JavaScript.

const COUNT = 200;
const FRAMES = 20;
const sim = { dt: 1 / 30, gravity: 9.8, floor: 0, bounce: 0.6 };

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
const particles = Array.from({ length: COUNT }, () => ({
  pos: [rnd() * 10 - 5, rnd() * 3, rnd() * 10 - 5, 1],
  vel: [rnd() * 2 - 1, rnd() * 4, rnd() * 2 - 1, 0],
}));

/** The simulation in JavaScript, one frame at a time, with f32 rounding where the GPU has it. */
function simulate() {
  const f = Math.fround;
  const out = particles.map((p) => ({ pos: p.pos.map(f), vel: p.vel.map(f) }));
  for (let frame = 0; frame < FRAMES; frame++) {
    for (const p of out) {
      p.vel[1] = f(p.vel[1] - f(f(sim.gravity) * f(sim.dt)));
      for (let a = 0; a < 3; a++) p.pos[a] = f(p.pos[a] + f(p.vel[a] * f(sim.dt)));
      if (p.pos[1] < sim.floor) {
        p.pos[1] = sim.floor;
        p.vel[1] = f(-p.vel[1] * f(sim.bounce));
      }
    }
  }
  return out.flatMap((p) => [...p.pos, ...p.vel]);
}

export default {
  title: 'A particle system stepped once per frame',
  runs: [
    {
      kind: 'compute',
      shader: 'particles.shade.ts',
      entry: 'step',
      workgroups: [Math.ceil(COUNT / 64), 1, 1],
      repeat: FRAMES,
      bindings: {
        sim: {
          gpu: new Float32Array([sim.dt, sim.gravity, sim.floor, sim.bounce]),
          cpu: sim,
        },
        particles: {
          gpu: new Float32Array(particles.flatMap((p) => [...p.pos, ...p.vel])),
          cpu: particles.map((p) => ({ pos: [...p.pos], vel: [...p.vel] })),
        },
      },
      read: 'particles',
      // The CPU module holds an array of structs; the GPU buffer holds their floats in order.
      flattenCpu: (value) => value.flatMap((p) => [...p.pos, ...p.vel]),
      expected: simulate,
      tolerance: 1e-4,
    },
  ],
};
