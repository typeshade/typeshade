"use typeshade";

/* @example
{
  "title": "Counts that stay on the device",
  "blurb": "`keepAbove`, `gather` and `sumInto` keep a list, its length and a sum on the device (change 0094). `keepAbove` pushes after a length a `Resident` holds, `{ array, length }`, and leaves the new length in it. `gather` runs one iteration for each entry of the list: its trip count is `count[0]`, which a range entry reads on the device and dispatches the loop indirectly from. `sumInto` sums over `min(count[0], out.length)`, the cap that sizes its partials, and stores the sum after its loop. Called in one `fuse` scope over `Resident` arrays, the chain reads nothing back between its calls.",
  "renderable": false,
  "reason": "no entry point"
}
*/

// The host holds the list's length in a `Resident<Uint32Array>` and passes it with the list:
// `keepAbove(xs, 0.5, { array: list, length: count })`. Then `gather(count, list, xs, out)` and
// `sumInto(count, out, sums)` read that length on the device, and `sums.read()` is the one read
// of the chain.

// Appends the index of each value above t after the list's length.
export function keepAbove(xs: array<f32>, t: f32, list: array<u32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      list.push(i);
    }
  }
}

// One iteration for each entry of the list: the trip count is the device's word.
export function gather(count: array<u32>, list: array<u32>, xs: array<f32>, out: array<f32>): void {
  const n: u32 = count[0];
  for (let j: u32 = 0; j < n; j++) {
    out[j] = xs[list[j]];
  }
}

// Sums the gathered values and stores the sum, on the device.
export function sumInto(count: array<u32>, out: array<f32>, sums: array<f32>): void {
  let s = 0.;
  const n: u32 = min(count[0], out.length);
  for (let j: u32 = 0; j < n; j++) {
    s += out[j];
  }
  sums[0] = s;
}
