import { describe, expect, it } from 'vitest';
import type { ShaderType } from '../ir/types.js';
import { lowerKernel } from './kernel-lower.js';
import { type KernelProof } from './parallel-loop.js';
import {
  lowered,
  lowerFrom,
  noGpu,
  refusedByProof,
  type Lowered,
} from './kernel-lower-refusal-helpers.js';

const MAP = 'for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i]; }';

describe('a kernel function with nothing to dispatch', () => {
  it.each([
    ['no statement', 'export function k(xs: array<f32>, out: array<f32>) { }'],
    [
      'a result and no loop',
      'export function k(xs: array<f32>, out: array<f32>): f32 { return 1.; }',
    ],
  ])('runs on the CPU tier with %s', (_label, body) => {
    expect(noGpu(lowered(body).plan)).toBe('it has no loop to dispatch');
  });

  it('runs on the CPU tier when its body is not the shape of a kernel call', () => {
    const plan = refusedByProof(`export function k(xs: array<f32>, out: array<f32>, c: bool) {
  if (c) { for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i]; } }
}`);
    expect(noGpu(plan)).toContain("its body is not the kernel call's shape");
  });
});

describe('a kernel function with a texture parameter the call does not bind', () => {
  it.each([
    ['a texture_2d of u32', 'texture_2d<u32>'],
    ['a texture_3d of f32', 'texture_3d<f32>'],
    ['a cube texture', 'texture_cube<f32>'],
  ])('runs on the CPU tier with %s', (_label, type) => {
    const result = lowered(
      `export function k(xs: array<f32>, out: array<f32>, tex: ${type}) { ${MAP} }`,
    );
    expect(noGpu(result.plan)).toBe(
      'parameter "tex" is a texture a kernel call does not bind: it binds a texture_2d<f32> and a 2D storage texture',
    );
  });

  it.each([
    ['a texture_2d of f32', 'texture_2d<f32>'],
    ['a 2D storage texture', 'texture_storage_2d<"r32float", "write">'],
  ])('lowers with %s', (_label, type) => {
    const result = lowered(
      `export function k(xs: array<f32>, out: array<f32>, tex: ${type}) { ${MAP} }`,
    );
    expect('noGpu' in result.plan).toBe(false);
  });
});

describe('a kernel function with a statement that reads what an earlier loop reduces', () => {
  it('runs on the CPU tier, naming the variable and the loop', () => {
    const result = lowered(`export function k(xs: array<f32>, out: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { s += xs[i]; }
  const t: f32 = s * 2.;
  for (let j: u32 = 0; j < xs.length; j++) { out[j] = t; }
  return s;
}`);
    expect(noGpu(result.plan)).toBe(
      'a statement before loop 2 reads "s", which an earlier loop reduces',
    );
  });

  it('lowers when the statement between the loops does not read it', () => {
    const result = lowered(`export function k(xs: array<f32>, out: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { s += xs[i]; }
  const t: f32 = 2.;
  for (let j: u32 = 0; j < xs.length; j++) { out[j] = t; }
  return s;
}`);
    expect('noGpu' in result.plan).toBe(false);
  });
});

describe('a loop that pushes must run its counting step without writing', () => {
  it.each([
    [
      'scatters',
      `export function k(xs: array<f32>, out: array<f32>, h: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); h[i % 4] += 1; }
}`,
      'loop 1 pushes and scatters into "h", which its counting step would write twice',
    ],
    [
      'stores into a texture',
      `export function k(w: u32, out: array<f32>, dst: texture_storage_2d<"r32float", "write">) {
  for (let i: u32 = 0; i < w * w; i++) { out.push(1.); textureStore(dst, vec2u(i % w, i / w), vec4(1.0)); }
}`,
      'loop 1 pushes and stores into "dst", which its counting step would write twice',
    ],
    [
      'reduces',
      `export function k(xs: array<f32>, out: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); s += xs[i]; }
  return s;
}`,
      'loop 1 pushes and reduces "s", which its counting step would combine twice',
    ],
    [
      'pushes onto two arrays',
      `export function k(xs: array<f32>, out: array<f32>, o2: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); o2.push(xs[i]); }
}`,
      'loop 1 pushes onto "out" and "o2", and the call counts the pushes of one array a loop',
    ],
    [
      'reads back what it writes',
      `export function k(xs: array<f32>, out: array<f32>, o2: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { o2[i] = xs[i]; const v = o2[i] * 2.; o2[i] = v; out.push(v); }
}`,
      'loop 1 pushes and reads back what it writes to "o2", which its counting step does not write',
    ],
  ])('runs on the CPU tier when the loop %s', (_label, body, message) => {
    expect(noGpu(lowered(body).plan)).toBe(message);
  });
});

