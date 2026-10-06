// The phased executor (change 0054, step 1) against the lockstep oracle. `splitPhases` cuts a
// compute entry at its barriers, its atomic operations and where the write log could be full,
// and `dispatchPhased` runs the result the way the WebGL2 tier will: memory as the pass found
// it plus the invocation's own writes, a scatter in invocation order, a resolve pass for the
// atomics. A program whose result WGSL defines gives the same memory both ways; one whose
// atomic values depend on order gives the phased order, which is pinned here.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { dispatchCompute } from './dispatch.js';
import { dispatchPhased } from './phased.js';
import { splitPhases } from '../passes/phase-split.js';
import { autoVars } from '../passes/opt/index.js';
import type { CpuValue } from '../cpu-runtime.js';
import { stageOf, type ModuleDecl, type ShaderType } from '../ir/index.js';
import type { CpuPrecision } from '../oracle.js';

const moduleOf = (src: string): ModuleDecl => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module;
};

type Bindings = Record<string, CpuValue>;
const clone = (b: Bindings): Bindings => structuredClone(b);

/** Run `entry` both ways from the same bindings and hand back both results. */
function both(
  src: string,
  entry: string,
  workgroups: number,
  bindings: Bindings,
  precision?: CpuPrecision,
): { lockstep: Bindings; phased: Bindings; passes: number } {
  const m = moduleOf(src);
  const lockstep = clone(bindings);
  dispatchCompute(m, entry, workgroups, lockstep, precision ? { precision } : undefined);
  const phased = clone(bindings);
  const r = dispatchPhased(m, entry, workgroups, phased, precision ? { precision } : undefined);
  return { lockstep, phased, passes: r.passes };
}

const PROGRAMS: Record<
  string,
  { src: string; entry: string; workgroups: number; bindings: () => Bindings }
