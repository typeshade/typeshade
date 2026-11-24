import { describe, expect, it } from 'vitest';
import { bothHalves, bothTake } from '../testing/both-halves.js';
import { emitModule } from '../backends/wgsl.js';
import { orderWord } from '../host-kernel.js';
import { compileModule } from '../oracle.js';
import { lowerKernel, type KernelPlan } from './kernel-lower.js';
import { proveKernels } from './parallel-loop.js';

const NOT_FOUND = 0xffffffff;

function lower(body: string, name: string): KernelPlan {
  const module = bothTake(`"use typeshade";\n${body}\n`, { fileName: 'm.shade.ts' }).result.module;
  const proof = proveKernels(module).find((p) => p.fn === name)!;
  const plan = lowerKernel(
    module.funcs.find((f) => f.name === name)!,
    module,
    proof,
  );
  if ('noGpu' in plan) throw new Error(plan.noGpu);
  return plan;
}

function refusal(body: string, name: string, editor: readonly string[] = []): string {
  const halves = bothHalves(`"use typeshade";\n${body}\n`, { fileName: 'm.shade.ts' });
  expect(halves.compiler).toEqual([]);
  expect(halves.editor).toEqual(editor);
  const module = halves.result.module;
  const plan = lowerKernel(
    module.funcs.find((f) => f.name === name)!,
    module,
    proveKernels(module).find((p) => p.fn === name)!,
  );
  if (!('noGpu' in plan)) throw new Error('the function was lowered');
  return plan.noGpu;
}

const HAS = (
  key: string,
): string => `export function has(keys: array<${key}>, m: Set<${key}>, out: array<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) { out[i] = m.has(keys[i]) ? 1 : 0; }
}`;

function finder(key: 'u32' | 'i32' | 'f32', held: readonly number[]) {
  const plan = lower(HAS(key), 'has');
  const device = compileModule(plan.module, { precision: 'f32' });
  const words = held.map((k) => orderWord(key, k)).sort((a, b) => a - b);
  device.setBinding('_m_keys', [words.length, ...words] as never);
  const find = device.fns.has_m_find!;
  return (k: number): number => find(k as never) as number;
}

describe('the search of the keys of a Map or a Set (change 0080)', () => {
  it('gives the index of a u32 key among the sorted words, or the word for a key it does not hold', () => {
    const find = finder('u32', [30, 5, 9, 20]);
    expect([5, 9, 20, 30].map(find)).toEqual([0, 1, 2, 3]);
    expect([0, 6, 10, 21, 31, 0xffffffff].map(find)).toEqual(Array(6).fill(NOT_FOUND));
  });

  it('searches an empty collection, and a collection of one key', () => {
    expect(finder('u32', [])(0)).toBe(NOT_FOUND);
    expect(finder('u32', [7])(7)).toBe(0);
    expect(finder('u32', [7])(8)).toBe(NOT_FOUND);
  });

  it('finds each of a hundred keys, and none of the keys between them, in at most 32 steps', () => {
    const held = Array.from({ length: 100 }, (_, i) => i * 3 + 1);
    const find = finder('u32', held);
    expect(held.map(find)).toEqual(held.map((_, i) => i));
    expect(held.map((k) => find(k + 1))).toEqual(held.map(() => NOT_FOUND));
    expect(find(0)).toBe(NOT_FOUND);
  });

  it('reads an i32 key as its bits, so a negative key sorts after a positive one', () => {
    const find = finder('i32', [-5, 0, 3, 100, -2147483648]);
    expect([0, 3, 100, -2147483648, -5].map(find)).toEqual([0, 1, 2, 3, 4]);
    expect([1, -1, 4].map(find)).toEqual(Array(3).fill(NOT_FOUND));
  });

  it('reads an f32 key as equal to another when SameValueZero says so', () => {
    const find = finder('f32', [0, 1.5, NaN, -3, 7]);
    expect(find(-0)).toBe(find(0));
    expect(find(0)).not.toBe(NOT_FOUND);
    expect(find(NaN)).not.toBe(NOT_FOUND);
    expect(find(Number.NaN)).toBe(find(NaN));
    expect([1.5, -3, 7].every((k) => find(k) !== NOT_FOUND)).toBe(true);
    expect([2, 8, -1.5, Infinity].map(find)).toEqual(Array(4).fill(NOT_FOUND));
  });

  it('tells apart the keys of an i32 collection that share their low bits', () => {
    const find = finder('i32', [1, -1]);
    expect(find(1)).not.toBe(find(-1));
    expect(find(65537)).toBe(NOT_FOUND);
  });
});

