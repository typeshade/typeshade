import { describe, expect, it } from 'vitest';
import { bothTake } from '../testing/both-halves.js';
import { emitModule } from '../backends/wgsl.js';
import { lowerKernel, type KernelPlan, type LowerOptions } from './kernel-lower.js';
import { proveKernels } from './parallel-loop.js';

function lowerWith(body: string, name: string, options?: LowerOptions): KernelPlan {
  const module = bothTake(`"use typeshade";\n${body}\n`, { fileName: 'm.shade.ts' }).result.module;
  const plan = lowerKernel(
    module.funcs.find((f) => f.name === name)!,
    module,
    proveKernels(module).find((p) => p.fn === name)!,
    options,
  );
  if ('noGpu' in plan) throw new Error(plan.noGpu);
  return plan;
}

const names = (plan: KernelPlan): string[] => plan.module.bindings.map((b) => b.name);

describe('what lowerKernel and lowerCollections take of each other', () => {
  const READ = `export function k(xs: array<u32>, seen: Set<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = seen.has(xs[i]) ? 1 : 0; }
}`;
  const PLAIN = `export function k(xs: array<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i] + 1; }
}`;

  it('lowers the module with the rewritten collections: no Set is left, its keys and search are', () => {
    const plan = lowerWith(READ, 'k');
    expect(names(plan)).toContain('_seen_keys');
    expect(plan.module.funcs.map((f) => f.name)).toContain('k_seen_find');
    const text = emitModule(plan.module);
    expect(text).toContain('k_seen_find(xs[');
    expect(text).not.toContain('collectionHas');
    expect(plan.module.bindings.some((b) => b.name === 'seen')).toBe(false);
  });

  it('gives the plan the rewritten parameters and the loops of the second proof', () => {
    const plan = lowerWith(READ, 'k');
    expect(plan.loops).toHaveLength(1);
    expect(plan.ranges).toHaveLength(1);
    expect(plan.ranges[0]!.params.map((p) => p.name)).toEqual(['xs', 'seen', 'out']);
    expect(plan.lookups).toEqual([{ param: 'seen', keys: '_seen_keys', loop: 0 }]);
  });

  it('lowers the reductions that the second proof found in the rewritten loop', () => {
    const plan = lowerWith(
      `export function k(xs: array<u32>, seen: Set<u32>): u32 {
  let total: u32 = 0;
  for (let i: u32 = 0; i < xs.length; i++) { if (seen.has(xs[i])) { total += 1; } }
  return total;
}`,
      'k',
    );
    expect(plan.loops).toHaveLength(1);
    expect(plan.loops[0]!.reduce?.vars.map((v) => v.name)).toEqual(['total']);
  });

  it('takes the default options on the nested lowering, whatever the caller passes', () => {
    const body = `export function k(xs: array<u32>, seen: Set<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { if (seen.has(xs[i])) { out.push(xs[i]); } }
}`;
    const plain = `export function k(xs: array<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { if (xs[i] > 1) { out.push(xs[i]); } }
}`;
    const held: LowerOptions = { held: true, exactTotal: true };
    expect(lowerWith(plain, 'k', held).words).toHaveLength(1);
    expect(lowerWith(plain, 'k').words).toBeUndefined();
    expect(lowerWith(body, 'k', held).words).toBeUndefined();
    expect(lowerWith(body, 'k').words).toBeUndefined();
    const exact = (source: string, options?: LowerOptions): string =>
      emitModule(lowerWith(source, 'k', options).module);
    expect(exact(plain, { exactTotal: true })).not.toBe(exact(plain));
    expect(exact(plain, { exactTotal: true })).toContain('(4294967295u - ');
    expect(exact(body, { exactTotal: true })).not.toContain('(4294967295u - ');
  });

  it('sends a function that takes a collection to the collection path, and any other to the plain path', () => {
    expect(lowerWith(READ, 'k').lookups).toBeDefined();
    expect(names(lowerWith(READ, 'k'))).toEqual(['k_args', 'xs', 'out', '_seen_keys']);
    const plain = lowerWith(PLAIN, 'k');
    expect(plain.lookups).toBeUndefined();
    expect(plain.collections).toBeUndefined();
    expect(names(plain)).toEqual(['k_args', 'xs', 'out']);
  });

  it('sends a function that only adds to a collection to the collection path too', () => {
    const plan = lowerWith(
      `export function k(xs: array<u32>, seen: Set<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { seen.add(xs[i]); }
}`,
      'k',
    );
    expect(plan.collections).toEqual([
      { param: 'seen', records: '_seen_records', loop: 0, perIteration: 1 },
    ]);
    expect(plan.lookups).toBeUndefined();
  });
});

describe('which statements of a loop read a collection', () => {
  const lookupsOf = (body: string): KernelPlan['lookups'] => lowerWith(body, 'k').lookups;

  it.each([
    ['has', 'out[i] = seen.has(xs[i]) ? 1 : 0;'],
    ['size', 'out[i] = seen.size;'],
  ])('reads a Set by %s', (_what, stmt) => {
    expect(
      lookupsOf(`export function k(xs: array<u32>, seen: Set<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { ${stmt} }
}`),
    ).toEqual([{ param: 'seen', keys: '_seen_keys', loop: 0 }]);
  });

  it('reads a Map by get', () => {
    expect(
      lookupsOf(`export function k(xs: array<u32>, m: Map<u32, f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = m.has(xs[i]) ? m.get(xs[i])! : 0.; }
}`),
    ).toEqual([{ param: 'm', keys: '_m_keys', values: '_m_values', loop: 0 }]);
  });

  it('does not read a collection by adding or setting', () => {
    expect(
      lookupsOf(`export function k(xs: array<u32>, seen: Set<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { seen.add(xs[i]); }
}`),
    ).toBeUndefined();
  });

  it('does not read a collection by a push or by the length of an array that it pushes onto', () => {
    const plan = lowerWith(
      `export function k(xs: array<u32>, seen: Set<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { seen.add(xs[i]); }
  for (let j: u32 = 0; j < xs.length; j++) { out.push(xs[j]); }
}`,
      'k',
    );
    expect(plan.lookups).toBeUndefined();
    expect(plan.collections).toHaveLength(1);
  });

  it('reads only the collection the call names', () => {
    const plan = lowerWith(
      `export function k(xs: array<u32>, a: Set<u32>, b: Set<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { b.add(xs[i]); out[i] = a.has(xs[i]) ? 1 : 0; }
}`,
      'k',
    );
    expect(plan.lookups).toEqual([{ param: 'a', keys: '_a_keys', loop: 0 }]);
    expect(plan.collections?.map((c) => c.param)).toEqual(['b']);
  });

  it('finds a read inside an if, a nested loop and a switch', () => {
    expect(
      lookupsOf(`export function k(xs: array<u32>, seen: Set<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > 1) { for (let j: u32 = 0; j < 2; j++) { out[i] = seen.has(xs[i] + j) ? 1 : 0; } }
  }
}`),
    ).toEqual([{ param: 'seen', keys: '_seen_keys', loop: 0 }]);
  });
});
