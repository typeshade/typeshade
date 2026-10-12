// Draw a full-screen fragment entry into a canvas (surface §67, Rule 8.24).
//
// The import is the shader module itself: the Vite plugin (`typeshade/vite`) turns `fs` into a
// function that draws one frame. The first draw into a canvas picks its tier: WebGPU, then
// WebGL2, then the CPU tier, which paints the frame pixel by pixel.
import { fs } from './host-draw.shade.ts';

/** Draw one frame at `time` seconds. The promise resolves when the frame is submitted. */
export function draw(canvas: HTMLCanvasElement | OffscreenCanvas, time: number): Promise<void> {
  return fs(canvas, { frame: { time, size: [canvas.width, canvas.height] } });
}

/** Animate `canvas`: a new uniform value each frame. A frame loop need not wait for a draw. */
export function animate(canvas: HTMLCanvasElement): void {
  const frame = (ms: number): void => {
    void draw(canvas, ms / 1000);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** Draw the frames at `times`, one after another. The canvas then shows the last one. */
export async function run(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  times: readonly number[] = [0, 0.5, 1.25],
): Promise<void> {
  for (const time of times) await draw(canvas, time);
}
