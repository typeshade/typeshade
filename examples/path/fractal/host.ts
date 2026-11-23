// Step 6. The host is the host of step 2: the loop in the module changes the picture, not the call.
import { fs } from './fractal.shade.ts';

export async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
  await fs(canvas, { frame: { size: [canvas.width, canvas.height] } });
}
