import { f32, u32s, type Program } from './common.js';

export function walkJs(next: readonly number[], start: number): number[] {
  const out: number[] = [];
  let at = start;
  while (at !== 0) {
    out.push(at);
    at = next[at]!;
  }
  return out;
}

export function untilJs(start: number, limit: number): number[] {
  const out: number[] = [];
  let k = start >>> 0;
  while (k < limit) {
    out.push(k);
    k = (k * 2 + 1) >>> 0;
  }
  return out;
}

export function halvesJs(n: number): number[] {
  const out: number[] = [];
  let k = n;
  while (k > 0) {
    for (let i = 0; i < k; i++) out.push(i);
    k >>>= 1;
  }
  return out;
}

export function samplesJs(a: number, b: number, h: number): number[] {
  const out: number[] = [];
  for (let x = f32(a); x < f32(b); x = f32(x + f32(h))) out.push(x);
  return out;
}

export function doublingJs(xs: readonly number[], limit: number): number[] {
  const out = xs.map(f32);
  for (let j = 0; j < out.length && j < limit; j++) out.push(f32(out[j]! * 2));
  return out;
}

export function powersJs(n: number): number[] {
  const out: number[] = [];
  for (let j = 1; j < n; j *= 2) out.push(j);
  return out;
}

export function bumpedJs(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(i);
    i += 1;
  }
  return out;
}

export function guardedStepJs(n: number, h: number): number[] {
  const out: number[] = [];
  if (h > 0) for (let i = 0; i < n; i += h) out.push(i);
  return out;
}

export function insideJs(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (i > 2) for (let j = 0; j < n; j++) out.push(j);
  return out;
}

export function switchedJs(n: number, d: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    switch (i) {
      case 2:
        for (let j = 0; j < Math.floor(n / d); j++) out.push(j);
        break;
      default:
        break;
    }
  }
  return out;
}

export function appendedJs(n: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    out.push(k);
    out[out.length] = out.length;
  }
  return out;
}

export function fibJs(n: number): number[] {
  const out = [1, 1];
  for (let k = 2; k < n; k++) out.push((out[k - 1]! + out[k - 2]!) >>> 0);
  return out;
}

export function underWhileJs(n: number): number[] {
  const out: number[] = [];
  let k = 0;
  while (k < n) {
    if (k > 1) for (let j = 0; j < k; j++) out.push(j);
    k++;
  }
  return out;
}

export const WHILE_PROGRAMS: readonly Program[] = [
  {
    name: 'walk',
    source: `export function walk(next: u32[], start: u32): u32[] {
  const path: u32[] = [];
  let at = start;
  while (at !== 0) {
    path.push(at);
    at = next[at];
  }
  return path;
}`,
    runs: [
      [[u32s(0, 2, 3, 0), 1], walkJs([0, 2, 3, 0], 1)],
      [[u32s(0, 0), 0], walkJs([0, 0], 0)],
      [[u32s(0, 2, 3, 4, 0), 1], walkJs([0, 2, 3, 4, 0], 1)],
    ],
  },
  {
    name: 'until',
    source: `export function until(start: u32, limit: u32): u32[] {
  const out: u32[] = [];
  let k = start;
  while (k < limit) {
    out.push(k);
    k = k * 2 + 1;
  }
  return out;
}`,
    runs: [
      [[0, 100], untilJs(0, 100)],
      [[5, 5], untilJs(5, 5)],
      [[3, 100000], untilJs(3, 100000)],
    ],
  },
  {
    name: 'halves',
    source: `export function halves(n: u32): u32[] {
  const out: u32[] = [];
  let k = n;
  while (k > 0) {
    for (let i: u32 = 0; i < k; i++) {
      out.push(i);
    }
    k = k >> 1;
  }
  return out;
}`,
    runs: [
      [[0], halvesJs(0)],
      [[1], halvesJs(1)],
      [[5], halvesJs(5)],
      [[8], halvesJs(8)],
    ],
  },
  {
    name: 'underWhile',
    source: `export function underWhile(n: u32): u32[] {
  const out: u32[] = [];
  let k: u32 = 0;
  while (k < n) {
    if (k > 1) {
      for (let j: u32 = 0; j < k; j++) {
        out.push(j);
      }
    }
    k++;
  }
  return out;
}`,
    runs: [
      [[0], underWhileJs(0)],
      [[2], underWhileJs(2)],
      [[6], underWhileJs(6)],
    ],
  },
];
