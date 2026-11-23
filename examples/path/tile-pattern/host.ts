// Step 5. The host is the host of step 2: loops and conditions of the module change the picture, not the call.
import { fs } from './tile-pattern.shade.ts';

export async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
  await fs(canvas, { frame: { size: [canvas.width, canvas.height] } });
}
