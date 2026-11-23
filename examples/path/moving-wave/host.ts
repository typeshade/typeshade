// Step 3. Time is one more uniform field. `run` draws one frame, and `animate` draws a frame each tick.
import { fs } from './moving-wave.shade.ts';

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
