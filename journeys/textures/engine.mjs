// The textures journey's host (change 0028, Rule 11.11): a level in an r32float texture that the
// next pass only loads, beside two textures the same pass samples. It imports the runtime's
// public exports alone and calls nothing on a WebGPU object, as the harness holds every engine to.
//
// Each frame is four passes: the level, drawn into an r32float texture; `photo` and `glow`, each
// cleared to one colour; and the composition, which reads the three into the output. WebGPU
// refuses the composition's bind group when the layout says 'float' for `level`, and refuses its
// pipeline when it says 'unfilterable-float' for a texture the sampler reads.

import { createRuntime } from 'typeshade/runtime';

/** Make the scene on `device` for a square target of `size` pixels, and return what draws a
 *  frame at a time and what reads the last one back. */
export async function setup({ device, programs, size }) {
  const rt = await createRuntime({ device });
  const [fill, compose] = await Promise.all([
    rt.load(programs.fill).render({ targets: ['r32float'] }),
    rt.load(programs.compose).render({ targets: ['rgba8unorm'] }),
  ]);

  const level = rt.texture({ size: [size, size], format: 'r32float' });
  const photo = rt.texture({ size: [size, size], format: 'rgba8unorm' });
  const glow = rt.texture({ size: [size, size], format: 'rgba8unorm' });
  const out = rt.texture({ size: [size, size], format: 'rgba8unorm' });
  const smp = rt.sampler({ filter: 'linear' });

  return {
    /** Draw one frame, and resolve once the GPU has run it. */
    async frame() {
      const f = rt.frame();
      f.pass({ color: [level] }, (p) => p.draw(fill, {}, { count: 3 }));
      f.pass({ color: [{ target: photo, clear: [0, 0.5, 0, 1] }] }, () => {});
      f.pass({ color: [{ target: glow, clear: [0, 0, 0.25, 1] }] }, () => {});
      f.pass({ color: [out] }, (p) => p.draw(compose, { level, photo, glow, smp }, { count: 3 }));
      await f.submit();
    },
    /** The last frame's pixels, RGBA, top row first. */
    read: () => out.read(),
  };
}
