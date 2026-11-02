"use typeshade";

// A class a host builds with `new` (change 0109): `app.ts` imports `OnePole`, builds a bank of
// filters with the class's own constructor and ticks one on the CPU tier, and `gpu.ts` hands the
// instances to `run`, whose loop runs on WebGPU, as the structs they are.

/** A one-pole lowpass with its state. */
export class OnePole {
  z: f32 = 0.;
  k!: f32;
  constructor(k: f32) {
    this.k = k;
  }
  /** One sample through the filter. */
  tick(x: f32): f32 {
    this.z = this.z + this.k * (x - this.z);
    return this.z;
  }
}

/** Runs every filter of the bank over its block, one lane per filter. */
export function run(out: array<f32>, xs: array<f32>, filters: array<OnePole>, block: u32) {
  for (let i: u32 = 0; i < filters.length; i++) {
    for (let n: u32 = 0; n < block; n++) {
      out[i * block + n] = filters[i].tick(xs[i * block + n]);
    }
  }
}