describe('the length of an array a loop pushes onto', () => {
  const early =
    'it reads the length of an array it pushes onto before its result, which the call knows once the loop has run';

  it.each([
    [
      'before the loop that pushes',
      `export function k(xs: array<f32>, out: array<f32>) {
  const n = out.length;
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
}`,
    ],
    [
      'between two loops, when a later loop pushes',
      `export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  const n = out.length;
  for (let j: u32 = 0; j < xs.length; j++) { out.push(xs[j]); }
}`,
    ],
    [
      'between a loop that does not push and the loop that does',
      `export function k(xs: array<f32>, o2: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { o2[i] = xs[i]; }
  const n = out.length;
  for (let j: u32 = 0; j < xs.length; j++) { out.push(xs[j]); }
}`,
    ],
    [
      'in the header of a loop that pushes later',
      `export function k(xs: array<f32>, o2: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  for (let j: u32 = 0; j < out.length; j++) { o2[j] = xs[j]; }
  for (let q: u32 = 0; q < xs.length; q++) { out.push(xs[q]); }
}`,
    ],
  ])('runs on the CPU tier when a statement reads it %s', (_label, body) => {
    expect(noGpu(lowered(body).plan)).toBe(early);
  });

  it('runs on the CPU tier when the loop that pushes reads it itself', () => {
    const plan = refusedByProof(`export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); const n = out.length; }
}`);
    expect(noGpu(plan)).toBe('a loop of it runs on the CPU (TS8070)');
  });

  it.each([
    [
      'by the result',
      `export function k(xs: array<f32>, out: array<f32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  return out.length;
}`,
    ],
    [
      'by a statement after the last loop',
      `export function k(xs: array<f32>, out: array<f32>, o2: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  o2[0] = f32(out.length);
}`,
    ],
    [
      'by the header of a later loop when no loop pushes after it',
      `export function k(xs: array<f32>, o2: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out.push(xs[i]); }
  for (let j: u32 = 0; j < out.length; j++) { o2[j] = xs[j]; }
}`,
    ],
  ])('lowers when it is read %s', (_label, body) => {
    expect('noGpu' in lowered(body).plan).toBe(false);
  });
});

describe('a loop whose range the device holds', () => {
  it('runs on the CPU tier when it stores into a texture', () => {
    const result =
      lowered(`export function k(c: array<u32>, dst: texture_storage_2d<"r32float", "write">, w: u32) {
  for (let i: u32 = 0; i < c[0]; i++) { textureStore(dst, vec2u(i % w, i / w), vec4(1.0)); }
}`);
    expect(noGpu(result.plan)).toBe(
      'loop 1 stores into the texture "dst" over a trip count it reads from an array, and the call checks a texture\'s rows against a trip count the host knows',
    );
  });
});

describe('a kernel function that takes a Map or a Set', () => {
  it('runs on the CPU tier when it stores into an array after its loops', () => {
    const result = lowered(`export function k(xs: array<u32>, out: array<u32>, seen: Set<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) { seen.add(xs[i]); }
  out[0] = 1;
}`);
    expect(noGpu(result.plan)).toBe(
      'it takes the Set "seen" and stores into an array after its loops',
    );
  });

  it('runs on the CPU tier when a loop reads its trip count from an array', () => {
    const result = lowered(`export function k(xs: array<u32>, out: array<u32>, seen: Set<u32>) {
  for (let i: u32 = 0; i < out[0]; i++) { seen.add(xs[i]); }
}`);
    expect(noGpu(result.plan)).toBe(
      'it takes the Set "seen", and loop 1 reads its trip count from an array',
    );
  });
});

