// Step 12. A compute entry takes its arrays by binding name and a count of workgroups of 64.
// When the promise resolves, the array holds what the entry wrote.
import { doubled } from './double-array.shade.ts';

export async function run(count = 100): Promise<Float32Array> {
  const numbers = Float32Array.from({ length: count }, (_, i) => i);
  await doubled({ numbers }, Math.ceil(count / 64));
  return numbers;
}
