import { f32, f32s, u32s, type Program } from './common.js';

function raggedJs(xs: number[], counts: number[], at: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < counts[at[i]!]!; j++) out.push(xs[i]!);
  return out;
}

function guardedJs(xs: number[], n: number): number[] {
  const out: number[] = [];
  if (xs[0]! > 0) for (let i = 0; i < n; i++) out.push(i * i);
  return out;
}

function halvingJs(xs: number[]): number[] {
  const out: number[] = [];
  for (const x of xs) out.push(x);
  for (let j = 0; j < out.length; j++) if (out[j]! > 1) out.push(f32(out[j]! * 0.5));
  return out;
}

function appendAtJs(n: number, at: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[at] = i;
  return out;
}

function lengthBoundJs(xs: number[], limit: number): number[] {
  const out: number[] = [];
  for (const x of xs) out.push(x);
  for (let j = 0; j < out.length; j++) if (j < limit) out.push(j);
  return out;
}

function nestedWriteJs(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(1);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[j] = 2;
  return out;
}

function appendPastJs(n: number, limit: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(1);
  for (let j = 0; j < out.length; j++) if (j < limit) out[j + 1] = 2;
  return out;
}

export function firstMatchesJs(xs: number[], n: number, t: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (f32(f32(i + j) * xs[0]!) > t) {
        out.push(j);
        break;
      }
  out[0] = 1;
  return out;
}

export const FIRST_MATCHES = `export function firstMatches(xs: f32[], n: u32, t: f32): u32[] {
  const out: u32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    for (let j: u32 = 0; j < n; j++) {
      if (f32(i + j) * xs[0] > t) {
        out.push(j);
        break;
      }
    }
  }
  out[0] = 1;
  return out;
}`;

export const OPEN_PROGRAMS: readonly Program[] = [
  {
    name: 'ragged',
    source: `export function ragged(xs: f32[], counts: u32[], at: u32[]): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < xs.length; i++) {
    for (let j: u32 = 0; j < counts[at[i]]; j++) {
      out.push(xs[i]);
    }
  }
  return out;
}`,
    runs: [
      [
        [f32s(1.5, 2.5, 3.5), u32s(2, 0, 1), u32s(0, 1, 2)],
        raggedJs([1.5, 2.5, 3.5], [2, 0, 1], [0, 1, 2]),
      ],
      [
        [f32s(1.5, 2.5, 3.5), u32s(2, 0, 1), u32s(2, 0, 0)],
        raggedJs([1.5, 2.5, 3.5], [2, 0, 1], [2, 0, 0]),
      ],
      [[f32s(1.5), u32s(0), u32s(0)], []],
    ],
  },
  {
    name: 'guarded',
    source: `export function guarded(xs: f32[], n: u32): u32[] {
  const out: u32[] = [];
  if (xs[0] > 0.) {
    for (let i: u32 = 0; i < n; i++) {
      out.push(i * i);
    }
  }
  return out;
}`,
    runs: [
      [[f32s(1), 4], guardedJs([1], 4)],
      [[f32s(-1), 4], guardedJs([-1], 4)],
      [[f32s(1), 0], []],
    ],
  },
  {
    name: 'halving',
    source: `export function halving(xs: f32[]): f32[] {
  const out: f32[] = [];
  for (const x of xs) {
    out.push(x);
  }
  for (let j: u32 = 0; j < out.length; j++) {
    if (out[j] > 1.) {
      out.push(out[j] * 0.5);
    }
  }
  return out;
}`,
    runs: [
      [[f32s(8, 3)], halvingJs([8, 3])],
      [[f32s(0.5)], [0.5]],
    ],
  },
  {
    name: 'appendAt',
    source: `export function appendAt(n: u32, at: u32): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    for (let j: u32 = 0; j < n; j++) {
      out[at] = f32(i);
    }
  }
  return out;
}`,
    runs: [
      [[3, 0], appendAtJs(3, 0)],
      [[0, 0], []],
    ],
  },
  {
    name: 'lengthBound',
    source: `export function lengthBound(xs: f32[], limit: u32): f32[] {
  const out: f32[] = [];
  for (const x of xs) {
    out.push(x);
  }
  for (let j: u32 = 0; j < out.length; j++) {
    if (j < limit) {
      out.push(f32(j));
    }
  }
  return out;
}`,
    runs: [
      [[f32s(5, 6), 4], lengthBoundJs([5, 6], 4)],
      [
        [f32s(5, 6), 0],
        [5, 6],
      ],
    ],
  },
  {
    name: 'nestedWrite',
    source: `export function nestedWrite(n: u32): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    out.push(1.);
  }
  for (let i: u32 = 0; i < n; i++) {
    for (let j: u32 = 0; j < n; j++) {
      out[j] = 2.;
    }
  }
  return out;
}`,
    runs: [
      [[3], nestedWriteJs(3)],
      [[0], []],
    ],
  },
  {
    name: 'appendPast',
    source: `export function appendPast(n: u32, limit: u32): f32[] {
  const out: f32[] = [];
  for (let i: u32 = 0; i < n; i++) {
    out.push(1.);
  }
  for (let j: u32 = 0; j < out.length; j++) {
    if (j < limit) {
      out[j + 1] = 2.;
    }
  }
  return out;
}`,
    runs: [
      [[3, 2], appendPastJs(3, 2)],
      [[3, 0], appendPastJs(3, 0)],
      [[0, 2], []],
    ],
  },
];
