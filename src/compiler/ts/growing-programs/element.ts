import { f32, f32s, type Program } from './common.js';
import { appendedJs, fibJs } from './while.js';

export const ELEMENT_PROGRAMS: readonly Program[] = [
  {
    name: 'fib',
    source: `export function fib(n: u32): u32[] {
  const out: u32[] = [];
  for (let s: u32 = 0; s < 2; s++) {
    out.push(1);
  }
  let k: u32 = 2;
  while (k < n) {
    out.push(out[k - 1] + out[k - 2]);
    k++;
  }
  return out;
}`,
    runs: [
      [[0], fibJs(0)],
      [[2], fibJs(2)],
      [[12], fibJs(12)],
      [[40], fibJs(40)],
    ],
  },
  {
    name: 'doubled',
    source: `export function doubled(xs: f32[]): f32[] {
  const out: f32[] = [];
  for (const x of xs) {
    out.push(x);
  }
  let j: u32 = 0;
  while (j < out.length) {
    out[j] = out[j] * 2.;
    j++;
  }
  return out;
}`,
    runs: [
      [[f32s(1, 2.5, -3)], [2, 5, -6]],
      [[f32s(0.1)], [f32(0.1 * 2)]],
    ],
  },
  {
    name: 'appended',
    source: `export function appended(n: u32): u32[] {
  const out: u32[] = [];
  let k: u32 = 0;
  while (k < n) {
    out.push(k);
    out[out.length] = out.length;
    k++;
  }
  return out;
}`,
    runs: [
      [[0], appendedJs(0)],
      [[1], appendedJs(1)],
      [[4], appendedJs(4)],
    ],
  },
  {
    name: 'countedAppended',
    source: `export function countedAppended(n: u32): u32[] {
  const out: u32[] = [];
  for (let k: u32 = 0; k < n; k++) {
    out.push(k);
    out[out.length] = out.length;
  }
  return out;
}`,
    runs: [
      [[0], appendedJs(0)],
      [[1], appendedJs(1)],
      [[4], appendedJs(4)],
    ],
  },
  {
    name: 'many',
    source: `export function many(n: u32): u32[] {
  const out: u32[] = [];
  let k: u32 = 0;
  while (k < n) {
    out.push(k);
    k++;
  }
  return out;
}`,
    runs: [[[70000], Array.from({ length: 70000 }, (_, i) => i)]],
  },
];
