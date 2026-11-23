// Step 13. A 2D dispatch: the workgroup count is `[x, y]`, and a uniform is passed as a plain object.
// The image is a flat array of brightness values, row by row.
import { blur } from './image-blur.shade.ts';

export async function run(width = 16, height = 16): Promise<Float32Array> {
  const source = Float32Array.from({ length: width * height }, (_, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    return x >= width / 4 && x < width / 2 && y >= height / 4 && y < height / 2 ? 1 : 0;
  });
  const blurred = new Float32Array(width * height);
  await blur({ size: { width, height }, source, blurred }, [
    Math.ceil(width / 8),
    Math.ceil(height / 8),
  ]);
  return blurred;
}
