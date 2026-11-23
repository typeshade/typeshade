// Step 17. The host is the host of step 2: the scene lives in the module, and the call only passes the canvas size.
import { fs } from './ray-tracer.shade.ts';

export async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
  await fs(canvas, { frame: { size: [canvas.width, canvas.height] } });
}
