// Step 14. One workgroup does the whole sum, so the call dispatches one workgroup and reads one number.
// A barrier needs a GPU tier: this host runs on WebGPU.
import { sum } from './parallel-sum.shade.ts';

export async function run(count = 1000): Promise<number> {
  const numbers = Float32Array.from({ length: count }, (_, i) => (i % 10) + 1);
  const total = new Float32Array(1);
  await sum({ numbers, total }, 1);
  return total[0]!;
}