describe('how a loop reads a Map or a Set (change 0080)', () => {
  const LOOKUPS = `export function lookup(keys: array<u32>, m: Map<u32, f32>, out: array<f32>) {
  for (let i: u32 = 0; i < keys.length; i++) { out[i] = m.has(keys[i]) ? m.get(keys[i])! : -1.; }
}
export function measured(keys: array<u32>, m: Set<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) { out[i] = m.size + keys[i]; }
}`;

  it('takes the size from the count at the first word of the keys', () => {
    const plan = lower(LOOKUPS, 'measured');
    expect(plan.lookups).toEqual([{ param: 'm', keys: '_m_keys', loop: 0 }]);
    expect(entryText(plan, 'measured_loop0')).toContain('_m_keys[0u]');
  });

  it('tests a key by the search, and reads a Map value at the index it gives', () => {
    const plan = lower(LOOKUPS, 'lookup');
    expect(plan.lookups).toEqual([{ param: 'm', keys: '_m_keys', values: '_m_values', loop: 0 }]);
    const text = entryText(plan, 'lookup_loop0');
    expect(text).toContain('lookup_m_find(keys[');
    expect(text).toContain('!= 4294967295u');
    expect(text).toContain('= lookup_m_find(keys[i]);');
    expect(text).toContain('_sel0 = _m_values[_gv0];');
  });

  it('adds nothing to the records of a loop that only reads', () => {
    const plan = lower(LOOKUPS, 'lookup');
    expect(plan.collections).toBeUndefined();
  });
});

describe('how a loop adds to a Map or a Set (change 0080)', () => {
  const ADDS = `export function labels(pixels: array<u32>, seen: Set<u32>): u32 {
  for (let i: u32 = 0; i < pixels.length; i++) { if (pixels[i] !== 0) { seen.add(pixels[i]); } }
  return seen.size;
}
export function latest(keys: array<u32>, values: array<f32>, last: Map<u32, f32>) {
  for (let i: u32 = 0; i < keys.length; i++) { last.set(keys[i], values[i]); }
}`;

  it('pushes the key of a Set, and the key with the value of a Map, onto an array of its own', () => {
    const set = lower(ADDS, 'labels');
    expect(set.collections).toEqual([
      { param: 'seen', records: '_seen_records', loop: 0, perIteration: 1 },
    ]);
    expect(set.module.bindings.map((b) => b.name)).toContain('_seen_records');
    const map = lower(ADDS, 'latest');
    expect(map.collections).toEqual([
      { param: 'last', records: '_last_records', loop: 0, perIteration: 1 },
    ]);
    expect(map.module.structs.find((s) => s.name === 'latest_last_Entry')?.fields).toEqual([
      { name: 'k', type: { kind: 'scalar', scalar: 'u32' } },
      { name: 'v', type: { kind: 'scalar', scalar: 'f32' } },
    ]);
  });

  it('leaves what is outside the loops to the CPU tier, which reads the collection itself', () => {
    const plan = lower(ADDS, 'labels');
    const names = (fn: string): string[] =>
      plan.ranges.find((f) => f.name === fn)!.params.map((p) => p.name);
    expect(names('labels__range0')).toEqual(['pixels', 'seen']);
    expect(names('labels__tail')).toEqual(['pixels', 'seen', '_t0_push__seen_records']);
    const tail = plan.ranges.find((f) => f.name === 'labels__tail')!;
    expect(JSON.stringify(tail.body)).toContain('collectionSize');
  });

  it('counts the adds of every arm of an if and of a switch an iteration may make', () => {
    const switched = lower(
      `export function k(keys: array<u32>, seen: Set<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) {
    switch (keys[i]) { case 1: { seen.add(1); seen.add(2); break; } default: { seen.add(keys[i]); } }
  }
}`,
      'k',
    );
    expect(switched.collections).toEqual([
      { param: 'seen', records: '_seen_records', loop: 0, perIteration: 3 },
    ]);
    const branched = lower(
      `export function k(keys: array<u32>, seen: Set<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) {
    if (keys[i] > 1) { seen.add(1); } else { seen.add(2); seen.add(3); }
  }
}`,
      'k',
    );
    expect(branched.collections![0]!.perIteration).toBe(3);
  });

  it('refuses an add inside a loop that sits in a switch', () => {
    const module = bothTake(
      `"use typeshade";
export function k(keys: array<u32>, seen: Set<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) {
    switch (keys[i]) { case 1: { for (let q: u32 = 0; q < 2; q++) { seen.add(q); } break; } default: { } }
  }
}
`,
      { fileName: 'm.shade.ts' },
    ).result.module;
    const plan = lowerKernel(
      module.funcs.find((f) => f.name === 'k')!,
      module,
      proveKernels(module).find((p) => p.fn === 'k')!,
    );
    expect(plan).toEqual({
      noGpu:
        'loop 1 adds to the Set "seen" inside a nested loop, whose trips the call does not count',
    });
  });

  it('leaves a read of the collection outside the loops to the CPU tier, whatever a loop reads', () => {
    const plan = lower(
      `export function k(keys: array<u32>, m: Set<u32>, out: array<u32>): u32 {
  for (let i: u32 = 0; i < keys.length; i++) { out[i] = m.has(keys[i]) ? 1 : 0; }
  return m.size;
}`,
      'k',
    );
    const tail = plan.ranges.find((f) => f.name === plan.tail)!;
    expect(tail.params.map((p) => p.name)).toEqual(['keys', 'm', 'out']);
    expect(JSON.stringify(tail.body)).toContain('collectionSize');
    expect(JSON.stringify(tail.body)).not.toContain('_m_keys');
  });

  it('gives each record array a name the module does not use', () => {
    const plan = lower(`function _seen_records(): u32 { return 0; }\n${ADDS}`, 'labels');
    expect(plan.collections![0]!.records).toBe('__seen_records');
    const entry = lower(`function latest_last_Entry(): u32 { return 0; }\n${ADDS}`, 'latest');
    expect(entry.module.structs.map((s) => s.name)).toContain('_latest_last_Entry');
  });

  it('gives the keys and the search of a collection a name the module does not use', () => {
    const plan = lower(`function _m_keys(): u32 { return 0; }\n${LOOKUPS_FOR_NAMES}`, 'measured');
    expect(plan.lookups).toEqual([{ param: 'm', keys: '__m_keys', loop: 0 }]);
  });
});

