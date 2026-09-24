// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.23 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.6 (docs/language-design.md; traced in reqs/).
//
// A kernel function (change 0013, part 1): an exported function that takes an array with no
// size. Its array is the caller's storage, read and written in place, its loops are proved
// independent or run on the CPU with `TS8070` naming why, and no target emits it. Read twice, as
// every program an author writes is (CLAUDE.md): each warning in `compile()` and in the language
// service on the same source, with the same text.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { hostFace } from './host-face.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const module = (body: string): string => `"use typeshade";\n${body}\n`;

const compiled = (body: string): string[] =>
  compile(module(body), { fileName: 'm.shade.ts' }).diagnostics.map(
    (d) => `${d.category} ${d.code} ${d.message}`,
  );

const edited = (body: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('m.shade.ts', module(body));
  return service
    .getDiagnostics('m.shade.ts')
    .map((d) => `${d.severity} ${String(d.code)} ${d.message}`);
};

/** Each refusal of the proof as the author reads it: `[name, program, message]`. The lines are
 *  counted from the directive, which is line 1. */
const REFUSED: readonly (readonly [string, string, string])[] = [
  [
    'R1, a while loop',
    `export function fill(a: array<f32>) {
  let i: u32 = 0;
  while (i < a.length) {
    a[i] = 1.;
    i++;
  }
}`,
    'This loop runs on the CPU because it is a while loop, whose trip count is known only when it ends. A for loop over a count runs on the GPU.',
  ],
  [
    'R1, a multiplicative step',
    `export function halve(a: array<f32>) {
  for (let stride: u32 = 64; stride > 0; stride /= 2) {
    a[stride] = 1.;
  }
}`,
    'This loop runs on the CPU because "stride /= 2" does not step through a range of indices. Step by adding a constant.',
  ],
  [
    'R2, a return',
    `export function find(a: array<f32>): u32 {
  for (let i: u32 = 0; i < a.length; i++) {
    if (a[i] > 1.) {
      return i;
    }
  }
  return 0;
}`,
    'This loop runs on the CPU because line 5 returns from inside it, so whether an iteration runs depends on the ones before it. Record the result in an array and read it after the loop.',
  ],
  [
    'R3, a carried variable',
    `export function running(a: array<f32>) {
  let nearest = 1e30;
  for (let i: u32 = 0; i < a.length; i++) {
    nearest = min(nearest, a[i]);
    a[i] = nearest;
  }
}`,
    'This loop runs on the CPU because line 5 writes "nearest", which the next iteration reads. Declare it inside the loop, or combine it with one of += *= min max & | ^.',
  ],
  [
    'R3, a shared element',
    `export function scatter(a: array<f32>, idx: array<u32>, b: array<f32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    b[idx[i]] = a[i];
  }
}`,
    'This loop runs on the CPU because line 4 writes "b[idx[i]]", an element two iterations can share. Write at an index made from "i".',
  ],
  [
    'R4, a read of what another iteration writes',
    `export function prefix(out: array<f32>) {
  for (let i: u32 = 1; i < out.length; i++) {
    out[i] = out[i] + out[i - 1];
  }
}`,
    'This loop runs on the CPU because line 4 reads "out[i - 1]", which another iteration writes. Read from an array the loop does not write.',
  ],
  [
    'R5, a call that writes a module variable',
    `let calls: u32 = 0;
function tally(): u32 {
  calls += 1;
  return calls;
}
export function count(a: array<u32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = tally();
  }
}`,
    'This loop runs on the CPU because line 9 calls "tally", which writes "calls". Return the value from "tally" and combine it in the loop instead.',
  ],
  [
    'R6, a console call',
    `export function noisy(a: array<f32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    console.log(a[i]);
    a[i] = 1.;
  }
}`,
    'This loop runs on the CPU because line 4 calls console.log, whose lines would print in another order on the GPU. Log after the loop.',
  ],
];

