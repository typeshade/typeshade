// Collect into JavaScript's own Set and Map from kernel functions (surface §74, change 0080).
//
// The host passes a `Set` and a `Map` as it passes an array, by reference. When the promise
// resolves they hold the entries a sequential run of the loop leaves, in insertion order.
import {
  channelNames,
  channels,
  labels,
  latest,
  lookup,
  present,
} from './host-set-unique.shade.ts';

/** The unique nonzero labels of a small image, the last weight set for each label, and the
 *  weights of labels 0 to 9 read back from the map, -1 for a label it does not hold. */
export async function run(n = 64): Promise<{
  seen: Set<number>;
  count: number;
  last: Map<number, number>;
  found: Float32Array;
  present: Uint32Array;
  names: Map<string, string>;
  nameMarks: Uint32Array;
  channels: { seen: Set<string>; last: Map<string, number>; found: Float32Array; count: number };
}> {
  // Labels 0 to 6, where 0 is the background.
  const pixels = Uint32Array.from({ length: n }, (_, i) => (i * 5) % 7);
  const seen = new Set<number>();
  const count = await labels(pixels, seen); // seen holds 5, 3, 1, 6, 4, 2

  const weights = Float32Array.from({ length: n }, (_, i) => i / 4);
  const last = new Map<number, number>();
  await latest(pixels, weights, last); // the weight of each label's last pixel

  const found = new Float32Array(10);
  await lookup(
    Uint32Array.from({ length: 10 }, (_, i) => i),
    last,
    found,
  );

  // One call that adds, then reads what it added: labels 0 to 9 against the image's.
  const marks = new Uint32Array(10);
  await present(
    pixels,
    new Set<number>(),
    Uint32Array.from({ length: 10 }, (_, i) => i),
    marks,
  );
  const channelSeen = new Set<'r' | 'g' | 'b'>(['r']);
  const channelLast = new Map<'r' | 'g' | 'b', number>([
    ['b', -1],
    ['r', -2],
  ]);
  const channelFound = new Float32Array(6);
  const channelCount = await channels(weights, channelSeen, channelLast, channelFound);
  const names = new Map<'r' | 'g' | 'b', 'r' | 'g' | 'b'>([['r', 'b']]);
  const nameMarks = new Uint32Array(3);
  await channelNames(weights, names, nameMarks);
  return {
    names,
    nameMarks,
    seen,
    count,
    last,
    found,
    present: marks,
    channels: { seen: channelSeen, last: channelLast, found: channelFound, count: channelCount },
  };
}