> = {
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

describe("a phased dispatch gives the lockstep oracle's memory (change 0054)", () => {
  for (const [name, p] of Object.entries(PROGRAMS)) {
    for (const precision of ['f64', 'f32'] as const) {
      it(`${name} (${precision})`, () => {
        const r = both(p.src, p.entry, p.workgroups, p.bindings(), precision);
        expect(r.phased).toEqual(r.lockstep);
      });
    }
  }

  it('cuts a loop of writes where the log is full, and the passes show it', () => {
    const p = PROGRAMS['several writes in one invocation, past the log']!;
    const plan = splitPhases(autoVars(moduleOf(p.src)), p.entry);
    const kinds = [...plan.cuts.values()].map((c) => c.kind);
    expect(kinds).toContain('log');
    expect(both(p.src, p.entry, p.workgroups, p.bindings()).passes).toBeGreaterThanOrEqual(10);
  });

  it('runs an entry with no cut in one pass', () => {
    const p = PROGRAMS['a write at gid.x']!;
    const plan = splitPhases(autoVars(moduleOf(p.src)), p.entry);
    expect(plan.cuts.size).toBe(0);
    expect(both(p.src, p.entry, p.workgroups, p.bindings()).passes).toBe(1);
  });
});

describe('the phased order of atomic operations across workgroups (change 0054, decision 3a)', () => {
  it('gives the first atomic of every invocation of the dispatch before any second', () => {
    const p = PROGRAMS['atomicAdd with its value, in one workgroup']!;
    const slots = new Array<number>(16).fill(0);
    dispatchPhased(moduleOf(p.src), 'append', 2, { count: 0, slots });
    // Workgroup 0's four invocations, then workgroup 1's, take the first eight slots.
    expect(slots).toEqual([0, 10, 20, 30, 0, 10, 20, 30, 1, 11, 21, 31, 1, 11, 21, 31]);
  });
});

describe('a phased dispatch holds a barrier for the whole workgroup (change 0054)', () => {
  // Invocation 0 writes six values before the barrier, which the log cannot hold in one pass,
  // so it reaches the barrier passes after the others. Each invocation then reads what
  // invocation 0 wrote last. Without the hold, the others would read it before it landed.
  const LATE = `"use typeshade";
declare const out: storage<array<u32>, "read_write">;
let mark: workgroup<array<u32, 8>>;
@compute([4, 1, 1])
export function main(@builtin("local_invocation_index") li: u32): void {
  if (li === 0) {
    for (let k: u32 = 0; k < 6; k++) {
      mark[k] = k + 1;
    }
  } else {
    mark[7] = 9;
  }
  workgroupBarrier();
  out[li] = mark[5] * 10 + mark[li];
}
`;

  it('releases a barrier only when every invocation of the workgroup has reached it', () => {
    const r = both(LATE, 'main', 2, { out: new Array(8).fill(0) });
    expect(r.phased).toEqual(r.lockstep);
    expect(r.phased['out']).toEqual([61, 62, 63, 64, 0, 0, 0, 0]);
    expect(r.passes).toBeGreaterThan(2);
  });

  it('cuts each program where the execution model says', () => {
    const kinds = (name: string): string[] => {
      const p = PROGRAMS[name]!;
      return [...splitPhases(autoVars(moduleOf(p.src)), p.entry).cuts.values()].map((c) => c.kind);
    };
    expect(kinds('a barrier with workgroup memory')).toEqual(['barrier']);
    expect(kinds('atomicAdd with its value, in one workgroup')).toEqual(['atomic', 'atomic']);
    expect(kinds('a helper that waits, an early return, a switch')).toEqual(['barrier']);
    expect(kinds('a reduction, a loop with a barrier')).toContain('barrier');
  });
});

describe('a pass reads memory as it began (change 0054, a data race)', () => {
  it("does not see another invocation's write of the same pass, and sees its own", () => {
    const src = `"use typeshade";
declare const flag: storage<array<u32>, "read_write">;
declare const seen: storage<array<u32>, "read_write">;
@compute([4, 1, 1])
export function main(@builtin("local_invocation_index") li: u32): void {
  flag[li] = li + 1;
  seen[li] = flag[(li + 1) % 4] * 10 + flag[li];
}
`;
    const flag = new Array<number>(4).fill(0);
    const seen = new Array<number>(4).fill(0);
    dispatchPhased(moduleOf(src), 'main', 1, { flag, seen });
    expect(flag).toEqual([1, 2, 3, 4]);
    // The lockstep oracle runs invocation 3 after invocation 0 and reads 10 + 4 there; WGSL
    // allows both, and the phased order is the one WebGL2 gives.
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});

describe('every compute example, phased and in lockstep (change 0054)', () => {
  const dir = fileURLToPath(new URL('../../../examples/', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.shade.ts'));

  /** A value of type `t` for a binding: numbers that differ by position, so a misplaced write
   *  shows; a runtime-sized array gets `length` elements. */
  function valueOf(t: ShaderType, m: ModuleDecl, seed: { n: number }, length: number): CpuValue {
    const next = (): number => (seed.n = (seed.n * 7 + 3) % 61);
    switch (t.kind) {
      case 'scalar':
        return t.scalar === 'bool' ? next() % 2 === 0 : t.scalar === 'f32' ? next() / 8 : next();
      case 'atomic':
        return 0;
      case 'vec':
        return Array.from({ length: t.n }, () => (t.elem === 'f32' ? next() / 8 : next()));
      case 'mat':
        return Array.from({ length: t.cols * t.rows }, () => next() / 8);
      case 'array':
        return Array.from({ length: t.size ?? length }, () =>
          valueOf(t.elem, m, seed, length),
        ) as CpuValue;
      case 'struct': {
        const s = m.structs.find((x) => x.name === t.name)!;
        return Object.fromEntries(s.fields.map((f) => [f.name, valueOf(f.type, m, seed, length)]));
      }
      default:
        throw new Error(`no test value for ${t.kind}`);
    }
  }

  for (const file of files) {
    const src = readFileSync(join(dir, file), 'utf8');
    if (!src.includes('@compute')) continue;
    const r = compile(src);
    if (r.diagnostics.some((d) => d.category === 'error')) continue;
    const m = r.module;
    for (const f of m.funcs) {
      if (stageOf(f) !== 'compute') continue;
      const sampled = m.bindings.some((b) =>
        ['texture', 'storage-texture', 'sampler'].includes(b.type.kind),
      );
      for (const precision of ['f64', 'f32'] as const) {
        it.skipIf(sampled)(`${file}: ${f.name} (${precision})`, () => {
          const make = (): Bindings => {
            const seed = { n: 1 };
            return Object.fromEntries(
              m.bindings.map((b) => [b.name, valueOf(b.type, m, seed, 256)]),
            );
          };
          const lockstep = make();
          dispatchCompute(m, f.name, 2, lockstep, { precision });
          const phased = make();
          dispatchPhased(m, f.name, 2, phased, { precision });
          expect(phased).toEqual(lockstep);
        });
      }
    }
  }
});
