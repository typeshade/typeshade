import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../../core/testing/both-halves.js';

const program = (body: string): string => `"use typeshade"\n${body}\n`;
const FS = '@fragment export function fs(): vec4 { return vec4(0.) }';

type Row = readonly [name: string, body: string, code: string, sentences: string | string[]];

const REFUSALS: readonly Row[] = [
  [
    'an f64 matrix as a vertex attribute',
    '@vertex export function vs(m: location<0, mat2<f64>>): vec4 { return vec4(0.) }',
    'TS8038',
    'Parameter "m" carries mat2x2<f64>: a vertex attribute is one slot per @location, and only a scalar f64 fits one — this shape needs more. Narrow it with f32(x), or compute the double in the stage that needs it — a uniform or storage binding carries an f64 and every stage can read one.',
  ],
  [
    'a parameter marked @location in a function that is not an entry',
    'function f(@location(0) uv: vec2): f32 { return uv.x }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8028',
    '"@location" does not apply to a parameter of a function that is not an entry: it marks an entry\'s input or output. Remove it.',
  ],
  [
    'a parameter marked @builtin in a function that is not an entry',
    'function f(@builtin("position") p: vec4): f32 { return p.x }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8028',
    '"@builtin" does not apply to a parameter of a function that is not an entry: it marks an entry\'s input or output. Remove it.',
  ],
  [
    'an optional parameter of an entry',
    '@fragment export function fs(x?: f32): vec4 { return vec4(0.) }',
    'TS8020',
    'An entry\'s parameters come from the pipeline, not from a call, so "x" cannot be optional. Write "x: T".',
  ],
  [
    'an optional parameter with a default',
    'function f(x?: f32 = 1.): f32 { return 1. }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8020',
    '"x?: T = d" gives "x" two fillers: a parameter is optional, or has a default, not both (TypeScript\'s TS1015). Write "x?: T" or "x: T = d".',
  ],
  [
    'a required parameter after an optional one',
    'function f(a?: f32, b: f32): f32 { return b }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8020',
    '"b" is required and follows the optional parameter "a": a required parameter cannot follow an optional one (TypeScript\'s TS1016). Write "b?: T", or move it before "a".',
  ],
  [
    'a rest parameter',
    'function f(...a: f32[]): f32 { return 1. }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8020',
    'Rest parameter "a" is not supported.',
  ],
  [
    'a default on a parameter of an entry',
    '@fragment export function fs(x: f32 = 1.): vec4 { return vec4(0.) }',
    'TS8020',
    'An entry\'s parameters come from the pipeline, not from a call, so "x" cannot have a default.',
  ],
  [
    'a default that reads an earlier parameter',
    'function f(a: f32, b: f32 = a): f32 { return b }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8020',
    'A default cannot read the parameter "a": the default is filled in where the function is called, and "a" is an expression there, which would then run a second time. Give "b" a default that stands on its own and compute from "a" in the body.',
  ],
  [
    'a default that reads this',
    'class C { v = 1.; m(a: f32 = this.v): f32 { return a } }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8020',
    'A default cannot read "this": the default is filled in where the function is called, and "this" is an expression there, which would then run a second time. Give "a" a default that stands on its own and compute from "this" in the body.',
  ],
  [
    'a method parameter named self_',
    'class C { v = 1.; m(self_: f32): f32 { return self_ } }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8035',
    '"self_" is a name C.m gives its object in the emitted function; rename the parameter.',
  ],
  [
    'a setter that takes a function',
    'class C { v = 1.; set g(f: (x: f32) => f32) { this.v = 1. } }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8020',
    '"f" takes a function, and "C.g" is a setter, whose value an assignment gives it: a shader has no function value to assign. Take the function in a method instead (Rule 8.18).',
  ],
  [
    'a parameter that is a union',
    'function f(x: f32 | vec3): f32 { return 1. }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8002',
    'A union is more than one type and a GPU value has exactly one, so "f32 | vec3" would have to be f32 in one place and vec3 in another. Write one function per type.',
  ],
  [
    'a written @inout',
    'function f(@inout p: f32): f32 { return p }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8073',
    '"@inout" was removed (change 0142): a number, a bool, a vector and a matrix are values. Return the value, and write [a, b] = f(a, b) for more than one.',
  ],
  [
    'an optional struct field in an entry parameter',
    'interface S { a: f32 | undefined }\n@fragment export function fs(s: S): vec4 { return vec4(0.) }',
    'TS8002',
    '"S" holds "a: f32 | undefined", a value and a flag saying whether it is there, which a local, a parameter, a function\'s result, a struct field or an array element may hold; an entry point\'s parameter may not. Carry a u32 flag beside the value, "f32".',
  ],
  [
    'an optional value as an entry parameter',
    '@fragment export function fs(v: f32 | undefined): vec4 { return vec4(0.) }',
    'TS8002',
    '"f32 | undefined" holds a value and a flag saying whether it is there, which a local, a parameter, a function\'s result, a struct field or an array element may hold; an entry point\'s parameter may not. Carry a u32 flag beside the value, "f32".',
  ],
  [
    'an optional value as an entry result',
    '@fragment export function fs(): f32 | undefined { return 1. }',
    'TS8002',
    '"f32 | undefined" holds a value and a flag saying whether it is there, which a local, a parameter, a function\'s result, a struct field or an array element may hold; an entry point\'s result may not. Carry a u32 flag beside the value, "f32".',
  ],
  [
    'an optional parameter of a kernel function',
    'export function k(out: array<f32>, v?: f32) { out[0] = 1. }',
    'TS8020',
    'A kernel function\'s parameters come from the host, not from a call, so "v" cannot be optional. Write "v: T".',
  ],
  [
    'an optional array element in a kernel function parameter',
    'export function k(out: array<f32 | undefined>) { out[0] = 1. }',
    'TS8002',
    '"array<f32 | undefined>" holds "[i]: f32 | undefined", a value and a flag saying whether it is there, which a local, a parameter, a function\'s result, a struct field or an array element may hold; a kernel function\'s parameter may not. Carry a u32 flag beside the value, "f32".',
  ],
  [
    'an optional parameter of a function with a 2D storage texture',
    'export function h(t: texture_storage_2d<"rgba8unorm", "write">, v?: f32): f32 { return 1. }',
    'TS8020',
    'A kernel function\'s parameters come from the host, not from a call, so "v" cannot be optional. Write "v: T".',
  ],
  [
    'a Map parameter of a function that is not a kernel function',
    'function k(m: Map<u32, f32>): f32 { return 1. }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8002',
    "A Map<K, V> is a kernel function's parameter only: an exported function that takes an array with no size (Rule 8.22). Take it as a parameter of that function.",
  ],
  [
    'an array with no size in a function that is not exported',
    'function k(o: array<f32>): f32 { return o[0] }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8020',
    'Parameter "o" is array<f32>, an array with no size. A parameter that holds an array with no size is not supported yet. Give it a size, array<f32, N>, or read the binding by its name inside the function instead.',
  ],
  [
    'a struct with an array with no size as a parameter',
    'interface S { a: array<f32> }\nexport function k(s: S) { }',
    'TS8020',
    'Parameter "s" is S, whose field "a" is array<f32>, an array with no size. A parameter that holds an array with no size is not supported yet. Give it a size, array<f32, N>, or read the binding by its name inside the function instead.',
  ],
  [
    'a compute parameter that is no built-in value',
    '@compute([64]) export function c(x: u32) { }',
    'TS8029',
    '"x" is a user-defined input of a compute entry, which has no user IO: a compute shader reads its work from resources and the builtin<…> invocation ids.',
  ],
  [
    'a compute parameter at a location',
    '@compute([64]) export function c(x: location<0, f32>) { }',
    'TS8029',
    '"x" is at a location<…> on a compute entry, which has no user IO: a compute shader reads its work from resources and the builtin<…> invocation ids.',
  ],
  [
    'a compute struct parameter with a user-defined field',
    'interface S { a: f32 }\n@compute([64]) export function c(s: S) { }',
    'TS8029',
    'Struct "S" field "a" is a user-defined input and "S" is a compute entry input, which has no user IO: a compute shader reads its work from resources and the builtin<…> invocation ids.',
  ],
  [
    'a compute struct parameter with a field at a location',
    'interface S { a: location<0, f32> }\n@compute([64]) export function c(s: S) { }',
    'TS8029',
    'Struct "S" field "a" is at a location<…> and "S" is a compute entry input, which has no user IO: a compute shader reads its work from resources and the builtin<…> invocation ids.',
  ],
  [
    'two parameters at one location',
    '@fragment export function fs(a: location<0, f32>, b: location<0, f32>): vec4 { return vec4(a, b, 0., 1.) }',
    'TS8010',
    '"fs" puts "a" and "b" both at location<0, …>; each slot carries one value.',
  ],
  [
    'an unknown built-in name',
    '@fragment export function fs(a: builtin<"nope">): vec4 { return vec4(0.) }',
    'TS8024',
    'Unknown builtin "nope". Supported names: vertex_index, instance_index, position, front_facing, frag_depth, sample_index, sample_mask, primitive_index, local_invocation_id, local_invocation_index, global_invocation_id, workgroup_id, num_workgroups, subgroup_invocation_id, subgroup_size, subgroup_id, num_subgroups, clip_distances.',
  ],
  [
    'an unknown attribute on a parameter',
    '@fragment export function fs(@nope a: f32): vec4 { return vec4(0.) }',
    'TS8028',
    'Unknown attribute "@nope". Supported attributes: @vertex, @fragment, @compute, @builtin, @location, @interpolate, @invariant, @blend_src.',
  ],
  [
    'an f64 at a location of a fragment entry',
    '@fragment export function fs(x: location<0, f64>): vec4 { return vec4(0.) }',
    'TS8038',
    'Parameter "x" carries f64: an emulated double is a pair of f32 words, and a @location varying interpolates each word on its own, which is not the interpolation of the double. Narrow it with f32(x), or compute the double in the stage that needs it — a uniform or storage binding carries an f64 and every stage can read one.',
  ],
  [
    'a vec64 vertex attribute',
    '@vertex export function vs(x: location<0, vec2d>): vec4 { return vec4(0.) }',
    'TS8038',
    'Parameter "x" carries vec2f64: a vertex attribute is one slot per @location, and only a scalar f64 fits one — this shape needs more. Narrow it with f32(x), or compute the double in the stage that needs it — a uniform or storage binding carries an f64 and every stage can read one.',
  ],
  [
    'an array of f64 as a vertex attribute',
    '@vertex export function vs(m: location<0, array<f64, 2>>): vec4 { return vec4(0.) }',
    'TS8038',
    'Parameter "m" carries array<f64, 2>: a vertex attribute is one slot per @location, and only a scalar f64 fits one — this shape needs more. Narrow it with f32(x), or compute the double in the stage that needs it — a uniform or storage binding carries an f64 and every stage can read one.',
  ],
  [
    'an f64 entry result',
    '@fragment export function fs(): f64 { return 1.0 }',
    'TS8038',
    'The return of entry "fs" carries f64: an emulated double is a pair of f32 words, and a @location varying interpolates each word on its own, which is not the interpolation of the double. Narrow it with f32(x), or compute the double in the stage that needs it — a uniform or storage binding carries an f64 and every stage can read one.',
  ],
  [
    'an f64 field of an entry IO struct',
    'interface S { pos: builtin<"position">; x: location<0, f64> }\n@vertex export function vs(): S { return { pos: vec4(0.), x: 1.0 } }',
    'TS8038',
    'Struct "S" field "x", a vertex output, carries f64: the fp64 pass carries no emulated double in an entry IO struct, whichever direction it faces — a scalar one rides a bare @location parameter, if that is what you meant. Narrow it with f32(x), or compute the double in the stage that needs it — a uniform or storage binding carries an f64 and every stage can read one.',
  ],
  [
    'a return type that names no type',
    'function f(): Foo { return 1. }\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8002',
    'Unknown type "Foo". Declare it in this file, or import it from another shader module.',
  ],
  [
    'a default export entry',
    '@fragment export default function (): vec4 { return vec4(0.) }',
    'TS8028',
    'an entry takes its declaration\'s name; write "export function k"',
  ],
  [
    'a default export function that is not an entry',
    'export default function (): vec4 { return vec4(0.) }',
    'TS8020',
    'Function declaration must have a name.',
  ],
  [
    'a declaration with no body',
    'declare function f(): f32;\n@fragment export function fs(): vec4 { return vec4(0.) }',
    'TS8020',
    'Function "f" needs a body (no ambient declarations).',
  ],
  [
    'a generic function that writes through a parameter',
    'interface Cell { v: f32 }\nfunction bump<T extends Cell>(c: T) { c.v = c.v + 1. }\n@fragment export function fs(): vec4 { let c: Cell = { v: 1. }; bump(c); return vec4(c.v) }',
    'TS8018',
    'Cannot write through parameter "c": this kind of function does not take the caller\'s object yet (change 0142, stage 2). A function of the file or of a namespace does: move the write there, or return the new value.',
  ],
];

