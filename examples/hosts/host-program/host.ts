// Run a module's compiled program on the program runtime, as an engine does (surface §69, Rules
// 11.10 and 11.11).
//
// A shader module's default export is its manifest: the WGSL, the GLSL ES 3.00 programs, and each
// binding with its layout. `typeshade/runtime` loads it on WebGPU, or on WebGL2, and makes the
// pipelines; the host records frames and binds values by name.
import { runtime } from 'typeshade/runtime';
import program from './host-program.shade.ts';

/** Draw a frame into a `width` by `height` texture at each of `times`, then read it back:
 *  RGBA, one byte to a channel, the top row first. */
export async function run(
  width = 32,
  height = 32,
  times: readonly number[] = [0, 0.5, 1.25],
): Promise<Uint8Array> {
  const rt = await runtime(); // the default runtime: WebGPU, or WebGL2
  const pipeline = await rt.load(program).render({ targets: ['rgba8unorm'] });
  const target = rt.texture({ size: [width, height], format: 'rgba8unorm' });
  for (const time of times) {
    const frame = rt.frame();
    frame.pass({ color: [target] }, (pass) =>
      pass.draw(pipeline, { sky: { size: [width, height], time } }, { count: 3 }),
    );
    await frame.submit();
  }
  const pixels = await target.read(); // the last frame
  target.destroy();
  return pixels;
}
