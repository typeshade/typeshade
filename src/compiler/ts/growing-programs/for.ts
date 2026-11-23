import { f32s, type Program } from './common.js';
import { samplesJs, doublingJs, powersJs, bumpedJs, guardedStepJs } from './while.js';

export const FOR_PROGRAMS: readonly Program[] = [
  {
    name: 'samples',
    source: `export function samples(a: f32, b: f32, h: f32): f32[] {
  const out: f32[] = [];
  for (let x: f32 = a; x < b; x += h) {
    out.push(x);
  }
  return out;
}`,
    runs: [
      [[0, 1, 0.1], samplesJs(0, 1, 0.1)],
      [[0, 1, 0.01], samplesJs(0, 1, 0.01)],
      [[1, 0, 0.5], samplesJs(1, 0, 0.5)],
    ],
  },
  {
    name: 'doubling',
    source: `export function doubling(xs: f32[], limit: u32): f32[] {
  const out: f32[] = [];
  for (const x of xs) {
    out.push(x);
  }
  for (let j: u32 = 0; j < out.length && j < limit; j++) {
    out.push(out[j] * 2.);
  }
  return out;
}`,
    runs: [
      [[f32s(1, 2), 3], doublingJs([1, 2], 3)],
      [[f32s(1.5), 0], doublingJs([1.5], 0)],
      [[f32s(0.1, 0.3, 7), 20], doublingJs([0.1, 0.3, 7], 20)],
    ],
  },
  {
    name: 'powers',
    source: `export function powers(n: u32): u32[] {
  const out: u32[] = [];
  for (let j: u32 = 1; j < n; j *= 2) {
    out.push(j);
  }
  return out;
}`,
    runs: [
      [[0], powersJs(0)],
      [[2], powersJs(2)],
      [[100], powersJs(100)],
    ],
  },
  {
    name: 'bumped',
    source: `export function bumped(n: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    out.push(i);
    i += 1;
  }
  return out;
}`,
    runs: [
      [[0], bumpedJs(0)],
      [[5], bumpedJs(5)],
      [[6], bumpedJs(6)],
    ],
  },
  {
    name: 'guardedStep',
    source: `export function guardedStep(n: u32, h: u32): u32[] {
  const out: u32[] = [];
  if (h > 0) {
    for (let i: u32 = 0; i < n; i += h) {
      out.push(i);
    }
  }
  return out;
}`,
    runs: [
      [[10, 0], guardedStepJs(10, 0)],
      [[10, 3], guardedStepJs(10, 3)],
      [[0, 3], guardedStepJs(0, 3)],
    ],
  },
];