describe('the parameters and the return type of a signature', () => {
  it.each(REFUSALS)('both halves refuse %s with one sentence', (_name, body, code, sentences) => {
    bothRefuse(program(body), code, sentences);
  });

  it('says a missing annotation once, in the compiler sentence', () => {
    const halves = bothHalves(program(`function f(x): f32 { return 1. }\n${FS}`));
    const sentence = 'Parameter "x" requires a TypeShade type annotation.';
    expect(halves.compiler).toEqual([`typeshade TS8002: ${sentence}`]);
    expect(halves.editor).toContain(`typeshade TS8002: ${sentence}`);
  });

  it('reads the interpolate option next to a location written wrong', () => {
    const halves = bothHalves(
      program(
        `@fragment export function fs(@location(1.5) @interpolate("bogus") v: f32): vec4 { return vec4(v) }`,
      ),
    );
    const sentences = [
      '@location takes one non-negative integer literal: @location(0).',
      'interpolate type "bogus" is not one WGSL has: perspective, linear, flat.',
    ];
    expect(halves.compiler).toEqual(sentences.map((s) => `typeshade TS8028: ${s}`));
    expect(halves.editor).toEqual(halves.compiler);
  });

  it('refuses an interpolate option on a parameter with no location', () => {
    const halves = bothHalves(
      program(
        `@fragment export function fs(@interpolate("flat") v: f32): vec4 { return vec4(0.) }`,
      ),
    );
    const sentence =
      'typeshade TS8028: The interpolate option belongs on a location<…> parameter: it says how a VARYING is interpolated, and a builtin<…> carries its own rule.';
    expect(halves.compiler).toContain(sentence);
    expect(halves.editor).toContain(sentence);
  });

  it('keeps the interpolate option of a location parameter on the parameter and in WGSL', () => {
    const halves = bothTake(
      program(
        `@fragment export function fs(v: location<0, f32, { interpolate: ["perspective", "centroid"] }>): vec4 { return vec4(v) }`,
      ),
    );
    const param = halves.result.module.funcs[0]!.params[0]!;
    expect(param.location).toBe(0);
    expect(param.interpolate).toBe('perspective, centroid');
    expect(param.attr).toBe('@location(0) @interpolate(perspective, centroid)');
    expect(halves.result.wgsl).toContain('@location(0) @interpolate(perspective, centroid) v: f32');
  });

  it('does not read a field name of a default as a read of a parameter', () => {
    bothTake(
      program(
        `const D = vec2(1., 2.)\nfunction f(x: f32, y: f32 = D.x): f32 { return x + y }\n@fragment export function fs(): vec4 { return vec4(f(1.)) }`,
      ),
    );
    bothTake(
      program(
        `interface P { k: f32 }\nfunction f(k: f32, p: P = { k: 1. }): f32 { return k + p.k }\n@fragment export function fs(): vec4 { return vec4(f(1.)) }`,
      ),
    );
  });

  it('takes an optional parameter of a helper that reads a sampled texture', () => {
    const halves = bothTake(
      program(`export function h(t: texture_2d<f32>, v?: f32): f32 { return 1. }\n${FS}`),
    );
    expect(halves.result.module.funcs[0]!.kernel).toBeUndefined();
  });

  it('takes an f64 as a vertex attribute and a compute struct of built-in values', () => {
    bothTake(program('@vertex export function vs(x: location<0, f64>): vec4 { return vec4(0.) }'));
    bothTake(
      program(
        'interface In { id: builtin<"global_invocation_id"> }\n@compute([64]) export function c(i: In) { }',
      ),
    );
  });

  it('passes the caller storage and a written object by reference, and a read object by value', () => {
    const kernel = bothTake(
      program(
        'export function k(o: array<f32>) { for (let i: u32 = 0; i < o.length; i++) { o[i] = 1. } }',
      ),
    ).result.module.funcs[0]!;
    expect(kernel.kernel).toBe(true);
    expect(kernel.params[0]!.mode).toBe('inout');
    const objects = bothTake(
      program(
        `interface Cell { v: f32 }\nfunction bump(c: Cell) { c.v = c.v + 1. }\nfunction get(c: Cell): f32 { return c.v }\n${FS}`,
      ),
    ).result.module.funcs;
    expect(objects.find((f) => f.name === 'bump')!.params[0]!.mode).toBe('inout');
    expect(objects.find((f) => f.name === 'get')!.params[0]!.mode).toBeUndefined();
  });

  it('writes through an entry parameter only where the entry takes the caller object', () => {
    const halves = bothHalves(
      program(
        `interface V { a: location<0, f32> }\n@fragment export function fs(v: V): vec4 { v.a = 1.; return vec4(v.a) }`,
      ),
    );
    expect(halves.compiler).toHaveLength(1);
    expect(halves.compiler[0]).toContain('TS8018: Cannot write through parameter "v"');
    expect(halves.editor).toEqual(halves.compiler);
  });

  it('takes a Map as a parameter of a kernel function', () => {
    const halves = bothHalves(
      program(
        'export function lookup(keys: array<u32>, m: Map<u32, f32>, out: array<f32>) {\n  for (let i: u32 = 0; i < keys.length; i++) {\n    if (m.has(keys[i])) {\n      out[i] = m.get(keys[i]);\n    }\n  }\n}',
      ),
    );
    expect(halves.compiler).toEqual([]);
    const kernel = halves.result.module.funcs[0]!;
    expect(kernel.kernel).toBe(true);
    expect(kernel.params[1]!.type.kind).toBe('collection');
  });

  it('gives a field with a refused attribute no second complaint, in a vertex or a compute struct', () => {
    for (const [type, value, field, entry] of [
      [
        'vec4',
        'vec4(0.)',
        '; a: location<0, f32> = 0.',
        '@vertex export function vs(): S { return new S() }',
      ],
      ['vec3u', 'vec3u(0, 0, 0)', '', '@compute([64]) export function c(s: S) { }'],
    ]) {
      const halves = bothHalves(
        program(`class S { @builtin("nope") p: ${type} = ${value}${field}; }\n${entry}`),
      );
      expect(halves.compiler).toHaveLength(1);
      expect(halves.compiler[0]).toContain('TS8024: Unknown builtin "nope".');
      expect(halves.editor).toEqual(halves.compiler);
    }
  });
});