describe('the type of a reduction variable', () => {
  const SUM = `export function k(xs: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) { s += xs[i]; }
  return s;
}`;
  const retyped = (type: ShaderType): Lowered['plan'] => {
    const { module, proof } = lowered(SUM);
    const patched: KernelProof = {
      ...proof,
      loops: proof.loops.map((v) =>
        v.ok ? { ...v, reductions: v.reductions.map((r) => ({ ...r, type })) } : v,
      ),
    };
    return lowerFrom(module, 'k', patched);
  };

  it.each([
    ['a bool', { kind: 'scalar', scalar: 'bool' }, 'it reduces "s", a bool, which no buffer holds'],
    [
      'an f16',
      { kind: 'scalar', scalar: 'f16' },
      'it reduces "s", an f16, which the call does not fold on the GPU',
    ],
  ] as const)('runs on the CPU tier when it is %s', (_label, type, message) => {
    expect(noGpu(retyped(type as ShaderType))).toBe(message);
  });

  it('runs on the CPU tier when it is a matrix', () => {
    const result = lowered(`export function k(xs: array<f32>): mat2x2f {
  let s: mat2x2f = mat2x2f(0., 0., 0., 0.);
  for (let i: u32 = 0; i < xs.length; i++) { s += mat2x2f(xs[i], 0., 0., xs[i]); }
  return s;
}`);
    expect(noGpu(result.plan)).toBe('it reduces "s", a mat, which the GPU does not fold');
  });

  it.each([
    ['an f64', { kind: 'f64' }],
    ['a vector of f64', { kind: 'vec64', n: 2 }],
    ['an i32', { kind: 'scalar', scalar: 'i32' }],
    ['a u32 vector', { kind: 'vec', n: 3, elem: 'u32' }],
  ] as const)('lowers when it is %s', (_label, type) => {
    expect('noGpu' in retyped(type as ShaderType)).toBe(false);
  });
});

describe('the type of a scalar parameter or of an array element the call packs', () => {
  const KERNEL = `export function k(xs: array<f32>, out: array<f32>, p: f32) { ${MAP} }`;
  const withParam = (name: string, type: ShaderType): Lowered['plan'] => {
    const { module, proof } = lowered(KERNEL);
    const f = module.funcs.find((x) => x.name === 'k')!;
    const patched = { ...f, params: f.params.map((q) => (q.name === name ? { ...q, type } : q)) };
    const m = { ...module, funcs: module.funcs.map((x) => (x === f ? patched : x)) };
    return lowerKernel(patched, m, proof);
  };

  it.each([
    ['a bool', { kind: 'scalar', scalar: 'bool' }, 'a bool, which no buffer holds'],
    ['a bool vector', { kind: 'vec', n: 3, elem: 'bool' }, 'a bool vector, which no buffer holds'],
    [
      'a matrix of f64',
      { kind: 'mat', cols: 2, rows: 2, elem: 'f64' },
      'a matrix of f64, which has no host value yet',
    ],
    [
      'an array with no size',
      {
        kind: 'array',
        elem: { kind: 'array', elem: { kind: 'scalar', scalar: 'f32' } },
        size: 4,
      },
      'an array with no size',
    ],
    [
      'a struct the module does not declare',
      { kind: 'struct', name: 'Nope' },
      'struct Nope, which is not declared',
    ],
    ['a sampler', { kind: 'sampler' }, 'a sampler, which the call does not pack yet'],
  ] as const)('refuses %s as a uniform field', (_label, type, why) => {
    expect(noGpu(withParam('p', type as ShaderType))).toBe(`parameter "p" is ${why}`);
  });

  it.each([
    ['an f64', { kind: 'f64' }],
    ['a vector of f64', { kind: 'vec64', n: 2 }],
    ['a sized array', { kind: 'array', elem: { kind: 'scalar', scalar: 'f32' }, size: 4 }],
  ] as const)('accepts %s as a uniform field', (_label, type) => {
    expect('noGpu' in withParam('p', type as ShaderType)).toBe(false);
  });

  it('refuses an array element that no buffer holds, naming the array', () => {
    const plan = withParam('out', {
      kind: 'array',
      elem: { kind: 'scalar', scalar: 'bool' },
    } as ShaderType);
    expect(noGpu(plan)).toBe('parameter "out" holds a bool, which no buffer holds');
  });
});

describe('a name the module already declares', () => {
  const MAP = `export function k(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) { out[i] = xs[i]; }
}`;
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
    expect(noGpu(lowered(`${declaration}\n${body}`).plan)).toBe(
      `the module already declares "${name}", ${role}`,
    );
  });
});
