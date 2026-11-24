import { describe, expect, it } from 'vitest';
import { bothTake } from '../testing/both-halves.js';
import { emitModule } from '../backends/wgsl.js';
import { lowerKernel, type KernelPlan, type LowerOptions } from './kernel-lower.js';
import { proveKernels } from './parallel-loop.js';

const FILE = 'm.shade.ts';

function lower(body: string, options: LowerOptions = {}, name = 'k'): KernelPlan {
  const module = bothTake(`"use typeshade";\n${body}\n`, { fileName: FILE }).result.module;
  const proof = proveKernels(module).find((p) => p.fn === name)!;
  const plan = lowerKernel(
    module.funcs.find((f) => f.name === name)!,
    module,
    proof,
    options,
  );
  if ('noGpu' in plan) throw new Error(plan.noGpu);
  return plan;
}

const fieldsOf = (plan: KernelPlan): string[] =>
  plan.module.structs
    .find((s) => s.name === plan.argsStruct)!
    .fields.map((f) => `${f.name}:${f.type.kind === 'scalar' ? f.type.scalar : f.type.kind}`);

const bindingsOf = (plan: KernelPlan): string[] =>
  plan.module.bindings.map((b) => `${String(b.binding)}:${b.name}`);

describe('the names of a kernel function whose array parameters the target reserves (Rule 3.3)', () => {
  const SOURCE = `export function k(out: array<f32>, filter: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) { filter[i] = out[i] * 2.; }
}`;

  it('spells only the reserved name differently in the emitted binding', () => {
    const plan = lower(SOURCE);
    expect([...plan.bindingNames]).toEqual([['filter', 'filter_']]);
    expect(bindingsOf(plan)).toEqual(['0:k_args', '1:out', '2:filter_']);
    expect(emitModule(plan.module)).toContain('var<storage, read_write> filter_: array<f32>;');
  });

  it('keeps the authored name in the facts of the loop', () => {
    const loop = lower(SOURCE).loops[0]!;
    expect(loop.writes).toEqual(['filter']);
    expect(loop.checks.map((c) => c.param)).toContain('filter');
  });

  it('spells a name that is free when the module declares the first spelling', () => {
    const plan = lower(`function filter_(x: f32): f32 { return x; }\n${SOURCE}`);
    const spelled = plan.bindingNames.get('filter')!;
    expect(spelled).not.toBe('filter');
    expect(spelled).not.toBe('filter_');
    expect(bindingsOf(plan)).toContain(`2:${spelled}`);
  });
});

describe('the facts a loop plans, and when a fact is absent', () => {
  it('has no texel, stride or row fact for a loop that has none', () => {
    const loop = lower(`export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i]; }
}`).loops[0]!;
    expect(loop).not.toHaveProperty('texels');
    expect(loop).not.toHaveProperty('strides');
    expect(loop).not.toHaveProperty('rows');
    expect(loop).not.toHaveProperty('device');
  });

  it('names the texture a loop stores into, and the function of its row width', () => {
    const plan =
      lower(`export function k(dst: texture_storage_2d<"r32float", "write">, w: u32, h: u32) {
  for (let i: u32 = 0; i < w * h; i++) { textureStore(dst, vec2u(i % w, i / w), vec4(1.0)); }
}`);
    expect(plan.loops[0]!.texels).toEqual([{ param: 'dst', width: 'k__texel0_0' }]);
    expect(plan.ranges.map((f) => f.name)).toContain('k__texel0_0');
  });

  it('names the functions of a stride and of a row width', () => {
    const strided = lower(`export function k(xs: array<f32>, o2: array<f32>, s: u32) {
  for (let j: u32 = 0; j < xs.length; j++) { o2[j * s + 1] = 1.; }
}`).loops[0]!;
    expect(strided.strides).toEqual([
      { param: 'o2', coefficient: 'k__stride0_0', base: 'k__base0_0' },
    ]);
    const rows = lower(`export function k(o2: array<f32>, w: u32) {
  for (let j: u32 = 0; j < w; j++) { for (let x: u32 = 0; x < w; x++) { o2[j * w + x] = 1.; } }
}`).loops[0]!;
    expect(rows.rows).toEqual([{ param: 'o2', width: 'k__row0_0' }]);
  });

  it('checks no write, stride or row of a loop whose range the device holds', () => {
    const plan = lower(`export function k(c: array<u32>, o2: array<f32>, s: u32) {
  for (let j: u32 = 0; j < c[0]; j++) { o2[j * s] = 1.; }
}`);
    const loop = plan.loops[0]!;
    expect(loop.device).toEqual({ entry: 'k_range0', at: 0 });
    expect(loop.checks).toEqual([]);
    expect(loop).not.toHaveProperty('strides');
    expect(loop).not.toHaveProperty('rows');
    const rows = lower(`export function k(c: array<u32>, o2: array<f32>, w: u32) {
  for (let j: u32 = 0; j < c[0]; j++) { for (let x: u32 = 0; x < w; x++) { o2[j * w + x] = 1.; } }
}`).loops[0]!;
    expect(rows.checks).toEqual([]);
    expect(rows).not.toHaveProperty('rows');
    const affine = lower(`export function k(c: array<u32>, o2: array<f32>) {
  for (let j: u32 = 0; j < c[0]; j++) { o2[j * 2] = 1.; }
}`).loops[0]!;
    expect(affine.checks).toEqual([]);
  });

  it('checks the reads of a loop whose range the host holds, and no guard that reads a texture', () => {
    const guarded = (guard: string): KernelPlan['loops'][number]['checks'] =>
      lower(`export function k(out: array<f32>, xs: array<f32>, t: texture_2d<f32>, ys: array<u32>) {
  for (let i: u32 = 0; i < 8; i++) {
    let v = 0.;
    if (${guard}) { v = xs[i]; }
    out[i] = v;
  }
}`).loops[0]!.checks.filter((c) => c.param === 'xs');
    expect(guarded('i < 4')).toEqual([
      { param: 'xs', a: 1, c: 0, read: true, guards: [{ cop: '<', fn: 'k__guard0_0' }] },
    ]);
    expect(guarded('i < u32(textureLoad(t, vec2u(0, 0), 0).x)')).toEqual([
      { param: 'xs', a: 1, c: 0, read: true },
    ]);
    expect(guarded('i < ys[0]')).toEqual([{ param: 'xs', a: 1, c: 0, read: true }]);
  });
});

