// Call kernel functions with plain arguments (surface §65, Rule 8.22).
//
// A kernel function is called like any function the module exports, and awaited. Each loop the
// compiler proves independent runs on the GPU; a typed array it writes comes back in place.
import { exposure, peak } from './host-kernel.shade.ts';

/** Tone-map `n` values on the GPU, then find the brightest. */
export async function run(n = 1024): Promise<{ pixels: Float32Array; peak: number }> {
  const pixels = Float32Array.from({ length: n }, (_, i) => (i % 64) / 16);
  await exposure(1.5, pixels); // `pixels` now holds the tone-mapped values
  const brightest = await peak(pixels); // a number, folded on the GPU
  return { pixels, peak: brightest };
}
