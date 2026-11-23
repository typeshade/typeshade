// Step 15. An array of atomics is passed as a typed array of its integers.
// The eight counts are the heights of the eight bars of the chart.
import { histogram } from './histogram.shade.ts';

export async function run(count = 1000): Promise<Uint32Array> {
  const values = Float32Array.from({ length: count }, (_, i) => ((i * 37) % 100) / 100);
  const bins = new Uint32Array(8);
  await histogram({ values, bins }, Math.ceil(count / 64));
  return bins;
}
