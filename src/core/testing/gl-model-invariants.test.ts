import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import type { ModuleDecl } from '../ir/index.js';
import type { CpuValue } from '../cpu-runtime.js';
import { runGlModel, storageFloats, storageWords } from './gl-model.js';

const moduleOf = (src: string): ModuleDecl => {
  const r = compile(src);
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return r.module;
};

describe('the GL model: loads and stores of one pass', () => {
  it('a load answers with the latest write of the invocation to that word', () => {
    const m = moduleOf(`"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  out[gid.x] = 1;
  out[gid.x] = 2;
  out[gid.x + 4] = out[gid.x];
}
`);
    const bindings = { out: new Array(8).fill(0) as CpuValue };
    runGlModel(m, 'main', 1, bindings);
    expect(bindings.out).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
  });

  it('a load of a word the invocation did not write sees memory as the pass began', () => {
    const m = moduleOf(`"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  if (gid.x == 0) {
    out[1] = 5;
  }
  out[gid.x + 4] = out[1];
}
`);
    const bindings = { out: [9, 9, 9, 9, 0, 0, 0, 0] as CpuValue };
    runGlModel(m, 'main', 1, bindings);
    expect(bindings.out).toEqual([9, 5, 9, 9, 5, 9, 9, 9]);
  });

  it('the scatter writes the logs in invocation index order, so the last invocation wins', () => {
    const m = moduleOf(`"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  out[0] = gid.x + 1;
}
`);
    const bindings = { out: [0] as CpuValue };
    runGlModel(m, 'main', 1, bindings);
    expect(bindings.out).toEqual([4]);
  });

  it('the log of a pass holds the writes that logEntries allows, and a longer pass is cut into more passes', () => {
    const m = moduleOf(`"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  out[gid.x * 6] = 1;
  out[gid.x * 6 + 1] = 2;
  out[gid.x * 6 + 2] = 3;
  out[gid.x * 6 + 3] = 4;
  out[gid.x * 6 + 4] = 5;
  out[gid.x * 6 + 5] = 6;
}
`);
    const wide = runGlModel(m, 'main', 1, { out: new Array(24).fill(0) as CpuValue });
    const narrow = runGlModel(
      m,
      'main',
      1,
      { out: new Array(24).fill(0) as CpuValue },
      {
        logEntries: 1,
      },
    );
    expect(wide.maxLogWords).toBe(4);
    expect(wide.passes).toBe(2);
    expect(narrow.maxLogWords).toBe(1);
    expect(narrow.passes).toBe(6);
  });

  it('reports the words of the single store of a one-write pass', () => {
    const m = moduleOf(`"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  out[gid.x] = gid.x;
}
`);
    const r = runGlModel(m, 'main', 1, { out: new Array(4).fill(0) as CpuValue });
    expect(r.maxLogWords).toBe(1);
    expect(r.passes).toBe(1);
  });
});

