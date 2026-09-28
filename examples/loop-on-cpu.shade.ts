"use typeshade";

/* @example
{
  "title": "Loops that run on the CPU",
  "blurb": "One loop for each rule of the independence proof (R1 to R6) that the proof refuses. Each carries a warning, TS8070, whose first sentence names the line and the names in it and whose second gives the remedy. A warning refuses nothing: the module compiles, and a host call runs the function on the CPU tier, where the loop means what it says.",
  "renderable": false,
  "reason": "no entry point"
}
*/

let calls = 0;

function tally(x: f32): f32 {
  calls += 1;
  return x;
}

// R1: a while loop, whose trip count is known only when it ends.
export function halve(xs: array<f32>) {
  let n = xs.length;
  while (n > 1) {
    n = n / 2;
    xs[n] = 0.;
  }
}

// R2: a return inside the loop, so whether an iteration runs depends on the ones before it.
export function firstNegative(xs: array<f32>): i32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] < 0.) {
      return i32(i);
    }
  }
  return -1;
}

// R3: "nearest" is written by one iteration and read by the next.
export function nearest(xs: array<f32>, x: f32): f32 {
  let nearest = xs[0];
  for (let i: u32 = 1; i < xs.length; i++) {
    if (abs(xs[i] - x) < abs(nearest - x)) {
      nearest = xs[i];
    }
  }
  return nearest;
}

// R4: a prefix sum reads "out[i - 1]", which the iteration before wrote.
export function prefix(out: array<f32>) {
  for (let i: u32 = 1; i < out.length; i++) {
    out[i] = out[i] + out[i - 1];
  }
}

// R5: "tally" writes the module variable "calls".
export function counted(xs: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = tally(xs[i]);
  }
}

// R6: console.log, whose lines would print in another order on the GPU.
export function logged(xs: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    console.log(xs[i]);
    xs[i] = xs[i] * 2.;
  }
}
