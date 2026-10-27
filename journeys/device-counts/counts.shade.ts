"use typeshade";

// Three kernel functions whose counts stay on the device (change 0094). `keepAbove` pushes after
// a length that a `Resident` holds and leaves the new length there. `gather` runs one iteration
// for each entry of the list: its trip count is `count[0]`, which the device reads. `sumInto` sums
// over that count, capped by `out.length`, and stores the sum after its loop. These are the
// functions of the example `kernel-device-counts`.

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
