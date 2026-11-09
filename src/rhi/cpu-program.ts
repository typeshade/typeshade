// The program the CPU backend of the render hardware interface runs (change 0120, milestone M3).
//
// The GPU backends run shader text: WGSL on WebGPU, the GLSL ES 3.00 programs of the manifest on
// WebGL2. The CPU backend runs the CPU tier's generated code (Rule 11.7): the functions the CPU
// code generator writes for a module (`core/cpu-codegen.ts`), over the runtime they close over
// (`core/cpu-codegen-runtime.ts`). That code is JavaScript, which a manifest's JSON cannot carry,
// so the CPU backend takes it as an object, a `CpuProgram`, in place of the text a GPU backend's
// `createShaderModule` takes.
//
// Besides the functions, a `CpuProgram` carries what the code itself does not say and a backend
// needs to call it: each entry's stage interface, parameter by parameter (a builtin, a location,
// or a struct of fields, which the generated code takes as one object keyed by field name), and
// each buffer binding's name and byte layout, by which the backend turns the bytes of a buffer
// into the value the code reads by that name, and back.
//
// Change 0120, O2 (a): a module's host import carries its `CpuProgram` on its default export under
// the key `CPU_PROGRAM`, a `Symbol`, which `JSON.stringify` drops, so the manifest's JSON does not
// change. This file declares the key and the shape, and imports nothing.

import type { PackLayout } from '../core/manifest-types.js';

/** The key a module's default export carries its `CpuProgram` under (change 0120, O2 (a)). A
 *  manifest read from JSON or built by `packModule()` has none. */
export const CPU_PROGRAM: unique symbol = Symbol.for('typeshade.cpuProgram') as never;

/** One field of a stage interface: a builtin or a location, with its interpolation. */
export interface CpuIoField {
  readonly name: string;
  readonly builtin?: string;
  readonly location?: number;
  /** WGSL's interpolation words, as written: `'flat'`, `'linear'`, `'perspective'`, then a
   *  sampling word. Absent is `perspective`. */
  readonly interpolate?: string;
  /** Whether the field holds an integer (`i32`, `u32` or a vector of them), which a varying of
   *  WGSL interpolates only `flat`. */
  readonly integer?: true;
  /** How many numbers the field holds: 1 for a scalar, `n` for a vector of `n`; absent for a
   *  type a stage interface cannot hold. */
  readonly width?: number;
}

/** A parameter or a result of an entry: one field, or a struct of fields, which the generated
 *  code takes and returns as one object keyed by field name. */
export type CpuIo =
  | { readonly kind: 'field'; readonly field: CpuIoField }
  | { readonly kind: 'struct'; readonly fields: readonly CpuIoField[] };

/** An entry of a `CpuProgram`, by the name the emitted text declares it under. */
export interface CpuEntry {
  /** The function of `F` that runs the entry. */
  readonly fn: string;
  readonly stage: 'vertex' | 'fragment' | 'compute';
  readonly params: readonly CpuIo[];
  /** The result; absent for an entry that returns nothing. */
  readonly out?: CpuIo;
  /** A compute entry's `@workgroup_size`. */
  readonly workgroupSize?: readonly [number, number, number];
  /** Why the CPU backend cannot run the entry, when it cannot: it reaches a texture, a sampler,
   *  a derivative or another call only a GPU computes, or a barrier (change 0120, O6 (a)). */
  readonly noCpu?: string;
}

/** A buffer binding the program's code reads by `name`, at its group and slot. */
export interface CpuBinding {
  readonly name: string;
  readonly group: number;
  readonly binding: number;
  /** Its byte layout under the rule of its space; absent with `noLayout` for a buffer whose type
   *  has no host layout (a `bool`), or for a handle (a texture, a sampler). */
  readonly layout?: PackLayout;
  /** What the binding is: a uniform or storage buffer, or a handle the CPU backend cannot read. */
  readonly kind: 'uniform' | 'storage' | 'handle';
  /** Why the binding has no layout, when it has none. */
  readonly noLayout?: string;
}

/** The functions the CPU tier's code generator wrote for a module, and the runtime they close
 *  over: the shape of the call layer's `GeneratedCpu` (`core/host-entry.ts`). */
export interface CpuCode {
  readonly F: Readonly<Record<string, (...a: never[]) => unknown>>;
  readonly $: {
    bindings: Record<string, unknown>;
    vars: Record<string, unknown>;
    invocation?: readonly number[] | undefined;
  };
  /** The same code built again with override values, when the module declares overrides. */
  readonly specialize?: (values: Readonly<Record<string, number | boolean>>) => CpuCode;
}

/** What the CPU backend's `createShaderModule` takes: a module's CPU code, its entries and its
 *  buffer bindings. */
export interface CpuProgram {
  readonly code: CpuCode;
  /** Each entry, by the name the emitted text declares it under. */
  readonly entries: Readonly<Record<string, CpuEntry>>;
  readonly bindings: readonly CpuBinding[];
  /** Each workgroup variable's zero value, by name: every workgroup starts from these. */
  readonly workgroupZero: Readonly<Record<string, unknown>>;
}

/** Whether `v` is a `CpuProgram`: what a GPU backend's `createShaderModule` refuses. */
export function isCpuProgram(v: unknown): v is CpuProgram {
  return (
    typeof v === 'object' &&
    v !== null &&
    'code' in v &&
    'entries' in v &&
    'bindings' in v &&
    'workgroupZero' in v
  );
}
