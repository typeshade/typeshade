import { describe, expect, it } from 'vitest';
import { kernelWorkgroups } from '../../../core/kernel-workgroup.js';
import { bothHalves, bothRefuse, bothTake } from '../../../core/testing/both-halves.js';

const program = (body: string): string => `"use typeshade"\n${body}\n`;
const KERNEL = 'export function k(a: array<f32>) { }';

type Row = readonly [name: string, body: string, code: string, sentences: string | string[]];

const REFUSALS: readonly Row[] = [
  [
    'a type argument on the second of two workgroup_size attributes',
    '@workgroup_size([8]) @workgroup_size<f32>([9]) export function k(a: array<f32>) { }',
    'TS8028',
    '"@workgroup_size<f32>([9])" is not applied: an attribute is written "@name" or "@name(...)". Remove it.',
  ],
  [
    'a workgroup_size on a function that is not a kernel function',
    '@workgroup_size([64]) export function f(a: f32): f32 { return a }',
    'TS8028',
    '"workgroup_size" applies to a kernel function only: an exported function that takes an array with no size (Rule 8.22). Declare "f" without it.',
  ],
  [
    'a second workgroup_size',
    '@workgroup_size([64]) @workgroup_size([32]) export function k(a: array<f32>) { a[0] = 1. }',
    'TS8028',
    '"@workgroup_size([32])" is a second "@workgroup_size" on "k", after "@workgroup_size([64])": a function takes at most one "@workgroup_size([n])"; delete "@workgroup_size([32])" (Rule 8.22).',
  ],
  [
    'two further workgroup_size attributes',
    '@workgroup_size([8]) @workgroup_size([9]) @workgroup_size([10]) export function k(a: array<f32>) { }',
    'TS8028',
    [
      '"@workgroup_size([9])" is a second "@workgroup_size" on "k", after "@workgroup_size([8])": a function takes at most one "@workgroup_size([n])"; delete "@workgroup_size([9])" (Rule 8.22).',
      '"@workgroup_size([10])" is a second "@workgroup_size" on "k", after "@workgroup_size([8])": a function takes at most one "@workgroup_size([n])"; delete "@workgroup_size([10])" (Rule 8.22).',
    ],
  ],
  [
    'two workgroup_size attributes on a function that is not a kernel function',
    '@workgroup_size([8]) @workgroup_size([9]) export function k(a: f32) { }',
    'TS8028',
    [
      '"workgroup_size" applies to a kernel function only: an exported function that takes an array with no size (Rule 8.22). Declare "k" without it.',
      '"workgroup_size" applies to a kernel function only: an exported function that takes an array with no size (Rule 8.22). Declare "k" without it.',
    ],
  ],
  [
    'a workgroup_size extent that is not whole',
    '@workgroup_size([1.5]) export function k(a: array<f32>) { a[0] = 1. }',
    'TS8037',
    'workgroup_size takes an array of one whole number, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "[1.5]" is not one.',
  ],
  [
    'a workgroup_size with no argument',
    '@workgroup_size export function k(a: array<f32>) { a[0] = 1. }',
    'TS8037',
    'workgroup_size takes an array of one whole number, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "@workgroup_size" is not one.',
  ],
  [
    'a workgroup_size extent of zero',
    '@workgroup_size([0]) export function k(a: array<f32>) { }',
    'TS8037',
    'workgroup_size takes an array of one whole number, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "[0]" is not one.',
  ],
  [
    'a workgroup_size of two extents',
    '@workgroup_size([8, 8]) export function k(a: array<f32>) { }',
    'TS8037',
    'workgroup_size takes an array of one whole number, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "[8, 8]" is not one.',
  ],
  [
    'a workgroup_size extent from an f32 constant',
    'const T: f32 = 32.\n@workgroup_size([T]) export function k(a: array<f32>) { }',
    'TS8037',
    'workgroup_size takes an array of one whole number, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "[T]" is not one.',
  ],
  [
    'a workgroup_size extent from an override',
    'const T: override<u32> = 64;\n@workgroup_size([T]) export function k(a: array<f32>) { }',
    'TS8037',
    'workgroup_size takes an array of one whole number, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "[T]" is not one.',
  ],
  [
    'a type argument on workgroup_size',
    '@workgroup_size<f32>([8]) export function k(a: array<f32>) { }',
    'TS8028',
    '"@workgroup_size<f32>([8])" is not applied: an attribute is written "@name" or "@name(...)". Remove it.',
  ],
  [
    'a workgroup_size written as a call',
    'export const k = workgroup_size([128], function k(a: array<f32>) { })',
    'TS8028',
    'a kernel\'s size is an attribute on the function declaration: write "@workgroup_size([128]) export function k(…)", or run "tshc migrate" (change 0130)',
  ],
  [
    'a stage written as a call',
    'export const vs = vertex(function vs(): vec4 { return vec4(0.) })',
    'TS8028',
    'a stage is an attribute on the function declaration: write "@vertex export function vs(…)", or run "tshc migrate" (change 0130)',
  ],
];

describe('the workgroup_size of a kernel function', () => {
  it.each(REFUSALS)('both halves refuse %s', (_name, body, code, sentences) => {
    bothRefuse(program(body), code, sentences);
  });

  it.each([
    ['a literal', '@workgroup_size([128])', '', 128],
    ['an u32 constant', '@workgroup_size([T])', 'const T: u32 = 32\n', 32],
    ['an i32 constant', '@workgroup_size([T])', 'const T: i32 = 16\n', 16],
    ['a parenthesized cast', '@workgroup_size([(128 as u32)])', '', 128],
  ])(
    'takes %s as the extent and records it for the loops of the function',
    (_n, attr, pre, size) => {
      const halves = bothTake(program(`${pre}${attr} ${KERNEL}`));
      const kernel = halves.result.module.funcs[0]!;
      expect(kernel.kernel).toBe(true);
      expect(kernelWorkgroups.get(kernel)).toBe(size);
    },
  );

  it('records no extent for a kernel function with no workgroup_size', () => {
    const kernel = bothTake(program(KERNEL)).result.module.funcs[0]!;
    expect(kernelWorkgroups.get(kernel)).toBeUndefined();
  });

  it('warns once, in both halves, of an extent over the default limit, and still takes it', () => {
    const halves = bothHalves(program(`@workgroup_size([512]) ${KERNEL}`));
    const warnings = halves.result.diagnostics.map((d) => `${d.category} ${d.code}: ${d.message}`);
    expect(warnings).toEqual([
      'warning TS8026: workgroup_size shape [512, 1, 1] has x = 512, over maxComputeWorkgroupSizeX (256). WebGPU guarantees no more, so a device requested without raising that limit refuses the pipeline.',
    ]);
    expect(halves.editor).toEqual([
      `typeshade TS8026: ${warnings[0]!.slice('warning TS8026: '.length)}`,
    ]);
    expect(kernelWorkgroups.get(halves.result.module.funcs[0]!)).toBe(512);
  });

  it('says one refusal for one attribute although the signature is read twice', () => {
    const halves = bothHalves(program(`@workgroup_size([0]) ${KERNEL}`));
    expect(halves.compiler).toHaveLength(1);
    expect(halves.editor).toHaveLength(1);
  });
});
