// Data shared by export analysis and the two host generators; no compilation or output generation.
import { type CpuValue } from '../../core/cpu-runtime.js';
import type { FragmentEntry } from '../../core/host-draw.js';
import { type ComputeEntry } from '../../core/host-entry.js';
import type { KernelFace } from '../../core/host-kernel.js';
import type { HostType } from '../../core/host-values.js';
import type { FuncDecl } from '../../core/ir/nodes.js';
import type { ClassLayouts } from '../../runtime/resource.js';

/** One export of a shader module, as the host sees it. */
export type HostExport =
  | {
      readonly kind: 'function';
      readonly name: string;
      /** The IR function the call runs. */
      readonly fn: string;
      readonly params: readonly { readonly name: string; readonly type: HostType }[];
      readonly result: HostType;
    }
  | {
      readonly kind: 'const';
      readonly name: string;
      readonly const: string;
      readonly type: HostType;
    }
  | {
      readonly kind: 'enum';
      readonly name: string;
      readonly members: readonly (readonly [string, number])[];
    }
  | { readonly kind: 'struct'; readonly name: string; readonly type: HostType & { k: 'struct' } }
  | {
      /** A `@compute` entry a host can call (Rule 8.24): everything the call needs but the WGSL,
       *  which the module shares, and the TypeScript type of its bindings object. */
      readonly kind: 'compute';
      readonly name: string;
      readonly entry: Omit<ComputeEntry, 'wgsl' | 'log'>;
      readonly bindingsType: string;
      /** The bindings object of a call on a resource, which does not block, when every binding
       *  the entry writes is a storage array with no size, which a `Buffer` may stand for (change
       *  0138, R2; Amendment A10, Q-I). */
      readonly queuedType?: string;
      /** The bindings object of a call on a resource that writes a plain array, which waits
       *  (Amendment A11, Q7); present with {@link queuedType}. */
      readonly waitingType?: string;
    }
  | {
      /** A full-screen `@fragment` entry a host can draw into a canvas (Rule 8.24): everything
       *  the draw needs but the WGSL, and the TypeScript type of its bindings object. */
      readonly kind: 'fragment';
      readonly name: string;
      readonly entry: Omit<FragmentEntry, 'wgsl' | 'log'>;
      readonly bindingsType: string;
    }
  | {
      /** A kernel function (Rule 8.22), whose call is asynchronous and dispatches its loops
       *  (Rule 8.21). `ranges` are the CPU-tier functions its call runs beside the GPU: its
       *  ranges first, then the tail and the stores after the loops (change 0094). */
      readonly kind: 'kernel';
      readonly name: string;
      readonly face: KernelFace;
      readonly ranges: readonly FuncDecl[];
    }
  | {
      /** A binding the module exports that is a host resource (change 0138, R10; Rule 6.1;
       *  Amendment A5, D6): a `uniform<T>` of an exported class is a `Uniform<T>`, and a
       *  `storage<array<T, N>>` or `storage<array<T>>` of one a `Buffer<T>`, which the generated
       *  module makes once. The view types it without `dispose()` (D7). */
      readonly kind: 'resource';
      readonly name: string;
      /** The exported class whose layouts it reads, by the name the host imports. */
      readonly cls: string;
      /** A storage array's element count, `null` for one with no size, whose length the host
       *  sets (Amendment A3); absent for a uniform. */
      readonly length?: number | null;
    }
  | {
      readonly kind: 'never';
      readonly name: string;
      /** Why the host cannot use it, and which later work adds it when one is planned. */
      readonly reason: string;
      /** A type-only export (an interface, a type alias), which has no value to refuse. */
      readonly typeOnly?: true;
    };

// ─── classes (change 0109) ───────────────────────────────────────────────────────────────────
//
// An exported class is a value of the host face: the view declares it as a class, and the
// generated module exports a JavaScript class of its name, whose instances are the struct's host
// value (Rule 8.21) with the fields as their own properties. `exports` reports it as the struct
// it is, so `hostFace` keeps the shape of its result; the view and the module read the class.

/** A function of the module that a member of an exported class runs: its host signature, and
 *  what the call does with the instance. */
export interface MemberCall {
  /** The IR function: `OnePole_tick`, `OnePole_get_gain`, `OnePole_new`. */
  readonly fn: string;
  readonly params: readonly { readonly name: string; readonly type: HostType }[];
  readonly result: HostType;
  /** It takes its object by reference (Rule 8.10), so the call writes the instance back. */
  readonly writes: boolean;
  /** Every `return` is `return this` (Rule 8.10), so the call returns the instance itself. */
  readonly self: boolean;
}

/** Why a host cannot call a member (Rule 8.20, D3): the member is declared `never`. */
export interface Refused {
  readonly reason: string;
}

/** A member of an exported class: a method, a field that holds a function among them (Rule
 *  8.16), or an accessor property, each part with its call or the reason it has none. */
export type ClassMember =
  | {
      readonly kind: 'method';
      readonly name: string;
      readonly static: boolean;
      readonly abstract: boolean;
      readonly call: MemberCall | Refused;
    }
  | {
      readonly kind: 'accessor';
      readonly name: string;
      readonly static: boolean;
      readonly abstract: boolean;
      readonly get?: MemberCall;
      readonly set?: MemberCall;
      readonly reason?: string;
    };

/** A field of an exported class as the view declares it. */
export interface ClassField {
  readonly name: string;
  readonly type: HostType;
  readonly access?: 'private' | 'protected';
  readonly readonly: boolean;
}

/** An exported class a host builds with `new` (Rules 8.20 and 8.21). */
export interface ClassExport {
  readonly kind: 'class';
  readonly name: string;
  /** The struct, whose host value an instance is. */
  readonly type: HostType & { k: 'struct' };
  readonly abstract: boolean;
  /** The structs of the classes it extends, nearest first (Rule 8.9). */
  readonly bases: readonly string[];
  readonly fields: readonly ClassField[];
  /** How `new` builds an instance: the constructor's function, the zero struct for a class with
   *  none, as `new` gives it in the module (surface §26), or why a host cannot (D3). Absent on
   *  an abstract class, which has no instance of its own. */
  readonly ctor?: MemberCall | { readonly zero: CpuValue } | Refused;
  readonly members: readonly ClassMember[];
  /** The struct's layouts for a host resource (change 0138, R7, R9): `u` as one uniform, `s` as
   *  an array with no size in storage, or the reason each has none. The module puts them on the
   *  class, and `uniform()`, `zeros()` and `array()` of `typeshade/runtime` read them. */
  readonly layouts: ClassLayouts;
}

/** A class with a field that has no host value (D4): a type of the host face, with each field
 *  typed by its host value, `never` where it has none, and no value. */
interface ShapeExport {
  readonly kind: 'shape';
  readonly name: string;
  readonly reason: string;
  readonly fields: readonly (readonly [string, HostType | undefined])[];
}

/** An export as the view and the module are built from it. */
export type FaceExport = HostExport | ClassExport | ShapeExport;
