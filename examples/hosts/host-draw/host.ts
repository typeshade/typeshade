// Draw a full-screen fragment entry into a canvas (surface §67, Rule 8.24). The import is the shader
// module itself: the Vite plugin (`typeshade/vite`) turns `fs` into a function that draws one frame.
// The first draw into a canvas picks its tier: WebGPU, then WebGL2, then the CPU tier.
import { fs } from './host-draw.shade.ts';

/** Draw one frame at `time` seconds. The promise resolves when the frame is submitted. */
export async function run(canvas: HTMLCanvasElement | OffscreenCanvas, time = 0): Promise<void> {
  await fs(canvas, { frame: { time, size: [canvas.width, canvas.height] } });
}

/** Animate `canvas`: a new uniform value each frame. A frame loop need not wait for a draw. */
export function animate(canvas: HTMLCanvasElement): void {
  const frame = (ms: number): void => {
    void run(canvas, ms / 1000);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
