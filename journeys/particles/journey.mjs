// The host half of the particle journey, as its author would write it: the particles are plain
// objects and the simulation's settings one more, handed to `step` as they are, once per frame for
// 20 frames; and the same simulation stepped in plain JavaScript. Nothing is packed: the kernel
// function takes host values (change 0013, surface §65).

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
  title: 'A particle system stepped once per frame, as a loop',
  runs: [
    {
      kind: 'kernel',
      shader: 'particles.shade.ts',
      fn: 'step',
      // The kernel function's arguments, in its parameters' order.
      args: {
        particles: particles.map((p) => ({ pos: [...p.pos], vel: [...p.vel] })),
        sim,
      },
      repeat: FRAMES,
      read: 'particles',
      flatten: (ps) => ps.flatMap((p) => [...p.pos, ...p.vel]),
      expected: simulate,
      tolerance: 1e-4,
    },
  ],
};
