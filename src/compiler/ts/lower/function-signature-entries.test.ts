import { describe, expect, it } from 'vitest';
import { bothHalves, bothRefuse, bothTake } from '../../../core/testing/both-halves.js';

const program = (body: string): string => `"use typeshade"\n${body}\n`;

type Row = readonly [name: string, body: string, code: string, sentences: string | string[]];

const REFUSALS: readonly Row[] = [
  [
    'a type argument on @vertex',
    '@vertex<f32>() export function vs(): vec4 { return vec4(0.) }',
    'TS8028',
    '"@vertex<f32>()" is not applied: an attribute is written "@name" or "@name(...)". Remove it.',
  ],
  [
    'an f64 entry result with no result type',
    '@fragment export function fs() { const x: f64 = f64(1.); return x }',
    'TS8038',
    'The return of entry "fs" carries f64: an emulated double is a pair of f32 words, and a @location varying interpolates each word on its own, which is not the interpolation of the double. Narrow it with f32(x), or compute the double in the stage that needs it — a uniform or storage binding carries an f64 and every stage can read one.',
  ],
  [
    'a compute entry that returns a struct of user-defined fields',
    'interface S { a: f32 }\n@compute([64]) export function c(g: builtin<"global_invocation_id">): S { return { a: 1. } }',
    'TS8029',
    'Struct "S" field "a" is a user-defined output and "S" is a compute entry output, which has no user IO: a compute shader reads its work from resources and the builtin<…> invocation ids.',
  ],
  [
    'a vertex entry that returns f32',
    '@vertex export function vs(): f32 { return 1. }',
    'TS8020',
    '"vs" is a vertex entry, so it returns the position: a vec4, which is the position on its own, or a struct with a field typed builtin<"position">. It returns f32.',
  ],
  [
    'a vertex entry that returns void',
    '@vertex export function vs(): void { }',
    'TS8020',
    '"vs" is a vertex entry, so it returns the position: a vec4, which is the position on its own, or a struct with a field typed builtin<"position">. It returns nothing.',
  ],
  [
    'a vertex entry whose struct has no position',
    'interface S { a: location<0, f32> }\n@vertex export function vs(): S { return { a: 1. } }',
    'TS8020',
    '"vs" is a vertex entry, so what it returns has to carry the position: give "S" a field typed builtin<"position">.',
  ],
  [
    'a vertex entry whose return names an unknown struct',
    '@vertex export function vs(): Nope { return 1 }',
    'TS8002',
    'Unknown type "Nope". Declare it in this file, or import it from another shader module.',
  ],
  [
    'a vertex entry with no result type that returns nothing',
    '@vertex export function vs() { }',
    'TS8020',
    '"vs" is a vertex entry, so it returns the position: a vec4, which is the position on its own, or a struct with a field typed builtin<"position">. It returns nothing.',
  ],
  [
    'a vertex entry with no result type that returns f32',
    '@vertex export function vs() { return 1. }',
    'TS8020',
    '"vs" is a vertex entry, so it returns the position: a vec4, which is the position on its own, or a struct with a field typed builtin<"position">. It returns f32.',
  ],
  [
    'a vertex entry with no result type that returns a struct with no position',
    'interface S { a: location<0, f32> }\n@vertex export function vs() { const s: S = { a: 1. }; return s }',
    'TS8020',
    '"vs" is a vertex entry, so what it returns has to carry the position: give "S" a field typed builtin<"position">.',
  ],
  [
    'a compute entry with no result type that returns a value',
    '@compute([64]) export function c() { return 1. }',
    'TS8021',
    'Entry function "c" is a compute entry, and a compute entry returns nothing (WGSL): it returns f32. Write the value to a storage binding.',
  ],
  [
    'two stage attributes',
    '@vertex @fragment export function f(): vec4 { return vec4(0.) }',
    'TS8028',
    '"@fragment" is a second stage attribute on "f", after "@vertex": an entry has exactly one stage, "@vertex", "@fragment" or "@compute([…])" (Rule 8.1).',
  ],
  [
    'an argument list on @vertex',
    '@vertex() export function vs(): vec4 { return vec4(0.) }',
    'TS8028',
    '"@vertex" takes no argument: write "@vertex" and delete "()" (Rule 8.1).',
  ],
  [
    'an argument on @fragment',
    '@fragment(1) export function fs(): vec4 { return vec4(0.) }',
    'TS8028',
    '"@fragment" takes no argument: write "@fragment" and delete "(1)" (Rule 8.1).',
  ],
  [
    'a type argument on @fragment',
    '@fragment<f32>() export function fs(): vec4 { return vec4(0.) }',
    'TS8028',
    '"@fragment<f32>()" is not applied: an attribute is written "@name" or "@name(...)". Remove it.',
  ],
  [
    'a type argument on @compute',
    '@compute<f32>([64]) export function c() { }',
    'TS8028',
    '"@compute<f32>([64])" is not applied: an attribute is written "@name" or "@name(...)". Remove it.',
  ],
  [
    'a workgroup argument that is an object',
    '@compute({ workgroup: [8,8,1] }) export function c() { }',
    'TS8037',
    'compute takes an array of one to three whole numbers, "@compute([64, 1, 1])"; "{ workgroup: [8,8,1] }" is not a workgroup shape.',
  ],
  [
    'a workgroup argument that is a number',
    '@compute(128) export function c() { }',
    'TS8037',
    'compute takes an array of one to three whole numbers, "@compute([64, 1, 1])"; "128" is not a workgroup shape.',
  ],
  [
    'a workgroup shape of four numbers',
    '@compute([1,1,1,1]) export function c() { }',
    'TS8037',
    'compute takes an array of one to three whole numbers, "@compute([64, 1, 1])"; "[1,1,1,1]" is not a workgroup shape.',
  ],
  [
    'a built-in of another stage in a struct parameter',
    'interface In { id: builtin<"global_invocation_id"> }\n@fragment export function fs(i: In): vec4 { return vec4(0.) }',
    'TS8025',
    'Builtin "global_invocation_id" is not a valid fragment input; it is a compute input.',
  ],
  [
    'a built-in of another stage as a parameter',
    '@vertex export function vs(p: builtin<"global_invocation_id">): vec4 { return vec4(0.) }',
    'TS8025',
    'Builtin "global_invocation_id" is not a valid vertex input; it is a compute input.',
  ],
  [
    'an optional result of a kernel function',
    'export function k(a: array<f32>): f32 | undefined { return undefined }',
    'TS8002',
    '"f32 | undefined" holds a value and a flag saying whether it is there, which a local, a parameter, a function\'s result, a struct field or an array element may hold; a kernel function\'s result may not. Carry a u32 flag beside the value, "f32", in an array the function writes, or return a struct with a "found: u32" field beside it.',
  ],
  [
    'an optional struct field in the result of a kernel function',
    'interface R { v: f32 | undefined }\nexport function k(a: array<f32>): R { return { v: undefined } }',
    'TS8002',
    '"R" holds "v: f32 | undefined", a value and a flag saying whether it is there, which a local, a parameter, a function\'s result, a struct field or an array element may hold; a kernel function\'s result may not. Carry a u32 flag beside the value, "f32", in an array the function writes, or return a struct with a "found: u32" field beside it.',
  ],
];

