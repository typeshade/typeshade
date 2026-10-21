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
import { describeRead } from './kernel-loops.js';
import { proveKernels } from '../../core/passes/parallel-loop.js';
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
  // Change 0078: an array a loop pushes onto is written by no other form, and is not read.
  [
    'R3, a push and a write in place to one array',
    `export function keep(xs: array<f32>, out: array<f32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
    out[i] = 0.;
  }
}`,
    'This loop runs on the CPU because line 5 writes "out" in place, and the loop also pushes onto it. Push every element, or write every element in place.',
  ],
  [
    'R4, a read of the length of a pushed array',
    `export function keep(xs: array<f32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (out.length < 4) {
      out.push(i);
    }
  }
}`,
    'This loop runs on the CPU because line 4 reads "out.length", and "out" is an array the loop pushes onto, whose length and elements depend on the iterations before. Read it after the loop.',
  ],
  [
    'R4, a read of an element of a pushed array',
    `export function keep(xs: array<u32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i] + out[0]);
  }
}`,
    'This loop runs on the CPU because line 4 reads "out[0]", and "out" is an array the loop pushes onto, whose length and elements depend on the iterations before. Read it after the loop.',
  ],
  [
    'R4, the value push returns',
    `export function keep(xs: array<u32>, out: array<u32>, at: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    at[i] = out.push(xs[i]);
  }
}`,
    'This loop runs on the CPU because line 4 uses the value push returns, the length before it, which depends on the iterations before. Call push as a statement of its own, and read the length after the loop.',
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

  it('is quiet on a loop that pushes and a length read after it, in both halves (change 0078)', () => {
    const body = `export function strong(xs: array<f32>, t: f32, out: array<u32>): u32 {
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > t) {
      out.push(i);
      out.push(i + 1);
    }
  }
  return out.length;
}`;
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
  });

  it("keeps push refused outside a kernel function's loop, in both halves (surface §63)", () => {
    for (const body of [
      `export function once(out: array<u32>) {
  out.push(1u);
}`,
      `export function local(xs: array<u32>): u32 {
  var ys = array<u32, 4>();
  for (let i: u32 = 0; i < xs.length; i++) {
    ys.push(xs[i]);
  }
  return ys[0];
}`,
    ]) {
      const c = compiled(body);
      expect(c.some((d) => d.startsWith('error '))).toBe(true);
      expect(edited(body).some((d) => d.startsWith('error '))).toBe(true);
    }
  });

  it('refuses a pushed value of another type, in both halves', () => {
    const body = `export function keep(xs: array<f32>, out: array<u32>) {
  for (let i: u32 = 0; i < xs.length; i++) {
    out.push(xs[i]);
  }
}`;
    expect(compiled(body).some((d) => d.startsWith('error '))).toBe(true);
    expect(edited(body).some((d) => d.startsWith('error '))).toBe(true);
  });

  it('runs a loop that reads the length of the array it writes on the GPU, in both halves (#345)', () => {
    // The length is fixed when the host binds the buffer, so reading it is no element read: the
    // proof reads it as `access.ts` says, as the Rule 7.5 bound check already did.
    const body = `export function fill(out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = f32(out.length);
  }
}`;
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
    const face = hostFace(module(body), { fileName: '/app/m.shade.ts' });
    const kernel = face.exports?.find((e) => e.kind === 'kernel');
    expect(kernel?.kind === 'kernel' ? kernel.face.gpu?.loops.length : undefined).toBe(1);
    // An element of the array it writes, read at another index, is still refused.
    expect(
      compiled(`export function smear(a: array<f32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = a[i] + a[i > 0 ? i - 1 : i];
  }
}`),
    ).toEqual([
      'warning TS8070 This loop runs on the CPU because line 4 reads "a[…]", which another iteration writes. Read from an array the loop does not write.',
    ]);
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

describe('a kernel function that writes a storage texture (change 0077)', () => {
  // Verifies: Rule 8.22. A 2D storage texture parameter makes an exported function a kernel
  // function, and a store at vec2u(i % W, i / W) is the one texel form R3 accepts.
  const INVERT = `export function invert(
  src: texture_2d<f32>,
  dst: texture_storage_2d<"rgba8unorm", "write">,
  w: u32,
  h: u32,
) {
  for (let i: u32 = 0; i < w * h; i++) {
    const c = textureLoad(src, vec2u(i % w, i / w), 0);
    textureStore(dst, vec2u(i % w, i / w), vec4(1.0 - c.rgb, c.a));
  }
}`;

  it('accepts the store at vec2u(i % W, i / W), in both halves', () => {
    expect(compiled(INVERT)).toEqual([]);
    expect(edited(INVERT)).toEqual([]);
    const r = compile(module(INVERT), { fileName: 'm.shade.ts' });
    expect(r.module.funcs.find((f) => f.name === 'invert')?.kernel).toBe(true);
    const [p] = proveKernels(r.module);
    const v = p!.loops[0]!;
    expect(v.ok).toBe(true);
    expect(v.ok ? v.writes.map((w) => `${w.kind} ${w.name}`) : []).toEqual(['texel dst']);
  });

  it('leaves an exported helper that takes only a sampled texture a helper (Amendment 1)', () => {
    const body = `declare const img: texture_2d<f32>;
export function tex(t: texture_2d<f32>, uv: vec2i): vec4 {
  return textureLoad(t, uv, 0);
}
class FsOut {
  @location(0) color: vec4;
}
@fragment
export function fs(@builtin("position") p: vec4): FsOut {
  return { color: tex(img, vec2i(p.xy)) };
}`;
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
    const r = compile(module(body), { fileName: 'm.shade.ts' });
    expect(r.module.funcs.find((f) => f.name === 'tex')?.kernel).toBeUndefined();
    expect(r.wgsl).toContain('fn tex(');
  });

  it.each([
    [
      'a store at a shifted texel',
      `export function shifted(dst: texture_storage_2d<"r32float", "write">, w: u32, h: u32) {
  for (let i: u32 = 0; i < w * h; i++) {
    textureStore(dst, vec2u((i + 1) % w, i / w), vec4(1.0));
  }
}`,
      'warning TS8070 This loop runs on the CPU because line 4 stores into "dst" at a texel two iterations can share. Store at vec2u(i % W, i / W), with the same W at every store to the texture.',
    ],
    [
      'two stores of two widths',
      `export function two(dst: texture_storage_2d<"r32float", "write">, w: u32, h: u32) {
  for (let i: u32 = 0; i < w * h; i++) {
    textureStore(dst, vec2u(i % w, i / w), vec4(1.0));
    textureStore(dst, vec2u(i % h, i / h), vec4(0.0));
  }
}`,
      'warning TS8070 This loop runs on the CPU because line 4 stores into "dst" at a texel two iterations can share. Store at vec2u(i % W, i / W), with the same W at every store to the texture.',
    ],
    [
      'a load of a texel another iteration stores',
      `export function smear(t: texture_storage_2d<"r32float", "read_write">, w: u32, h: u32) {
  for (let i: u32 = 1; i < w * h; i++) {
    const p = textureLoad(t, vec2u((i - 1) % w, (i - 1) / w));
    textureStore(t, vec2u(i % w, i / w), p);
  }
}`,
      'warning TS8070 This loop runs on the CPU because line 4 reads "textureLoad(t, vec2u((i - 1) % w, (i - 1) / w))", a texel another iteration stores. Load the texel the iteration stores, or read a texture the loop does not write.',
    ],
  ])('refuses %s, with the same text in both halves', (_name, body, message) => {
    expect(compiled(body)).toEqual([message]);
    expect(edited(body)).toEqual([message]);
  });

  it('accepts a load of the texel the iteration stores, and the size anywhere', () => {
    const body = `export function bump(t: texture_storage_2d<"r32float", "read_write">) {
  const d = textureDimensions(t);
  for (let i: u32 = 0; i < d.x * d.y; i++) {
    const v = textureLoad(t, vec2u(i % d.x, i / d.x));
    textureStore(t, vec2u(i % d.x, i / d.x), v + vec4(f32(textureDimensions(t).x)));
  }
}`;
    expect(compiled(body)).toEqual([]);
    expect(edited(body)).toEqual([]);
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

  it('counts the vectors of an array<vec4f>: .length is u32 and one iteration takes one vector (change 0068)', () => {
    const body = `export function copy4(out: array<vec4f>, a: array<vec4f>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i];
  }
}`;
    const r = compile(module(body), { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    const cpu = compileModule(r.module, { precision: 'f32' });
    const a = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = new Float32Array(8);
    cpu.fns.copy4!(out as never, a as never);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Editor half: the same source is clean, and the length is a u32 there too.
    const service = createTypeshadeLanguageService();
    const uri = 'm.shade.ts';
    const source = module(body);
    service.openDocument(uri, source);
    expect(service.getDiagnostics(uri)).toEqual([]);
    const at = source.indexOf('out.length');
    const hover = service.getHover(uri, service.positionAt(uri, at + 4))?.contents ?? '';
    expect(hover).toContain('u32');
  });

  it('copies an array<vec4f> to the bits of the array<f32> copy of the same numbers (change 0068 validation)', () => {
    const vec = compile(
      module(`export function copy4(out: array<vec4f>, a: array<vec4f>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i];
  }
}`),
      { fileName: 'm.shade.ts' },
    );
    const flat = compile(
      module(`export function copy1(out: array<f32>, a: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i];
  }
}`),
      { fileName: 'm.shade.ts' },
    );
    expect(vec.diagnostics).toEqual([]);
    expect(flat.diagnostics).toEqual([]);
    const cpuVec = compileModule(vec.module, { precision: 'f32' });
    const cpuFlat = compileModule(flat.module, { precision: 'f32' });
    // Signed zeros, subnormals, a large and a small magnitude: the copy moves the bits, not the values.
    const src = new Float32Array([-0, 0, 1e-40, -3.4e38, 1.5, -2.25, 1e-30, 123456.75]);
    const outVec = new Float32Array(8);
    const outFlat = new Float32Array(8);
    cpuVec.fns.copy4!(outVec as never, src as never);
    cpuFlat.fns.copy1!(outFlat as never, src as never);
    expect(new Uint32Array(outVec.buffer)).toEqual(new Uint32Array(outFlat.buffer));
    expect(new Uint32Array(outVec.buffer)).toEqual(new Uint32Array(src.buffer));
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
      'export declare function render(k: readonly [number, number, number, number], size: number, out: Float32Array | Resident<Float32Array>): Promise<void>;',
    );
    expect(f.view).toContain('export declare function height(');
  });
});

describe('a row-major write needs one width for the whole loop (#398)', () => {
  const gpuLoops = (body: string): number | undefined => {
    const face = hostFace(module(body), { fileName: '/app/m.shade.ts' });
    const kernel = face.exports?.find((e) => e.kind === 'kernel');
    return kernel?.kind === 'kernel' ? kernel.face.gpu?.loops.length : undefined;
  };
  const grid = (width: string, before = '', inner = ''): string =>
    `export function f(w: u32, h: u32, out: array<f32>) {${before}
  for (let y: u32 = 0; y < h; y++) {${inner}
    for (let x: u32 = 0; x < ${width.split('|')[0]!}; x++) {
      out[${width.split('|')[1]!}] = f32(y);
    }
  }
}`;

  it('runs a width that changes from row to row on the CPU, in both halves', () => {
    // Rows of different widths overlap: `y * (h - y) + x` over `x < h - y` writes out[3] from
    // rows 0 and 1 when h is 4, and the two invocations would race on the GPU. `W2` was made
    // when `s` was 1 and the bound reads `s` at 2, so each row is two widths long.
    const cases: [string, string, number][] = [
      [grid('h - y|y * (h - y) + x'), 'y * (h - y) + x', 5],
      [grid('W|y * W + x', '', '\n    const W = h - y;'), 'y * W + x', 6],
      [
        grid('s * w|y * W2 + x', '\n  let s: u32 = 1;\n  const W2 = s * w;\n  s = 2;'),
        'y * W2 + x',
        8,
      ],
    ];
    for (const [body, index, line] of cases) {
      const want = `warning TS8070 This loop runs on the CPU because line ${String(line)} writes "out[${index}]", an element two iterations can share. Write at an index made from "y".`;
      expect(compiled(body), index).toEqual([want]);
      expect(edited(body), index).toEqual([want]);
      expect(gpuLoops(body), index).toBeUndefined();
    }
  });

  it('runs one width on the GPU, written inline, through a const or through a let it never sets again', () => {
    for (const body of [
      grid('w|y * w + x'),
      grid('w|at', '', '').replace('out[at]', 'const at = y * w + x;\n      out[at]'),
      grid('w|row + x', '', '\n    const row = y * w;'),
      grid('W|y * W + x', '\n  const W = w;'),
      grid('s|y * s + x', '\n  let s: u32 = w;'),
    ]) {
      expect(compiled(body), body).toEqual([]);
      expect(edited(body), body).toEqual([]);
      expect(gpuLoops(body), body).toBe(1);
    }
  });
});

describe("the first access that is not at the loop counter, in the author's words (change 0058)", () => {
  // The planner of `typeshade/fuse` says why two calls run as two dispatches from text the
  // compiler wrote at build time: "blur reads `t[i - 1]`", the form TS8070 names a read in.

  /** `describeRead` over the array named `array`, in the loop `loop` of kernel function `fn`. */
  const worded = (body: string, fn: string, array: string, loop = 0) => {
    const r = compile(module(body), { fileName: 'm.shade.ts' });
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const f = r.module.funcs.find((x) => x.name === fn)!;
    const v = proveKernels(r.module).find((p) => p.fn === fn)!.loops[loop]!;
    if (!v.ok) throw new Error('refused');
    const fact = [...v.reads, ...v.stores].find((x) => x.name === array)!;
    return describeRead(f, fact);
  };

  it("prints the element with the author's names, and the one-based line of its statement", () => {
    const body = `export function blur(out: array<f32>, t: array<f32>) {
  for (let i: u32 = 1; i < out.length - 1; i++) {
    out[i] = t[i] + t[i - 1];
  }
}`;
    expect(worded(body, 'blur', 't')).toEqual({ text: 't[i - 1]', line: 4 });
    // The directive is line 1, so this is the line an editor shows.
    expect(module(body).split('\n')[3]).toContain('t[i - 1]');
  });

  it('prints a counter the lowering renamed as the author wrote it', () => {
    // The second `i` of a function is `i_1` in the IR.
    const body = `export function two(out: array<f32>, t: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i];
  }
  for (let i: u32 = 1; i < out.length - 1; i++) {
    out[i] = t[i + 1] * 2.;
  }
}`;
    expect(worded(body, 'two', 't', 0)).toBeUndefined();
    expect(worded(body, 'two', 't', 1)).toEqual({ text: 't[i + 1]', line: 7 });
  });

  it.each([
    [
      'a field of the element',
      'class P { pos: vec4; }\nexport function f(out: array<P>, ps: array<P>) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i].pos = ps[i + 1].pos;\n  }\n}',
      'f',
      'ps',
      'ps[i + 1].pos',
    ],
    [
      'a stride',
      'export function f(out: array<f32>, x: array<f32>) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = x[2 * i];\n  }\n}',
      'f',
      'x',
      'x[2 * i]',
    ],
    [
      'a gather',
      'export function f(out: array<f32>, table: array<f32>, ix: array<u32>) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = table[ix[i]];\n  }\n}',
      'f',
      'table',
      'table[ix[i]]',
    ],
    [
      'a loop-invariant index',
      'export function f(out: array<f32>, x: array<f32>, n: u32) {\n  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = x[n];\n  }\n}',
      'f',
      'x',
      'x[n]',
    ],
    [
      'a write',
      'export function f(out: array<f32>, x: array<f32>) {\n  for (let i: u32 = 0; i < x.length; i++) {\n    out[i * 2 + 1] = x[i];\n  }\n}',
      'f',
      'out',
      'out[i * 2 + 1]',
    ],
  ])('prints %s', (_name, body, fn, array, text) => {
    expect(worded(body, fn, array)?.text).toBe(text);
  });

  it('prints a length as the author wrote it, `xs.length`, and not as the IR spells it', () => {
    const body = `export function reverse(out: array<f32>, t: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[t.length - 1 - i];
  }
}`;
    expect(worded(body, 'reverse', 't')?.text).toBe('t[t.length - 1 - i]');
  });

  it('says nothing about an array every access of which is at the counter', () => {
    expect(
      worded(
        `export function add(out: array<f32>, a: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i];
  }
}`,
        'add',
        'a',
      ),
    ).toBeUndefined();
  });

  it('is data: it survives JSON, which is how the generated module carries it', () => {
    const w = worded(
      `export function f(out: array<f32>, x: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = x[i + 1];
  }
}`,
      'f',
      'x',
    );
    expect(JSON.parse(JSON.stringify(w))).toEqual(w);
  });

  it('prints a read as TS8070 prints the same read of a loop it refuses', () => {
    // `a[i - 1]` in a loop that writes `a` is refused (R4), and the warning names it; the same
    // read of an array the loop does not write is accepted, and `describeRead` names it alike.
    const refused = compiled(`export function blend(a: array<f32>) {
  for (let i: u32 = 1; i < a.length; i++) {
    a[i] = a[i] + a[i - 1];
  }
}`);
    expect(refused[0]).toContain('reads "a[i - 1]"');
    expect(
      worded(
        `export function blend(out: array<f32>, a: array<f32>) {
  for (let i: u32 = 1; i < a.length; i++) {
    out[i] = a[i] + a[i - 1];
  }
}`,
        'blend',
        'a',
      )?.text,
    ).toBe('a[i - 1]');
  });
});
