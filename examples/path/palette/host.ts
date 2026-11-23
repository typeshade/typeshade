// Step 7. The host is the host of step 2: the constant and the array live in the module, not in the call.
import { fs } from './palette.shade.ts';

export async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
  await fs(canvas, { frame: { size: [canvas.width, canvas.height] } });
}