describe('a loop that runs on the CPU says why, in the compiler and in the editor (TS8070)', () => {
  it.each(REFUSED)('%s', (_name, body, message) => {
    expect(compiled(body)).toEqual([`warning TS8070 ${message}`]);
    expect(edited(body)).toEqual([`warning TS8070 ${message}`]);
  });

  it('is quiet on a loop the proof accepts, in both halves', () => {
    const body = `export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
export function render(k: vec4, size: u32, out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}
export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}`;
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
  });

  it('runs the whole function on the CPU when its body is not a kernel call', () => {
    const body = `export function f(a: array<f32>) {
  a[0] = 1.;
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = 2.;
  }
}`;
    const want =
      'warning TS8070 This function runs on the CPU because line 3 writes "a" outside its loops. A kernel function\'s body is scalar statements, then its loops, then a return: move that line into a loop, or into the code that calls the function.';
    expect(compiled(body)).toEqual([want]);
    expect(edited(body)).toEqual([want]);
  });
});

describe('a kernel function (Rules 8.22, 8.23, 8.6)', () => {
  const RENDER = `export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
export function render(k: vec4, size: u32, out: array<f32>) {
  for (let i: u32 = 0; i < size * size; i++) {
    const p = vec2(f32(i % size), f32(i / size)) / f32(size);
    out[i] = height(p, k);
  }
}`;

  it('is emitted by no target: it runs on the host side of the call', () => {
    const r = compile(module(RENDER), { fileName: 'm.shade.ts' });
    expect(r.wgsl).toContain('fn height(');
    expect(r.wgsl).not.toContain('render');
    expect(r.module.funcs.find((f) => f.name === 'render')?.kernel).toBe(true);
  });

  it("writes the caller's array in place on the CPU oracle", () => {
    const r = compile(module(RENDER), { fileName: 'm.shade.ts' });
    const cpu = compileModule(r.module, { precision: 'f32' });
    const out = [0, 0, 0, 0];
    cpu.fns.render!([1, 0.5, 2, 0.25] as never, 2 as never, out as never);
    const k = [1, 0.5, 2, 0.25];
    const want = [0, 1, 2, 3].map((i) => {
      const p = [(i % 2) / 2, Math.floor(i / 2) / 2];
      return k[0]! * Math.sin(p[0]! * k[1]!) + k[2]! * Math.cos(p[1]! * k[3]!);
    });
    out.forEach((x, i) => expect(x).toBeCloseTo(want[i]!, 5));
  });

  it('reads the length of its array', () => {
    const r = compile(module('export function n(xs: array<f32>): u32 { return xs.length; }'), {
      fileName: 'm.shade.ts',
    });
    expect(r.diagnostics).toEqual([]);
    expect(compileModule(r.module).fns.n!([1, 2, 3] as never)).toBe(3);
  });

  it('is not called from another function, in the compiler and in the editor', () => {
    const body = `export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (const x of xs) {
    s += x;
  }
  return s;
}
declare const data: storage<array<f32>, "read_write">;
@compute([1])
export function cs() {
  data[0] = total(data);
}`;
    const want =
      'error TS8099 "total" is a kernel function, which host code calls and whose arrays are the call\'s storage, so no function can call it. Move what the two share into a plain function and call that from both.';
    expect(compiled(body)).toEqual([want]);
    expect(edited(body)).toContain(want);
  });

  it('is exported: a function no host can call takes no array with no size (Rule 12.6)', () => {
    const [d] = compiled(
      'function total(xs: array<f32>): f32 { return xs[0]; }\n@compute([1]) export function cs() {}',
    );
    expect(d).toMatch(/^error TS8020 Parameter "xs" is array<f32>, an array with no size/);
  });

  it('is called through the import, asynchronously (the call: host-kernel.test.ts)', () => {
    const f = hostFace(module(RENDER), { fileName: 'm.shade.ts' });
    expect(f.view).toContain(
      'export declare function render(k: readonly [number, number, number, number], size: number, out: Float32Array): Promise<void>;',
    );
    expect(f.view).toContain('export declare function height(');
  });
});
