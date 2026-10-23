// Change 0086: fixed-array bindings use the existing indexed reads on every backend.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compile } from './compile.js';
import { compileTsSource } from './source-file.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { typeKey } from '../../core/ir/types.js';

const source = (body: string, head = '') => `"use typeshade";
${head}
export function run(): f32 { ${body} }
@fragment
export function fs(): vec4 { return vec4(run()); }
`;
const errors = (body: string, head = '') =>
  compileTsSource(source(body, head)).diagnostics.filter((d) => d.category === 'error');
function agree(body: string, expected: number, head = '') {
  const r = compile(source(body, head));
  expect(r.diagnostics).toEqual([]);
  for (const make of [compileModule, compileModuleJs]) {
    expect(make(r.module).fns.run!(), make.name).toBe(expected);
  }
  return r;
}

describe('fixed-array binding declarations', () => {
  it('runs the complete packed-journey shader on both CPU paths against JavaScript', () => {
    const src = readFileSync(
      new URL('../../../journeys/array-bindings/bindings.shade.ts', import.meta.url),
      'utf8',
    );
    const r = compile(src);
    expect(r.diagnostics).toEqual([]);
    const expected = Array.from({ length: 64 }, (_, x) => [
      x,
      x + 2,
      x + 10,
      x + 2,
      x,
      2 * x + 1,
      x + 2,
      3,
    ]).flat();
    for (const make of [compileModule, compileModuleJs]) {
      const cpu = make(r.module);
      const output = new Array<number>(64 * 8).fill(0);
      cpu.setBinding('out', output);
      cpu.dispatch('main', [1, 1, 1]);
      expect(output, make.name).toEqual(expected);
    }
  });

  it('binds const/let, holes, a shorter pattern and a homogeneous tuple annotation', () => {
    const r = agree(
      `
      const xs = array(2., 3., 5.);
      const [first, , last] = xs;
      let [copy] = xs;
      copy += 7.;
      const [a, b]: [u32, u32] = [11, 13];
      return first + last + copy + f32(a + b);
    `,
      40,
    );
    expect(r.wgsl).toContain('let first = xs[0u];');
    expect(r.wgsl).toContain('let last = xs[2u];');
    expect(r.glsl?.fragment).toContain('xs[2u]');
  });

  it('infers bare literals only in the binding source; integer literals still default to f32', () => {
    agree('const [a, b] = ([1, 2]); return a + b;', 3);
    expect(errors('const [a] = [1]; const b: u32 = a; return f32(b);')[0]?.message).toContain(
      'no implicit',
    );
    expect(errors('const xs = [1., 2.]; return 0.;')[0]?.message).toContain('annotation');
    expect(errors('const [a, b] = [1., u32(2)]; return a;')[0]?.message).toContain(
      'one element type',
    );
    expect(errors('const [a]: array<f32, 1> = array<u32, 1>(1); return a;')[0]?.message).toContain(
      'Types must match',
    );
    expect(errors('const [a]: [u32] = [-1]; return f32(a);')).not.toEqual([]);
  });

  it('nests object and array patterns, copies struct values, and captures the bound names', () => {
    agree(
      `
      const xs = array<P, 2>(new P(2.), new P(5.));
      let [{ x: a }, item] = xs;
      item.x = 10.;
      const { xs: [, { x: b }] } = new Box(xs);
      function captured(): f32 { return a + b; }
      { const [a] = [100.]; if (a < 0.) { return a; } }
      return captured() + item.x + xs[1].x;
    `,
      22,
      `class P { constructor(public x: f32) {} }
class Box { constructor(public xs: array<P, 2>) {} }`,
    );
  });

  it('evaluates a source call once, including when the pattern binds no names', () => {
    agree(
      `
      const [a, b] = make();
      const [] = make();
      return a + b + Counter.hits;
    `,
      5,
      `class Counter { static hits = 0.; }
function make(): array<f32, 2> { Counter.hits += 1.; return array(1., 2.); }`,
    );
  });

  it('evaluates nested getters once and in binding order, even with an empty pattern', () => {
    agree(
      `
      const [{ pair: [a, b] }, { pair: [] }, { pair: [c] }] = array(new P(), new P(), new P());
      return a + b + c + Counter.hits * 100.;
    `,
      305,
      `class Counter { static hits = 0.; }
class P {
  get pair(): array<f32, 2> { Counter.hits += 1.; return array(Counter.hits, Counter.hits); }
}`,
    );
  });

  it('reads readonly bindings into independently writable local copies', () => {
    const r = compile(`"use typeshade";
class P { x: f32; }
declare const xs: storage<array<P, 2>>;
@fragment
export function fs(): vec4 { let [{ x: copy }] = xs; copy = 9.; return vec4(copy, xs[0].x, 0., 1.); }
`);
    expect(r.diagnostics).toEqual([]);
    for (const make of [compileModule, compileModuleJs]) {
      const cpu = make(r.module);
      cpu.setBinding('xs', [{ x: 2 }, { x: 3 }] as never);
      expect(cpu.fns.fs!()).toEqual([9, 2, 0, 1]);
    }
  });

  it('copies a readonly uniform struct element and preserves reserved-name and shadow bindings', () => {
    const r = compile(`"use typeshade";
class P { x: f32; }
class Frame { points: array<P, 2>; }
declare const u: uniform<Frame>;
@fragment
export function fs(): vec4 {
  let [copy] = u.points;
  copy.x = 9.;
  const [_d, texture] = array(1., 2.);
  { const [texture] = [3.]; copy.x += texture; }
  return vec4(copy.x, u.points[0].x, _d, texture);
}`);
    expect(r.diagnostics).toEqual([]);
    for (const make of [compileModule, compileModuleJs]) {
      const cpu = make(r.module);
      cpu.setBinding('u', { points: [{ x: 2 }, { x: 3 }] } as never);
      expect(cpu.fns.fs!()).toEqual([12, 2, 1, 2]);
    }
  });

  it('checks definite initialization of the source before defining the element names', () => {
    expect(errors('let xs: array<f32, 1>; const [a] = xs; return a;')[0]?.message).toContain(
      'before',
    );
    agree('let xs: array<f32, 1>; xs = array(4.); let [a] = xs; a += 1.; return a;', 5);
  });

  it('records each identifier span, exact element type, and declaration mutability', () => {
    const src = source(
      'const [, first]: [u32, u32] = [1, 2]; let [second] = [3.]; return f32(first) + second;',
    );
    const r = compileTsSource(src);
    expect(r.diagnostics).toEqual([]);
    for (const [name, type, mutable] of [
      ['first', 'u32', false],
      ['second', 'f32', true],
    ] as const) {
      const symbol = r.symbols.find((s) => s.name === name)!;
      expect(src.slice(symbol.start, symbol.start + symbol.length)).toBe(name);
      expect(typeKey(symbol.type)).toBe(type);
      expect(symbol.mutable).toBe(mutable);
    }
  });
});

