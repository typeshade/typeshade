// Step 2. A uniform carries the canvas size: the host passes its value as the second argument of the call.
import { fs } from './uv-gradient.shade.ts';

export async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
  await fs(canvas, { frame: { size: [canvas.width, canvas.height] } });
}