describe('the entry points of a signature', () => {
  it.each(REFUSALS)('both halves refuse %s', (_name, body, code, sentences) => {
    bothRefuse(program(body), code, sentences);
  });

  it.each([
    ['f32', 'f32', 'f32(1.)'],
    ['vec2', 'vec2', 'vec2(1.)'],
    ['vec3', 'vec3', 'vec3(1.)'],
    ['vec4', 'vec4', 'vec4(1.)'],
  ])(
    'puts @location(0) on a fragment entry that returns %s, written or inferred',
    (_n, type, value) => {
      const written = bothTake(
        program(`@fragment export function fs(): ${type} { return ${value} }`),
      );
      const inferred = bothTake(program(`@fragment export function fs() { return ${value} }`));
      for (const halves of [written, inferred]) {
        expect(halves.result.module.funcs[0]!.retAttr).toBe('@location(0)');
        expect(halves.result.wgsl).toContain('-> @location(0)');
      }
    },
  );

  it('puts @builtin(position) on a vertex entry that returns a vec4, written or inferred', () => {
    const written = bothTake(program('@vertex export function vs(): vec4 { return vec4(1.) }'));
    const inferred = bothTake(program('@vertex export function vs() { return vec4(1.) }'));
    for (const halves of [written, inferred]) {
      const entry = halves.result.module.funcs[0]!;
      expect(entry.retAttr).toBe('@builtin(position)');
      expect(entry.retBuiltin).toBe('position');
      expect(halves.result.wgsl).toContain('-> @builtin(position) vec4<f32>');
    }
  });

  it('takes a vertex entry that returns a struct with a position field', () => {
    const halves = bothTake(
      program(
        'interface S { p: builtin<"position">; a: location<0, f32> }\n@vertex export function vs(): S { return { p: vec4(0.), a: 1. } }',
      ),
    );
    expect(halves.result.module.funcs[0]!.retAttr).toBeUndefined();
  });

  it('says no second sentence about a vertex result that an error in the body explains', () => {
    bothRefuse(
      program('@vertex export function vs() { return undefinedName }'),
      'TS8022',
      'Unknown identifier "undefinedName".',
    );
  });

  it('says a slot collision of a struct once, though two entries use the struct', () => {
    const halves = bothHalves(
      program(
        'interface V { pos: builtin<"position">; a: location<0, f32>; b: location<0, f32> }\n@vertex export function vs(): V { return { pos: vec4(0.), a: 1., b: 2. } }\n@fragment export function fs(v: V): vec4 { return vec4(0.) }',
      ),
    );
    const own = (lines: readonly string[]) => lines.filter((l) => l.includes('Struct "V" puts'));
    expect(own(halves.compiler)).toHaveLength(1);
    expect(own(halves.editor)).toHaveLength(1);
  });

  it('shows a struct of a namespace as an author wrote it', () => {
    bothRefuse(
      program(
        'namespace N { export class VOut { a: f32 = 0. } }\n@compute([64]) export function c(v: N.VOut) { }',
      ),
      'TS8029',
      'Struct "N.VOut" field "a" is a user-defined input and "N.VOut" is a compute entry input, which has no user IO: a compute shader reads its work from resources and the builtin<…> invocation ids.',
    );
  });

  it('keeps a workgroup shape only when its y or z is not 1', () => {
    const entries = bothTake(
      program(
        '@compute([8, 1, 1]) export function c() { }\n@compute([8, 2, 1]) export function d() { }\n@compute([8]) export function e() { }',
      ),
    ).result.module.funcs;
    const shape = (name: string) => entries.find((f) => f.name === name)!.workgroupShape;
    expect(entries.map((f) => f.workgroupSize)).toEqual([8, 8, 8]);
    expect([shape('c'), shape('d'), shape('e')]).toEqual([undefined, [8, 2, 1], undefined]);
  });

  it('takes a workgroup extent from a module constant or an override, and defaults to 64', () => {
    const constant = bothTake(
      program('const SIZE: u32 = 8\n@compute([SIZE, 2]) export function c() { }'),
    );
    expect(constant.result.module.funcs[0]!.attrs).toEqual(['@compute @workgroup_size(SIZE, 2)']);
    const override = bothTake(
      program('const T: override<u32> = 64;\n@compute([T, 2]) export function c() { }'),
    ).result.module.funcs[0]!;
    expect(override.workgroupSizeOverrides).toEqual(['T', undefined, undefined]);
    for (const spelling of ['@compute()', '@compute']) {
      const entry = bothTake(program(`${spelling} export function c() { }`)).result.module
        .funcs[0]!;
      expect(entry.attrs).toEqual(['@compute @workgroup_size(64)']);
    }
  });

  it('warns once, in both halves, of a workgroup over a default limit', () => {
    const limits = [
      [
        '[1024]',
        'compute workgroup shape [1024] has x = 1024, over maxComputeWorkgroupSizeX (256).',
      ],
      [
        '[1, 257]',
        'compute workgroup shape [1, 257] has y = 257, over maxComputeWorkgroupSizeY (256).',
      ],
      [
        '[1, 1, 65]',
        'compute workgroup shape [1, 1, 65] has z = 65, over maxComputeWorkgroupSizeZ (64).',
      ],
      [
        '[32, 32, 1]',
        'compute workgroup shape [32, 32, 1] has 1024 invocations, over maxComputeInvocationsPerWorkgroup (256).',
      ],
    ];
    for (const [shape, head] of limits) {
      const halves = bothHalves(program(`@compute(${shape}) export function c() { }`));
      const warnings = halves.result.diagnostics.map(
        (d) => `${d.category} ${d.code}: ${d.message}`,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(`warning TS8026: ${head} WebGPU guarantees no more`);
      expect(halves.editor).toHaveLength(1);
      expect(halves.editor[0]).toContain(`TS8026: ${head}`);
    }
    bothTake(program('@compute([256]) export function c() { }'));
    bothTake(program('@compute([16, 16, 1]) export function c() { }'));
  });

  it('checks the built-ins of a struct that a fragment entry with no result type returns', () => {
    const halves = bothHalves(
      program(
        'interface S { id: builtin<"global_invocation_id"> }\n@fragment export function fs() { const s: S = { id: vec3u(0, 0, 0) }; return s }',
      ),
    );
    expect(halves.compiler).toEqual([
      'typeshade TS8025: Builtin "global_invocation_id" is not a valid fragment output; it is a compute input.',
    ]);
    expect(halves.editor).toContain(halves.compiler[0]);
  });
});
