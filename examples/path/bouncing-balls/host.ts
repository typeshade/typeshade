// Step 8. Time is the uniform of step 3. `run` draws one frame, and `animate` draws a frame each tick.
import { fs } from './bouncing-balls.shade.ts';

export async function run(canvas: HTMLCanvasElement | OffscreenCanvas, time = 0): Promise<void> {
  await fs(canvas, { frame: { size: [canvas.width, canvas.height], time } });
}

export function animate(canvas: HTMLCanvasElement): void {
  const tick = (ms: number): void => {
    void run(canvas, ms / 1000);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
