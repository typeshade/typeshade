"use typeshade";

// A bank of audio units, each written as a class: its fields are the unit's state, its
// constructor sets it up, and its methods advance it by one sample or read it. The class arm of
// the differential gate (`scripts/class-arm.ts`, change 0110) imports every class below into a
// twin module and holds each member a host could call to one result on WebGPU, on WebGL2, on the
// CPU tier and on the oracle. The journey's own runs step a bank of filters, in an entry and in a
// kernel function, against plain JavaScript (`journey.mjs`).

/** A one-pole lowpass: `z` moves the fraction `k` of the way to its input each sample. */
export class OnePole {
  z: f32 = 0.;
  k: f32;
  constructor(k: f32) {
    this.k = k;
  }
  /** One sample through the filter. */
  tick(x: f32): f32 {
    this.z = this.z + this.k * (x - this.z);
    return this.z;
  }
  /** The output as it stands, scaled, without a step. */
  peek(scale: f32): f32 {
    return this.z * scale;
  }
  /** The fraction of the way a filter moves each sample, clamped to [0, 1]. */
  static coefficient(step: f32): f32 {
    return clamp(step, 0., 1.);
  }
}

/** A one-pole lowpass with an output gain: it calls the method it inherits on itself. */
export class GainPole extends OnePole {
  gain: f32;
  constructor(k: f32, gain: f32) {
    super(k);
    this.gain = gain;
  }
  /** One sample through the filter, then the gain. */
  process(x: f32): f32 {
    return this.tick(x) * this.gain;
  }
}

/** A phase accumulator in [0, 1) that advances by `inc` each sample. */
export class Phasor {
  phase: f32 = 0.;
  inc: f32;
  constructor(inc: f32, phase: f32) {
    this.inc = inc;
    this.phase = fract(phase);
  }
  /** One sample: the phase before the step. */
  tick(): f32 {
    const p = this.phase;
    this.phase = fract(this.phase + this.inc);
    return p;
  }
  /** A saw wave from the phase, in [-1, 1). */
  get saw(): f32 {
    return this.phase * 2. - 1.;
  }
  /** The phase put through a shaping function. */
  shaped(shape: (p: f32) => f32): f32 {
    return shape(this.phase);
  }
}

/** An attack and release envelope with no constructor: `new Envelope()` takes the initializers. */
export class Envelope {
  level: f32 = 0.;
  attack: f32 = 0.5;
  release: f32 = 0.25;
  /** One sample toward `peak` while the gate is open, and toward 0 while it is closed. */
  step(gate: u32, peak: f32): f32 {
    if (gate != 0) {
      this.level = this.level + (peak - this.level) * this.attack;
    } else {
      this.level = this.level - this.level * this.release;
    }
    return this.level;
  }
}

/** Adds `by` to the count it is handed: the caller's place, through `@inout`. */
function advance(@inout count: u32, by: u32): void {
  count = count + by;
}

/** A sample counter that a helper advances through an `@inout` parameter. */
export class Counter {
  count: u32 = 0;
  constructor(start: u32) {
    this.count = start;
  }
  /** The count after `by` more samples. */
  skip(by: u32): u32 {
    advance(this.count, by);
    return this.count;
  }
}

/** A stereo panner: a mono sample in, a left and right pair out. */
export class Pan {
  gains: vec2f;
  constructor(position: f32) {
    const p = clamp(position, -1., 1.) * 0.5 + 0.5;
    this.gains = vec2f(1. - p, p);
  }
  /** One mono sample, panned. */
  apply(x: f32): vec2f {
    return this.gains * x;
  }
}

declare const table: storage<array<f32>>;

/** A wavetable oscillator. Its read reaches the binding `table`, which only an entry passes. */
export class Wavetable {
  at: u32 = 0;
  constructor(start: u32) {
    this.at = start;
  }
  /** The next sample of the table. */
  next(): f32 {
    const v = table[this.at % arrayLength(table)];
    this.at = this.at + 1;
    return v;
  }
}

/** How many samples each unit of a bank computes in one call. */
const BLOCK: u32 = 16;

declare const poles: storage<array<GainPole>, "read_write">;
declare const input: storage<array<f32>>;
declare const output: storage<array<f32>, "read_write">;

/** Steps one filter of the bank through its block, one invocation per filter. */
@compute([64])
export function bank(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(poles)) {
    return;
  }
  for (let n: u32 = 0; n < BLOCK; n++) {
    const at = gid.x * BLOCK + n;
    output[at] = poles[gid.x].process(input[at]);
  }
}

declare const voices: storage<array<Wavetable>, "read_write">;
declare const played: storage<array<f32>, "read_write">;

/** Plays one wavetable voice for a block, one invocation per voice. */
@compute([64])
export function play(@builtin("global_invocation_id") gid: vec3u): void {
  if (gid.x >= arrayLength(voices)) {
    return;
  }
  for (let n: u32 = 0; n < BLOCK; n++) {
    played[gid.x * BLOCK + n] = voices[gid.x].next();
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
