// Compute programs that exercise the WebGL2 execution model of change 0054: the list the
// proposal's required evidence names (a write at `gid.x`, a computed index, several writes, a
// read after its own write, a barrier with workgroup memory, a reduction, `atomicAdd` with and
// without its value, an append buffer, a loop with a barrier), and the control flow the phase
// splitter takes apart. `debug/phased.test.ts` and `testing/gl-model.test.ts` both run them.
// Test code only.

import type { CpuValue } from '../cpu-runtime.js';

/** A program, the entry to dispatch, how many workgroups, and fresh bindings for one run. */
export interface ComputeProgram {
  readonly src: string;
  readonly entry: string;
  readonly workgroups: number;
  readonly bindings: () => Record<string, CpuValue>;
}

export const PROGRAMS: Record<string, ComputeProgram> = {
  'a write at gid.x': {
    src: `"use typeshade";
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
@compute([8, 1, 1])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  out[gid.x] = xs[gid.x] * 2. + 1.;
}
`,
    entry: 'main',
    workgroups: 2,
    bindings: () => ({
      xs: Array.from({ length: 16 }, (_, i) => i * 0.5),
      out: new Array(16).fill(0),
    }),
  },
  'a write at a computed index': {
    src: `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([8, 1, 1])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  out[(gid.x * 5 + 3) % 16] = gid.x;
}
`,
    entry: 'main',
    workgroups: 2,
    bindings: () => ({ out: new Array(16).fill(0) }),
  },
  'several writes in one invocation, past the log': {
    src: `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([4, 1, 1])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  for (let k: u32 = 0; k < 10; k++) {
    out[gid.x * 10 + k] = gid.x * 100 + k;
  }
}
`,
    entry: 'main',
    workgroups: 1,
    bindings: () => ({ out: new Array(40).fill(0) }),
  },
  'a read after its own write': {
    src: `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([4, 1, 1])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  out[gid.x] = gid.x + 1;
  out[gid.x + 4] = out[gid.x] * 3;
  out[gid.x] = out[gid.x + 4] + out[gid.x];
}
`,
    entry: 'main',
    workgroups: 1,
    bindings: () => ({ out: new Array(8).fill(0) }),
  },
  'a barrier with workgroup memory': {
    src: `"use typeshade";
declare const xs: storage<array<f32>>;
declare const out: storage<array<f32>, "read_write">;
let tile: workgroup<array<f32, 8>>;
@compute([8, 1, 1])
export function main(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_index") li: u32,
): void {
  tile[li] = xs[gid.x];
  workgroupBarrier();
  out[gid.x] = tile[7 - li];
}
`,
    entry: 'main',
    workgroups: 2,
    bindings: () => ({
      xs: Array.from({ length: 16 }, (_, i) => i + 0.25),
      out: new Array(16).fill(0),
    }),
  },
  'a reduction, a loop with a barrier': {
    src: `"use typeshade";
declare const xs: storage<array<u32>>;
declare const sums: storage<array<u32>, "read_write">;
let part: workgroup<array<u32, 8>>;
@compute([8, 1, 1])
export function main(
  @builtin("global_invocation_id") gid: vec3u,
  @builtin("local_invocation_index") li: u32,
  @builtin("workgroup_id") wid: vec3u,
): void {
  part[li] = xs[gid.x];
  workgroupBarrier();
  for (let stride: u32 = 4; stride > 0; stride /= 2) {
    if (li < stride) {
      part[li] = part[li] + part[li + stride];
    }
    workgroupBarrier();
  }
  if (li === 0) {
    sums[wid.x] = part[0];
  }
}
`,
    entry: 'main',
    workgroups: 3,
    bindings: () => ({
      xs: Array.from({ length: 24 }, (_, i) => i * 3 + 1),
      sums: new Array(3).fill(0),
    }),
  },
  'atomicAdd without its value': {
    src: `"use typeshade";
declare const xs: storage<array<f32>>;
declare const bins: storage<array<atomic<u32>>, "read_write">;
@compute([8, 1, 1])
export function main(@builtin("global_invocation_id") gid: vec3u): void {
  atomicAdd(bins[u32(xs[gid.x] * 4.)], 1);
}
`,
    entry: 'main',
    workgroups: 2,
    bindings: () => ({
      xs: Array.from({ length: 16 }, (_, i) => ((i * 7) % 16) / 16),
      bins: new Array(4).fill(0),
    }),
  },
  'atomicAdd with its value, in one workgroup': {
    src: `"use typeshade";
declare const count: storage<atomic<u32>, "read_write">;
declare const slots: storage<array<u32>, "read_write">;
@compute([4, 1, 1])
export function append(@builtin("local_invocation_index") li: u32): void {
  const first = atomicAdd(count, 1);
  slots[first] = li * 10;
  const second = atomicAdd(count, 1);
  slots[second] = li * 10 + 1;
}
`,
    entry: 'append',
    workgroups: 1,
    bindings: () => ({ count: 0, slots: new Array(8).fill(0) }),
  },
  'a helper that waits, an early return, a switch': {
    src: `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
let shared: workgroup<array<u32, 4>>;
function publish(li: u32, v: u32): u32 {
  shared[li] = v;
  workgroupBarrier();
  return shared[3 - li];
}
@compute([4, 1, 1])
export function main(@builtin("local_invocation_index") li: u32): void {
  const got = publish(li, li * li + 1);
  switch (li) {
    case 0: {
      out[0] = got;
      break;
    }
    case 1: {
      out[1] = got + 100;
      break;
    }
    default: {
      if (li === 3) {
        return;
      }
      out[li] = got * 2;
    }
  }
}
`,
    entry: 'main',
    workgroups: 1,
    bindings: () => ({ out: new Array(4).fill(0) }),
  },
  'break and continue in a loop with a cut, an atomic in a helper': {
    src: `"use typeshade";
declare const total: storage<atomic<u32>, "read_write">;
declare const out: storage<array<u32>, "read_write">;
function count(v: u32): void {
  atomicAdd(total, v);
}
@compute([4, 1, 1])
export function main(@builtin("local_invocation_index") li: u32): void {
  let acc: u32 = 0;
  for (let k: u32 = 0; k < 8; k++) {
    if (k === li) {
      continue;
    }
    if (k > li + 4) {
      break;
    }
    count(k);
    acc += k;
  }
  out[li] = acc;
}
`,
    entry: 'main',
    workgroups: 2,
    bindings: () => ({ total: 0, out: new Array(4).fill(0) }),
  },
};