describe('the uniform and the bindings of a lowered kernel function', () => {
  it('counts nothing in a function with no loop, whose start is a u32 nothing reads', () => {
    const plan = lower(`export function k(out: array<f32>) { out[0] = 1.; }`);
    expect(plan.loops).toEqual([]);
    expect(fieldsOf(plan)).toEqual(['_start:u32', '_n:u32']);
  });

  it('types the start as the counter of the loops', () => {
    const plan = lower(`export function k(xs: array<f32>, out: array<f32>) {
  for (let i: i32 = 0; i < i32(xs.length); i++) { out[i] = xs[i]; }
}`);
    expect(fieldsOf(plan)).toEqual(['_start:i32', '_n:u32']);
  });

  it('adds the offsets of a level of partials only when a loop reduces or pushes', () => {
    const map = lower(`export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i]; }
}`);
    expect(fieldsOf(map)).toEqual(['_start:u32', '_n:u32']);
    const sum = lower(`export function k(xs: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { s += xs[i]; }
  return s;
}`);
    expect(fieldsOf(sum)).toEqual(['_start:u32', '_n:u32', '_in:u32', '_out:u32']);
  });

  it('puts the trip buffer before the length words, and both after every other binding', () => {
    const plan = lower(
      `export function k(xs: array<f32>, out: array<f32>, c: array<u32>, o2: array<f32>, tex: texture_2d<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  for (let j: u32 = 0; j < c[0]; j++) { o2[j] = xs[j]; }
}`,
      { held: true },
    );
    expect(bindingsOf(plan)).toEqual([
      '0:k_args',
      '1:xs',
      '2:out',
      '3:c',
      '4:o2',
      '5:k_loop0_push',
      '6:tex',
      '7:k_trips',
      '8:k_tripsIn',
      '9:k_len0',
    ]);
    expect(plan.trips).toEqual({ write: 'k_trips', read: 'k_tripsIn' });
    expect(fieldsOf(plan)).toEqual(['_start:u32', '_n:u32', '_in:u32', '_out:u32', '_off0:u32']);
  });

  it('reads what each loop that reduces folded at its own field of the uniform', () => {
    const plan = lower(`export function k(xs: array<f32>, out: array<f32>) {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { s += xs[i]; }
  out[0] = s;
}`);
    expect(plan.finish).toMatchObject({ entry: 'k_finish', writes: ['out'] });
    expect(fieldsOf(plan)).toEqual(['_start:u32', '_n:u32', '_in:u32', '_out:u32', '_at0:u32']);
  });
});

