// Step 1. Draw the module's entry into a canvas. The same call runs on WebGPU, WebGL2 and the CPU tier.
import { fs } from './first-color.shade.ts';

export async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
  await fs(canvas);
}
