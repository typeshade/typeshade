import { describe, expect, it } from 'vitest';
import { bothTake } from '../testing/both-halves.js';
import { emitModule } from '../backends/wgsl.js';
import { lowerKernel, type KernelPlan } from './kernel-lower.js';
import { proveKernels } from './parallel-loop.js';

function lowerAny(body: string): KernelPlan | { readonly noGpu: string } {
  const module = bothTake(`"use typeshade";\n${body}\n`, { fileName: 'm.shade.ts' }).result.module;
  const proof = proveKernels(module).find((p) => p.fn === 'k')!;
  return lowerKernel(
    module.funcs.find((f) => f.name === 'k')!,
    module,
    proof,
  );
}

function lower(body: string): KernelPlan {
  const plan = lowerAny(body);
  if ('noGpu' in plan) throw new Error(plan.noGpu);
  return plan;
}

function noGpu(body: string): string {
  const plan = lowerAny(body);
  if (!('noGpu' in plan)) throw new Error('the function was lowered');
  return plan.noGpu;
}

describe('a continue of the loop itself', () => {
  const loop = (body: string): string => `export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { ${body} }
}`;

  it.each([
    ['none', 'out[i] = xs[i];', false],
    ['one under an if', 'if (xs[i] > 1.) { continue; } out[i] = xs[i];', true],
    ['one in the else of an if', 'if (xs[i] > 1.) { out[i] = 1.; } else { continue; }', true],
    [
      'one in a case of a switch',
      'switch (i) { case 1: { continue; } default: { out[i] = 2.; } }',
      true,
    ],
    [
      'one in the default of a switch',
      'switch (i) { case 1: { out[i] = 1.; break; } default: { continue; } }',
      true,
    ],
    [
      'one that belongs to an inner loop',
      'for (let q: u32 = 0; q < 2; q++) { if (q == 1) { continue; } } out[i] = 1.;',
      false,
    ],
  ])('is planned for a loop with %s: %s', (_label, body, continues) => {
    const plan = lower(loop(body));
    expect(plan.loops[0]!.continues).toBe(continues);
  });

  it.each([
    ['an if', 'if (xs[i] > 1.) { continue; } out[i] = xs[i];'],
    ['the else of an if', 'if (xs[i] > 1.) { out[i] = 1.; } else { continue; }'],
    ['a case of a switch', 'switch (i) { case 1: { continue; } default: { out[i] = 2.; } }'],
    [
      'the default of a switch',
      'switch (i) { case 1: { out[i] = 1.; break; } default: { continue; } }',
    ],
  ])('becomes a return of the entry under %s', (_label, body) => {
    const text = emitModule(lower(loop(body)).module);
    const entry = text.slice(text.indexOf('fn k_loop0('));
    expect(entry.slice(entry.indexOf('let _live'))).toContain('return;');
    expect(entry).not.toContain('continue;');
  });
});

describe('an integer array a loop scatters into (change 0119, #348)', () => {
  const ATOMIC = (plan: KernelPlan): string[] =>
    plan.module.bindings
      .filter((b) => b.type.kind === 'array' && b.type.elem.kind === 'atomic')
      .map((b) => b.name);

  it('is an array of atomics, and each write keeps its own operator', () => {
    const plan = lower(`export function k(keys: array<u32>, bins: array<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) { bins[keys[i] % 4] &= keys[i]; }
  for (let j: u32 = 0; j < keys.length; j++) { bins[j % 4] |= 1; }
}`);
    expect(ATOMIC(plan)).toEqual(['bins']);
    const text = emitModule(plan.module);
    expect(text).toContain('atomicAnd(&bins[');
    expect(text).toContain('atomicOr(&bins[');
    expect(plan.loops.map((l) => l.writes)).toEqual([['bins'], ['bins']]);
  });

  it('may be measured by its length in a later loop, which reads no element', () => {
    const plan = lower(`export function k(keys: array<u32>, bins: array<u32>, o: array<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) { bins[keys[i] % 4] += 1; }
  for (let j: u32 = 0; j < bins.length; j++) { o[j] = j; }
}`);
    expect(ATOMIC(plan)).toEqual(['bins']);
  });

  it.each([
    [
      'a loop reads an element',
      `export function k(keys: array<u32>, bins: array<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) { bins[keys[i] % 4] += 1; }
  for (let j: u32 = 0; j < keys.length; j++) { out[j] = bins[j % 4]; }
}`,
      'a loop reads "bins", which a loop scatters into: an atomic is read only by an atomic',
    ],
    [
      'a loop reads an element of a vector array',
      `export function k(keys: array<u32>, bins: array<vec2u>) {
  for (let i: u32 = 0; i < keys.length; i++) { bins[keys[i] % 4].x += 1; }
}`,
      'a loop reads "bins", which a loop scatters into: an atomic is read only by an atomic',
    ],
    [
      'the index of an add reads an element of it',
      `export function k(keys: array<u32>, a: array<u32>, b: array<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) { a[keys[i] % 4] += 1; }
  for (let j: u32 = 0; j < keys.length; j++) { b[a[j % 4] % 4] += 1; }
}`,
      'a loop reads "a", which a loop scatters into: an atomic is read only by an atomic',
    ],
    [
      'another loop writes it in place',
      `export function k(keys: array<u32>, bins: array<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) { bins[keys[i] % 4] += 1; }
  for (let j: u32 = 0; j < keys.length; j++) { bins[j] = 0; }
}`,
      'a loop writes "bins" in place, and another scatters into it',
    ],
    [
      'a statement after the loops stores into it',
      `export function k(keys: array<u32>, bins: array<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) { bins[keys[i] % 4] += 1; }
  bins[0] = 7;
}`,
      'a statement after its loops reaches "bins", which a loop scatters into: an atomic is read and written only by an atomic',
    ],
    [
      'a statement after the loops reads it',
      `export function k(keys: array<u32>, bins: array<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) { bins[keys[i] % 4] += 1; }
  out[0] = bins[0];
}`,
      'a statement after its loops reaches "bins", which a loop scatters into: an atomic is read and written only by an atomic',
    ],
  ])('runs on the CPU tier when %s', (_label, body, message) => {
    expect(noGpu(body)).toBe(message);
  });

  it('names a reserved array by its authored name in the refusal that reads it (Rule 3.3)', () => {
    expect(
      noGpu(`export function k(keys: array<u32>, filter: array<u32>, o: array<u32>) {
  for (let i: u32 = 0; i < keys.length; i++) { filter[keys[i] % 4] += 1; }
  for (let j: u32 = 0; j < keys.length; j++) { o[j] = filter[j % 4]; }
}`),
    ).toBe(
      'a loop reads "filter", which a loop scatters into: an atomic is read only by an atomic',
    );
  });
});