describe('the length word of an array that loops push onto (change 0094)', () => {
  const ONE = `export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
}`;
  const TWO = `export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  for (let j: u32 = 0; j < xs.length; j++) { out.push(xs[j]); }
}`;

  it('has none for one loop with no reader of the length, unless the call holds the length', () => {
    expect(lower(ONE).words).toBeUndefined();
    expect(lower(ONE, { held: true }).words).toEqual([
      { param: 'out', binding: 'k_len0', field: '_off0', loops: [0] },
    ]);
  });

  it('has none for an array whose length only the result reads', () => {
    const plan = lower(`export function k(xs: array<f32>, out: array<f32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  const n = out.length;
  return n;
}`);
    expect(plan.words).toBeUndefined();
    expect(plan.tail).toBeDefined();
  });

  it('has one for an array two loops push onto, listing the loops in order', () => {
    expect(lower(TWO).words).toEqual([
      { param: 'out', binding: 'k_len0', field: '_off0', loops: [0, 1] },
    ]);
  });

  it('has one for an array whose length a statement after the last loop reads', () => {
    const plan = lower(`export function k(xs: array<f32>, out: array<f32>, o2: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  o2[0] = f32(out.length);
}`);
    expect(plan.words).toEqual([{ param: 'out', binding: 'k_len0', field: '_off0', loops: [0] }]);
  });

  it('has one for an array whose length the header of a later loop reads', () => {
    const plan = lower(`export function k(xs: array<f32>, o2: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  for (let j: u32 = 0; j < out.length; j++) { o2[j] = xs[j]; }
}`);
    expect(plan.words).toEqual([{ param: 'out', binding: 'k_len0', field: '_off0', loops: [0] }]);
    expect(plan.loops[1]!.device).toBeDefined();
  });

  it('numbers the word of each pushed array by its place among the pushed arrays', () => {
    const plan = lower(
      `export function k(xs: array<f32>, a: array<f32>, b: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { a.push(xs[i]); }
  for (let j: u32 = 0; j < xs.length; j++) { b.push(xs[j]); }
}`,
      { held: true },
    );
    expect(plan.words).toEqual([
      { param: 'a', binding: 'k_len0', field: '_off0', loops: [0] },
      { param: 'b', binding: 'k_len1', field: '_off1', loops: [1] },
    ]);
  });
});

describe('a name the module already declares', () => {
  const MAP = `export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i]; }
}`;
  const refused = (body: string): string => {
    const module = bothTake(`"use typeshade";\n${body}\n`, { fileName: FILE }).result.module;
    const proof = proveKernels(module).find((p) => p.fn === 'k')!;
    const plan = lowerKernel(
      module.funcs.find((f) => f.name === 'k')!,
      module,
      proof,
    );
    if (!('noGpu' in plan)) throw new Error('the function was lowered');
    return plan.noGpu;
  };

  it.each([
    [
      'the uniform binding',
      'function k_args(): u32 { return 0; }',
      MAP,
      'k_args',
      "the name the call's uniform takes",
    ],
    [
      'the uniform struct',
      'function k_Args(): u32 { return 0; }',
      MAP,
      'k_args',
      "the name the call's uniform takes",
    ],
    [
      'a length word',
      'function k_len0(): u32 { return 0; }',
      `export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  for (let j: u32 = 0; j < xs.length; j++) { out.push(xs[j]); }
}`,
      'k_len0',
      'the name of the length word of "out"',
    ],
    [
      'the trip buffer',
      'function k_trips(): u32 { return 0; }',
      `export function k(c: array<u32>, o2: array<f32>) {
  for (let j: u32 = 0; j < c[0]; j++) { o2[j] = 1.; }
}`,
      'k_trips',
      "the name of the call's trip buffer",
    ],
    [
      'the read binding of the trip buffer',
      'function k_tripsIn(): u32 { return 0; }',
      `export function k(c: array<u32>, o2: array<f32>) {
  for (let j: u32 = 0; j < c[0]; j++) { o2[j] = 1.; }
}`,
      'k_tripsIn',
      "the name of the call's trip buffer",
    ],
  ])('runs on the CPU tier when it declares %s', (_label, declaration, body, name, role) => {
    expect(refused(`${declaration}\n${body}`)).toBe(
      `the module already declares "${name}", ${role}`,
    );
  });
});

describe('the entries and the range function of a loop', () => {
  it('runs a loop that maps at a workgroup of 64, and a loop that reduces at one of 256', () => {
    const map = lower(`export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i]; }
}`);
    expect(map.loops[0]!.wg).toBe(64);
    const sum = lower(`export function k(xs: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { s += xs[i]; }
  return s;
}`);
    expect(sum.loops[0]!.wg).toBe(256);
  });

  it('returns the start and the bound of the range as a pair of the counter type', () => {
    const typeOf = (counter: string, bound: string) =>
      lower(`export function k(xs: array<f32>, out: array<f32>) {
  for (let i: ${counter} = 0; i < ${bound}; i++) { out[i] = xs[i]; }
}`).ranges[0]!.ret;
    expect(typeOf('u32', 'xs.length')).toEqual({ kind: 'vec', n: 2, elem: 'u32' });
    expect(typeOf('i32', 'i32(xs.length)')).toEqual({ kind: 'vec', n: 2, elem: 'i32' });
  });

  it('lists the arrays a loop writes, and not the textures it stores into', () => {
    const plan =
      lower(`export function k(dst: texture_storage_2d<"r32float", "write">, w: u32, h: u32) {
  for (let i: u32 = 0; i < w * h; i++) { textureStore(dst, vec2u(i % w, i / w), vec4(1.0)); }
}`);
    expect(plan.loops[0]!.writes).toEqual([]);
    expect(plan.loops[0]!.texels).toHaveLength(1);
  });

  it('reads the length of a pushed array in the stores after the loops, not in the result after them', () => {
    const plan = lower(`export function k(xs: array<f32>, out: array<f32>, o2: array<f32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  o2[0] = 1.;
  return out.length;
}`);
    expect(plan.finish).toMatchObject({ entry: 'k_finish', writes: ['o2'] });
    expect(plan.words).toBeUndefined();
  });
});
