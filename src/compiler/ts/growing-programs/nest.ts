import { type Program } from './common.js';
import { insideJs, switchedJs } from './while.js';

function innerWhileJs(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let j = 0;
    while (j < i) {
      out.push(j);
      j++;
    }
  }
  return out;
}

function untakenJs(n: number, d: number): number[] {
  const out: number[] = [];
  let k = 0;
  while (k < n) {
    if (k > 100) for (let j = 0; j < Math.floor(n / d); j++) out.push(j);
    out.push(k);
    k++;
  }
  return out;
}

export const NEST_PROGRAMS: readonly Program[] = [
  {
    name: 'untaken',
    source: `export function untaken(n: u32, d: u32): u32[] {
  const out: u32[] = [];
  let k: u32 = 0;
  while (k < n) {
    if (k > 100) {
      for (let j: u32 = 0; j < n / d; j++) {
        out.push(j);
      }
    }
    out.push(k);
    k++;
  }
  return out;
}`,
    runs: [
      [[5, 0], untakenJs(5, 1)],
      [[3, 0], untakenJs(3, 1)],
      [[102, 51], untakenJs(102, 51)],
    ],
  },
  {
    name: 'innerWhile',
    source: `export function innerWhile(n: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    let j: u32 = 0;
    while (j < i) {
      out.push(j);
      j++;
    }
  }
  return out;
}`,
    runs: [
      [[0], innerWhileJs(0)],
      [[5], innerWhileJs(5)],
    ],
  },
  {
    name: 'inside',
    source: `export function inside(n: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    if (i > 2) {
      for (let j: u32 = 0; j < n; j++) {
        out.push(j);
      }
    }
  }
  return out;
}`,
    runs: [
      [[0], insideJs(0)],
      [[3], insideJs(3)],
      [[5], insideJs(5)],
    ],
  },
  {
    name: 'switched',
    source: `export function switched(n: u32, d: u32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    switch (i) {
      case 2:
        for (let j: u32 = 0; j < n / d; j++) {
          out.push(j);
        }
        break;
      default:
        break;
    }
  }
  return out;
}`,
    runs: [
      [[4, 2], switchedJs(4, 2)],
      [[2, 0], switchedJs(2, 1)],
      [[1, 0], switchedJs(1, 1)],
      [[9, 3], switchedJs(9, 3)],
    ],
  },
  {
    name: 'switchTop',
    source: `export function switchTop(n: u32): u32[] {
  const out: u32[] = [];
  switch (n) {
    case 1:
      for (let i: u32 = 0; i < n; i++) {
        out.push(7);
      }
      break;
    default:
      break;
  }
  return out;
}`,
    runs: [
      [[1], [7]],
      [[2], []],
    ],
  },
];