describe('array bindings preserve the existing limits', () => {
  it('rejects a specialization-sized array even when it has a default extent', () => {
    const r = compileTsSource(`"use typeshade";
const N: override<u32> = 2;
let tile: workgroup<array<f32, N>>;
@compute([1])
export function main() { const [a] = tile; tile[0] = a; }`);
    expect(r.diagnostics.filter((d) => d.category === 'error').map((d) => d.message)).toEqual([
      'An array pattern needs a fixed-length array. Read a vector by component, e.g. const x = v.x.',
    ]);
  });

  it.each([
    ['const [a, b] = array(1.); return a + b;', '', 'positions'],
    ['const [,,a] = array(1., 2.); return a;', '', 'positions'],
    ['const [a = 1.] = array(2.); return a;', '', 'default'],
    ['const [...a] = array(2.); return 0.;', '', 'rest'],
    ['const [a] = vec3(1.); return a;', '', 'fixed-length'],
    ['const [a] = xs; return a;', 'declare const xs: storage<array<f32>>;', 'fixed-length'],
    ['const [a] = []; return a;', '', 'no elements'],
    ['const [a] = [,,]; return a;', '', 'hole'],
    [
      'const [a] = xs; return 0.;',
      'declare const xs: storage<array<atomic<u32>, 2>, \"read_write\">;',
      'atomic',
    ],
    ['const [a, a] = array(1., 2.); return a;', '', 'Duplicate'],
    ['const [a] = array(1.); a = 2.; return a;', '', 'const'],
    ['const [{ x }] = array(new P()); return x;', 'class P { private x: f32 = 2.; }', 'private'],
  ])('rejects %s without unknown-name cascades', (body, head, message) => {
    const ds = errors(body, head);
    expect(ds.length).toBeGreaterThan(0);
    expect(ds[0]!.message.toLowerCase()).toContain(message.toLowerCase());
    expect(ds.some((d) => d.message.includes('Unknown identifier'))).toBe(false);
  });
});
