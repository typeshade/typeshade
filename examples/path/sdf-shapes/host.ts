// Step 4. The host is the host of step 2: functions of the module change the picture, not the call.
import { fs } from './sdf-shapes.shade.ts';

export async function run(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void> {
  await fs(canvas, { frame: { size: [canvas.width, canvas.height] } });
}
