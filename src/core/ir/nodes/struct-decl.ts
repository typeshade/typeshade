import type { ShaderType } from '../types.js';

/** One field of a {@link StructDecl}: a plain data member of a uniform or storage struct,
 *  or, in a vertex/fragment I/O struct, a member carrying a `@builtin` or `@location`
 *  attribute. Build these with {@link builtin} and {@link location}, which fill both
 *  `attr` and the structured `builtin`/`location` fields. The GLSL backend ignores `attr`
 *  and reads `location`/`builtin` directly: GLSL ES 3.00 has no struct-field attribute
 *  syntax, so an I/O struct is flattened into individual `in`/`out` globals keyed off
 *  those fields.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export interface StructField {
  readonly name: string;
  readonly type: ShaderType;
  /** Optional WGSL field attribute(s) for I/O structs, e.g.
   *  `@builtin(position)`, `@location(0)`, `@location(0) @interpolate(flat)`.
   *  This is the emitted spelling; the structured fields below (`location`,
   *  `builtin`, `interpolate`) are what the backends read. They never re-parse
   *  this string. */
  readonly attr?: string;
  /** Structured `@location(n)`. Set by {@link location}. */
  readonly location?: number;
  /** Structured `@builtin(name)`. Set by {@link builtin}. */
  readonly builtin?: string;
  /** Structured `@interpolate(mode)` (set alongside `location`). */
  readonly interpolate?: string;
  /** Structured `@blend_src(0|1)` on a fragment output (§53): the two colours a dual-source
   *  blend mixes, which both sit at `@location(0)`. It derives the `dualSourceBlending`
   *  capability. The GLSL writer does not spell a second source yet, so a module that carries
   *  one fails closed there: not supported yet by the GLSL backend (Rule 10.3). */
  readonly blendSrc?: number;
  /** The byte size WGSL's `@size(n)` gives this field, when the field's own type is smaller.
   *  Set by the uniform-layout pass (§51) and by nothing else: it is how the wrapper struct
   *  that gives a uniform array its 16-byte element stride is spelled,
   *  `struct _Pad16_f32 { @size(16) v: f32, }`. It is NOT an author attribute — `@size` on a
   *  field is still refused at the front end, because `reflect`'s layout engine does not read
   *  this, and an attribute the emit honoured while reflection ignored it is the very
   *  emit-versus-reflection disagreement §51 exists to close. The WGSL writer emits it; GLSL
   *  ES 3.00 has no equivalent, and no module reaches that writer carrying one (the pass runs
   *  on the WGSL side alone). */
  readonly size?: number;
  /** The byte alignment WGSL's `@align(n)` gives this field. Set by the uniform-layout pass
   *  (§51) and by nothing else, for the same reason `size` is, and it is the other half of the
   *  same fix: `@size(16)` on a wrapper's field gives the ARRAY ELEMENT its 16-byte stride,
   *  and `@align(16)` on the MEMBER holding that array gives the array its 16-byte offset.
   *  With the stride fixed but the member unaligned the array lands at offset 4, which is the
   *  offset `reflect()` does NOT report; Chromium 141 states it outright (`the offset of a
   *  struct member of type 'array<_Pad16_f32, 3>' in address space 'uniform' must be a
   *  multiple of 16 bytes, but 'xs' is currently at offset 4`), and an implementation with
   *  `uniform_buffer_standard_layout` accepts the same text while laying it out differently
   *  from what reflection reports. */
  readonly align?: number;
}
/** A `ModuleDecl.structs` entry: a WGSL `struct` declaration. On GLSL it becomes a
 *  plain struct, or a flattened set of `in`/`out` globals when its fields carry
 *  `location`/`builtin` (see {@link StructField}). Use {@link uniformStruct} or
 *  {@link ioStruct} to derive one together with its binding and typed field access
 *  instead of writing this shape by hand.
 *
 *  Exported from `typeshade`, `typeshade/core/ir`.
 */
export interface StructDecl {
  readonly name: string;
  readonly fields: readonly StructField[];
}