describe('the GL model: atomics and memory', () => {
  it('the resolve pass performs the atomic requests in invocation index order', () => {
    const m = moduleOf(`"use typeshade";
declare const count: storage<atomic<u32>, "read_write">;
declare const slots: storage<array<u32>, "read_write">;
@compute([4, 1, 1]) export function append(li: builtin<"local_invocation_index">): void {
  const first = atomicAdd(count, 1);
  slots[first] = li * 10;
}
`);
    const bindings = { count: 0 as CpuValue, slots: new Array(4).fill(0) as CpuValue };
    runGlModel(m, 'append', 1, bindings);
    expect(bindings.slots).toEqual([0, 10, 20, 30]);
    expect(bindings.count).toBe(4);
  });

  it('a workgroup variable is one memory for each workgroup', () => {
    const m = moduleOf(`"use typeshade";
declare const out: storage<array<u32>, "read_write">;
let tile: workgroup<array<u32, 4>>;
@compute([4, 1, 1]) export function main(
  gid: builtin<"global_invocation_id">,
  li: builtin<"local_invocation_index">,
  wid: builtin<"workgroup_id">,
): void {
  tile[li] = wid.x * 100 + li;
  workgroupBarrier();
  out[gid.x] = tile[3 - li];
}
`);
    const bindings = { out: new Array(8).fill(0) as CpuValue };
    runGlModel(m, 'main', 2, bindings);
    expect(bindings.out).toEqual([3, 2, 1, 0, 103, 102, 101, 100]);
  });

  it('an i32 word goes back to the binding as a signed number', () => {
    const m = moduleOf(`"use typeshade";
declare const ids: storage<array<i32>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  ids[gid.x] = ids[gid.x] - 5;
}
`);
    const bindings = { ids: [1, 2, 3, 4] as CpuValue };
    runGlModel(m, 'main', 1, bindings);
    expect(bindings.ids).toEqual([-4, -3, -2, -1]);
  });

  it('writes an array binding back in place and replaces a scalar binding', () => {
    const m = moduleOf(`"use typeshade";
declare const count: storage<atomic<u32>, "read_write">;
declare const out: storage<array<u32>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  atomicAdd(count, 2);
  out[gid.x] = gid.x + 1;
}
`);
    const out = new Array(4).fill(0);
    const bindings: Record<string, CpuValue> = { count: 0, out: out as CpuValue };
    runGlModel(m, 'main', 1, bindings);
    expect(bindings.out).toBe(out);
    expect(out).toEqual([1, 2, 3, 4]);
    expect(bindings.count).toBe(8);
  });

  it('refuses an entry that is not a compute entry and a storage binding without a value', () => {
    const m = moduleOf(`"use typeshade";
declare const out: storage<array<u32>, "read_write">;
@compute([4, 1, 1]) export function main(gid: builtin<"global_invocation_id">): void {
  out[gid.x] = 1;
}
`);
    expect(() => runGlModel(m, 'nothing', 1, { out: [0, 0, 0, 0] as CpuValue })).toThrow(
      'gl-model: "nothing" is not a @compute entry',
    );
    expect(() => runGlModel(m, 'main', 1, {})).toThrow("gl-model: no value for binding 'out'");
  });
});

describe('the GL model: the words of a storage binding', () => {
  const m = moduleOf(`"use typeshade";
class P { pos: vec3f; mass: f32; tag: u32; }
declare const ps: storage<array<P>, "read_write">;
declare const ids: storage<array<i32>, "read_write">;
declare const fs: storage<array<f32>, "read_write">;
declare const iv: storage<array<vec2i>, "read_write">;
@compute([1, 1, 1]) export function main(): void {
  ps[0].tag = 1;
  ids[0] = 1;
  fs[0] = 1.;
}
`);
  const bindings: Record<string, CpuValue> = {
    ps: [{ pos: [1, 2, 3], mass: 4, tag: 5 }] as unknown as CpuValue,
    ids: [-1, 2] as CpuValue,
    fs: [1, 2] as CpuValue,
    iv: [[1, 2]] as unknown as CpuValue,
  };

  it('storageWords gives the std430 words of each storage binding', () => {
    const words = storageWords(m, bindings);
    expect(Array.from(words.ids!)).toEqual([0xffffffff, 2]);
    expect(Array.from(words.fs!)).toEqual([0x3f800000, 0x40000000]);
    expect(words.ps!.length).toBe(8);
    expect(words.ps![3]).toBe(0x40800000);
    expect(words.ps![4]).toBe(5);
  });

  it('storageFloats marks only the words that hold an f32', () => {
    const marks = storageFloats(m, bindings);
    expect(Array.from(marks.ps!)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(Array.from(marks.ids!)).toEqual([0, 0]);
    expect(Array.from(marks.fs!)).toEqual([1, 1]);
    expect(Array.from(marks.iv!)).toEqual([0, 0]);
  });
});
