// The call converts a channel string and an object to a u32 id and an array (surface §75).
import { boost, gain } from './string-keys-record.shade.ts';

/** Scale the same pixels through each channel, and call the helper with a computed host key. */
export async function run(): Promise<{ pixels: Float32Array; selected: number }> {
  const pixels = new Float32Array([1, 2, 4, 8]);
  const by = { r: 2, g: 0.5, b: 4 };
  await boost(pixels, 'g', by.g);
  await boost(pixels, 'r', by.r);
  await boost(pixels, 'b', by.b);
  const channel = pixels[0]! > 1 ? 'b' : 'r';
  return { pixels, selected: gain(channel, 2, by) };
}