describe('the result and the stores of a kernel function', () => {
  it.each([
    [
      'an element of an array',
      `export function k(xs: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { s += xs[i]; }
  return s + xs[0];
}`,
      "its result reads an array's elements, which the call computes on the CPU tier",
    ],
    [
      'a texel of a texture',
      `export function k(xs: array<f32>, tex: texture_2d<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { s += xs[i]; }
  return s + textureLoad(tex, vec2u(0, 0), 0).x;
}`,
      'its result reads the texture "tex", which the call computes on the CPU tier',
    ],
  ])('runs on the CPU tier when the result reads %s', (_label, body, message) => {
    expect(noGpu(body)).toBe(message);
  });

  it('runs on the CPU tier when a store after the loops follows a read of a texture', () => {
    expect(
      noGpu(`export function k(xs: array<f32>, out: array<f32>, tex: texture_2d<f32>) {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { s += xs[i]; }
  out[0] = s + textureLoad(tex, vec2u(0, 0), 0).x;
}`),
    ).toBe('a statement after its loops reads the texture "tex"');
  });

  it('reads the length of an array only through its length word in the stores after the loops', () => {
    const plan = lower(`export function k(xs: array<f32>, out: array<f32>, o2: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  o2[0] = f32(out.length);
}`);
    const text = emitModule(plan.module);
    const finish = text.slice(text.indexOf('fn k_finish('));
    expect(finish).toContain('k_len0[k_args._off0]');
    expect(plan.finish).toMatchObject({ entry: 'k_finish', writes: ['o2'] });
  });

  it('reads what a loop pushed, from the count the call reads back, in the result', () => {
    const plan = lower(`export function k(xs: array<f32>, out: array<f32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  return out.length;
}`);
    const tail = plan.ranges.find((f) => f.name === plan.tail)!;
    expect(tail.params.map((p) => p.name)).toEqual(['xs', 'out', '_t0_push_out']);
    expect(tail.body).toMatchObject([{ s: 'return', expr: { op: 'param', name: '_t0_push_out' } }]);
  });

  it('keeps a store after the loops out of the result, and replays the scalar statements before it', () => {
    const plan = lower(`export function k(xs: array<f32>, out: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { s += xs[i]; }
  out[0] = s;
  return s;
}`);
    const tail = plan.ranges.find((f) => f.name === plan.tail)!;
    expect(tail.body).toMatchObject([
      { s: 'var', name: 's' },
      { s: 'assign', target: { op: 'varref', name: 's' }, expr: { op: 'binop', bop: '+' } },
      { s: 'return', expr: { op: 'varref', name: 's' } },
    ]);
    const finish = plan.ranges.find((f) => f.name === plan.finish!.fn)!;
    expect(finish.body).toMatchObject([
      { s: 'var', name: 's' },
      { s: 'assign', target: { op: 'varref', name: 's' } },
      {
        s: 'if',
        arms: [{ body: [{ s: 'assign', target: { op: 'index', base: { name: 'out' } } }] }],
      },
    ]);
  });
});
