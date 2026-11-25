import { describe, expect, it } from 'vitest';
import { hostFace } from './host-face.js';

const viewOf = (body: string): string => {
  const view = hostFace(`"use typeshade";\n${body}\n`, { fileName: '/app/a.shade.ts' }).view;
  if (view === undefined) throw new Error('the module has no host view');
  return view;
};

const familyImport = (view: string): string | undefined =>
  view.split('\n').find((line) => line.startsWith('import type {') && !line.includes('{ Pack }'));

describe('the view imports a name of the host type family only where a declaration writes it as a type', () => {
  it('a name in a comment, a parameter and a field is no use of a type', () => {
    const doc = viewOf(
      `/** A vec3 and a mat4 of words, "vec2". */
export function scale(vec3: f32, mat4x4: f32): f32 { return vec3 * mat4x4; }`,
    );
    expect(familyImport(doc)).toBe('import type { f32 } from "typeshade/runtime/internal";');
    const field = viewOf(
      `interface Hit { vec2: f32; t: f32; }
export function mk(a: f32): Hit { return { vec2: a, t: a }; }`,
    );
    expect(familyImport(field)).toBe('import type { f32 } from "typeshade/runtime/internal";');
  });

  it('a type a declaration writes is imported, in the order of the family', () => {
    const view = viewOf(
      `export const K: vec3 = vec3(1., 2., 3.);
export function f(m: mat4x4, x: f32): f32 { return x; }`,
    );
    expect(familyImport(view)).toBe(
      'import type { f32, vec3, mat4x4 } from "typeshade/runtime/internal";',
    );
  });

  it('a module that writes no family type imports only Pack', () => {
    const view = viewOf(
      `declare const cfg: uniform<f32>;\nexport function f(x: f32): f32 { return x + cfg; }`,
    );
    expect(familyImport(view)).toBeUndefined();
    expect(view).toContain('import type { Pack } from "typeshade/runtime/internal";');
  });
});

describe('a class below declares only what it adds or changes', () => {
  it('leaves out a member that has the lines of the class above', () => {
    const view = viewOf(
      `export abstract class Base { n: f32; step(x: f32): f32 { return x; } }
export class D extends Base { step(x: f32): f32 { return x + 1.; } }`,
    );
    expect(view).toContain(
      'export declare abstract class Base {\n  n: f32;\n  step(x: f32): f32;\n}',
    );
    expect(view).toContain('export declare class D extends Base {\n  constructor();\n}');
  });
});

const declarationsOf = (view: string, name: string): string[] =>
  view
    .split('\n')
    .filter((line) => line.startsWith(`export declare function ${name}(`))
    .map((line) => line.replace(/, workgroups.*\)/, ', ...)'));

describe('a call on a resource takes a Buffer only where one can hold the value', () => {
  it('takes a Buffer of a matrix and of f32 for a storage array of matrices', () => {
    const view = viewOf(
      `declare const xs: storage<array<mat2x2>, "read">;
declare const ys: storage<array<f32>, "read_write">;
@compute([1]) export function w(id: builtin<"global_invocation_id">): void { ys[id.x] = xs[id.x][0].x; }`,
    );
    expect(declarationsOf(view, 'w')).toEqual([
      'export declare function w(bindings: { readonly xs: readonly mat2x2[]; readonly ys: Float32Array }, ...): Promise<void>;',
      'export declare function w(bindings: { readonly xs: readonly mat2x2[] | Buffer<mat2x2> | Buffer<f32>; readonly ys: Buffer<f32> }, ...): void;',
      'export declare function w(bindings: { readonly xs: readonly mat2x2[] | Buffer<mat2x2> | Buffer<f32>; readonly ys: Float32Array | Buffer<f32> }, ...): Promise<void>;',
    ]);
  });

  it('declares no call that does not wait for a written array of structs of no class', () => {
    const own = viewOf(
      `interface S { x: f32 }
declare const out: storage<array<S>, "read_write">;
@compute([1]) export function w(id: builtin<"global_invocation_id">): void { out[id.x].x = 1.; }`,
    );
    expect(declarationsOf(own, 'w')).toHaveLength(2);
    expect(own).not.toContain('): void;');
    const cls = viewOf(
      `export class P { x: f32 = 0.; }
declare const out: storage<array<P>, "read_write">;
@compute([1]) export function w(id: builtin<"global_invocation_id">): void { out[id.x].x = 1.; }`,
    );
    expect(declarationsOf(cls, 'w')).toHaveLength(3);
  });

  it('returns a Buffer of a struct, and none of a struct that holds a Record', () => {
    const plain = viewOf(
      `interface S { x: f32 }
export function f(xs: f32[]): array<S, 2> { return [{ x: xs[0] }, { x: 1. }]; }`,
    );
    expect(plain).toContain(
      'export declare function f(xs: Float32Array | Buffer<f32>): Buffer<{ readonly x: f32 }>;',
    );
    const keyed = viewOf(
      `export type Key = "a" | "b";
interface S { r: Record<Key, f32> }
export function f(xs: f32[]): array<S, 2> { return [{ r: { a: xs[0], b: 1. } }, { r: { a: 1., b: 2. } }]; }`,
    );
    expect(declarationsOf(keyed, 'f')).toHaveLength(1);
  });
});

describe('an enum with two members of one value names that value once', () => {
  it('writes each value once in the type', () => {
    expect(viewOf('export enum E { A = 1, B = 1, C = 2 }')).toContain('export type E = 1 | 2;');
  });
});

describe('the Pack of the view leaves out a binding the emit adds', () => {
  it('names the declared binding of an entry that uses f64, and no guard', () => {
    const view = viewOf(
      `declare const k: uniform<f32>;
@fragment export function fs(p: builtin<"position">): vec4 { return vec4(f32(f64(p.x) * f64(p.x)) * k, 0., 0., 1.); }`,
    );
    const pack = view.split('\n').find((line) => line.startsWith('declare const program: Pack<'));
    expect(pack).toBe(
      'declare const program: Pack<{ readonly fs: { readonly k: f32 | { readonly mapAsync: unknown; readonly getMappedRange: unknown } } }>;',
    );
  });
});
