// Call a shader's helper on the CPU, and draw with the same function on the GPU (surface §64).
//
// `height` is an ordinary function of the module. The draw runs it for each pixel on the GPU;
// the host calls it on the CPU, at `f32` precision, for the one value it needs.
import { fs, height } from './host-helper.shade.ts';

/** Draw the terrain into `canvas`, and return the height under the pixel `cursor`. */
export async function run(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  cursor: readonly [number, number],
): Promise<number> {
  const { width, height: rows } = canvas;
  await fs(canvas, { view: { size: [width, rows] } });
  // The draw computed this pixel at its centre, so the host asks for the same point.
  return height([(cursor[0] + 0.5) / width, (cursor[1] + 0.5) / rows]);
}