describe('a loop that reads a Set the call uploads once (change 0080)', () => {
  it.each([
    [
      'a later loop adds to it',
      `export function k(xs: array<u32>, out: array<u32>, seen: Set<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = seen.has(xs[i]) ? 1 : 0; }
  for (let j: u32 = 0; j < xs.length; j++) { seen.add(xs[j]); }
}`,
      'loop 2 adds to the Set "seen", which loop 1 reads before it, and the call uploads a collection once',
    ],
  ])('runs on the CPU tier when %s', (_label, body, message) => {
    expect(refusal(body, 'k')).toBe(message);
  });

  it('runs on the CPU tier when the loop that reads it also adds to it', () => {
    const body = `export function k(xs: array<u32>, out: array<u32>, seen: Set<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = seen.has(xs[i]) ? 1 : 0; seen.add(xs[i]); }
}`;
    const warning =
      'typeshade TS8070: This loop runs on the CPU because line 3 reads "seen", a Set the loop adds to, whose entries depend on the iterations before. Read it after the loop, or in a later loop that does not add to it.';
    expect(refusal(body, 'k', [warning])).toBe(
      'loop 1 adds to the Set "seen", which loop 1 reads before it, and the call uploads a collection once',
    );
  });

  it('lowers when an earlier loop adds and a later loop reads', () => {
    const plan = lower(
      `export function k(xs: array<u32>, out: array<u32>, seen: Set<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { seen.add(xs[i]); }
  for (let j: u32 = 0; j < xs.length; j++) { out[j] = seen.has(xs[j]) ? 1 : 0; }
}`,
      'k',
    );
    expect(plan.lookups).toEqual([{ param: 'seen', keys: '_seen_keys', loop: 1 }]);
  });
});

const LOOKUPS_FOR_NAMES = `export function measured(keys: array<u32>, m: Set<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) { out[i] = m.size + keys[i]; }
}`;

function entryText(plan: KernelPlan, name: string): string {
  const text = emitModule(plan.module);
  const start = text.indexOf(`fn ${name}(`);
  return text.slice(start, text.indexOf('\n}\n', start) + 2);
}
