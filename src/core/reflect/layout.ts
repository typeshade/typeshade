import { emittedName, type TargetSpellings } from '../spelling-plan.js';
import { type ShaderType, type StructDecl, typeKey } from '../ir/index.js';
import { twoRowStd140Reason } from '../std140.js';

const roundUp = (x: number, a: number): number => Math.ceil(x / a) * a;

/** The byte-layout rule a struct's fields are placed under. `'std140'` is the rule WGSL
 *  applies to the `uniform` address space, and the rule of a GLSL ES 3.00
 *  `layout(std140) uniform` block: a struct or array base alignment rounds up to 16 bytes, so
 *  a `vec3` field costs 16 and an array of `f32` uses 16 bytes per element. `'std430'` is the
 *  rule WGSL applies to the `storage` address space: natural alignment with no 16-byte
 *  round-up. Vertex attributes use a separate, tightly packed layout (see {@link VertexLayout}).
 *
 *  Pick the rule from the binding's address space, on either backend: `uniform` is std140 and
 *  `storage` is std430. GLSL ES 3.00 has no storage buffer, so a `storage` binding is emitted
 *  as a data texture there, but {@link reflect} describes the module as authored and reports
 *  its fields under std430 in `Reflection.storage`.
 *
 *  A TWO-ROW field — `mat2x2`, `mat3x2`, `mat4x2` — under `'std140'` throws: WGSL's uniform
 *  rule gives a two-row matrix a column stride of 8 bytes while GLSL std140 rounds every
 *  column to 16, and this engine reports one number for both backends. The other six shapes
 *  agree byte for byte (measured on Tint and ANGLE, #149). Carry such a field as the `matCx4`
 *  of the same column count, where both targets stride 16, or as `C` separate `vec2` fields.
 *
 *  Exported from `typeshade`.
 */
export type LayoutKind = 'std140' | 'std430';

/** Size + alignment (bytes) of a host-shareable type under a layout. Throws on a
 *  non-host-shareable type (texture/sampler/void are bind resources, not struct fields).
 *
 *  EXPORTED for `passes/uniform-layout.ts` (§51), which computes the layout of a struct AS
 *  EMITTED — after it has inserted the wrapper structs a uniform array's 16-byte element
 *  stride needs — and so owns its own struct and array recursion. Its leaves are these: the
 *  scalar, vector and matrix numbers are the same rule read from the same place, and a second
 *  copy of the matrix arm is exactly what #149's measurement would have drifted against.
 *  `'std430'` is WGSL's own layout; the uniform address space's extra element rule is what
 *  that pass adds on top.
 *
 *  @internal Exported for that one caller. The published entry is {@link wgslLayout},
 *  which answers the question a consumer has: the layout of a whole struct. */
export function typeLayout(
  t: ShaderType,
  layout: LayoutKind,
  structs: ReadonlyMap<string, StructDecl>,
): { size: number; align: number } {
  switch (t.kind) {
    case 'scalar':
      return { size: 4, align: 4 };
    case 'atomic':
      return { size: 4, align: 4 };
    case 'f64':
      return { size: 8, align: 8 };
    case 'vec64': {
      const vecT: ShaderType = { kind: 'vec', n: t.n, elem: 'f32' };
      const sl = structLayout(
        {
          name: `DF64Vec${t.n}`,
          fields: [
            { name: 'hi', type: vecT },
            { name: 'lo', type: vecT },
          ],
        },
        layout,
        structs,
      );
      return { size: sl.size, align: sl.align };
    }
    case 'vec':
      return t.n === 2
        ? { size: 8, align: 8 }
        : t.n === 3
          ? { size: 12, align: 16 }
          : { size: 16, align: 16 };
    case 'mat': {
      if (t.elem === 'f64') {
        if (t.cols !== t.rows) {
          throw new Error(
            `wgslLayout: ${typeKey(t)} has no layout — the emulated-double matrices are square ` +
              `(the fp64 pass has one df64 body per dimension, not per shape)`,
          );
        }
        const n = t.cols;
        const vecT: ShaderType = { kind: 'vec', n, elem: 'f32' };
        const colStruct: StructDecl = {
          name: `DF64Vec${n}`,
          fields: [
            { name: 'hi', type: vecT },
            { name: 'lo', type: vecT },
          ],
        };
        const nested = new Map(structs);
        nested.set(colStruct.name, colStruct);
        const sl = structLayout(
          {
            name: `DF64Mat${n}`,
            fields: Array.from({ length: n }, (_, j) => ({
              name: `c${j}`,
              type: { kind: 'struct', name: colStruct.name } as ShaderType,
            })),
          },
          layout,
          nested,
        );
        return { size: sl.size, align: sl.align };
      }
      if (layout === 'std140' && t.rows === 2) {
        throw new Error(`wgslLayout: ${twoRowStd140Reason(t.cols)}`);
      }
      const col =
        t.rows === 2
          ? { size: 8, align: 8 }
          : t.rows === 3
            ? { size: 12, align: 16 }
            : { size: 16, align: 16 };
      const stride = roundUp(col.size, col.align);
      return { size: stride * t.cols, align: col.align };
    }
    case 'struct': {
      const sl = structLayout(structByName(structs, t.name), layout, structs);
      return { size: sl.size, align: sl.align };
    }
    case 'array': {
      const el = typeLayout(t.elem, layout, structs);
      let stride = roundUp(el.size, el.align);
      let align = el.align;
      if (layout === 'std140') {
        stride = roundUp(stride, 16);
        align = roundUp(align, 16);
      }
      const count = t.size ?? 0;
      return { size: count * stride, align };
    }
    default:
      throw new Error(`reflect: type '${t.kind}' is not host-shareable (no byte layout)`);
  }
}

function structByName(structs: ReadonlyMap<string, StructDecl>, name: string): StructDecl {
  const s = structs.get(name);
  if (!s) throw new Error(`reflect: struct '${name}' not found in module`);
  return s;
}

/** One struct field's byte layout: its `name`, its DSL type key (the string {@link typeKey}
 *  returns), and its `offset`, `align` and `size` in bytes under the {@link LayoutKind} the
 *  enclosing {@link StructLayout} was computed with. A packer that writes `Float32Array`
 *  slots divides `offset` by 4; every type this engine lays out is at least 4-byte aligned,
 *  so the division is exact.
 *
 *  Exported from `typeshade`.
 */
export interface FieldLayout {
  /** The field's authored name, the one the host reads by. */
  readonly name: string;
  /** The field's name in the emitted text (Rule 11.10). Equal to `name` when the target spells
   *  it as written. */
  readonly emitted: string;
  readonly type: string;
  readonly offset: number;
  readonly align: number;
  readonly size: number;
}
/** A struct's complete byte layout: its total `size` and `align` plus one {@link FieldLayout}
 *  per field, in declaration order. {@link wgslLayout} produces one for a standalone struct;
 *  {@link reflect} produces one for every struct bound in a module, under std140 for a
 *  `uniform` binding and std430 for a `storage` binding (see {@link LayoutKind}). `size` is
 *  already rounded up to `align`, which under std140 is itself rounded to 16, so it is also
 *  the element stride of an array of this struct.
 *
 *  Exported from `typeshade`.
 */
export interface StructLayout {
  /** The struct's authored name, the one the host reads by. */
  readonly name: string;
  /** The struct's name in the emitted text (Rule 11.10). */
  readonly emitted: string;
  readonly size: number;
  readonly align: number;
  readonly fields: readonly FieldLayout[];
}

/** Compute the byte layout of one struct under a {@link LayoutKind}: each field's offset,
 *  alignment and size, plus the struct's total size and alignment. Under `'std140'` the
 *  struct's and every nested array's base alignment rounds up to 16; under `'std430'` natural
 *  alignment applies.
 *
 *  Exported from `typeshade`.
 *
 *  @param struct - the struct to lay out.
 *  @param layout - `'std140'` for a uniform buffer, `'std430'` for a storage buffer.
 *  @param structs - the structs a nested struct-typed field may refer to, by name. Defaults
 *    to a map holding only `struct` itself.
 *  @returns the {@link StructLayout}.
 *  @throws if a field's type has no byte layout (a texture or a sampler), if a nested struct
 *    is not in `structs`, or if a `mat2` field is laid out under `'std140'` (see
 *    {@link LayoutKind}).
 *
 *  @example
 *  ```ts
 *  import { wgslLayout } from 'typeshade'
 *  import { vec3fT, f32T } from 'typeshade/core/ir'
 *
 *  const light = { name: 'Light', fields: [{ name: 'pos', type: vec3fT }, { name: 'radius', type: f32T }] }
 *  wgslLayout(light, 'std140')
 *  // { name: 'Light', size: 16, align: 16, fields: [
 *  //   { name: 'pos', type: 'vec3<f32>', offset: 0, align: 16, size: 12 },
 *  //   { name: 'radius', type: 'f32', offset: 12, align: 4, size: 4 } ] }
 *  ```
 */
export function wgslLayout(
  struct: StructDecl,
  layout: LayoutKind,
  structs: ReadonlyMap<string, StructDecl> = new Map(),
): StructLayout {
  return structLayout(struct, layout, structs.size ? structs : new Map([[struct.name, struct]]));
}

const NO_NAMES: ReadonlyMap<string, string> = new Map();

export function structLayout(
  struct: StructDecl,
  layout: LayoutKind,
  structs: ReadonlyMap<string, StructDecl>,
  names?: TargetSpellings,
): StructLayout {
  if (struct.fields.length === 0) {
    const size = layout === 'std140' ? 16 : 4;
    return {
      name: struct.name,
      emitted: emittedName(names?.structs ?? NO_NAMES, struct.name),
      size,
      align: size,
      fields: [],
    };
  }
  let cursor = 0;
  let maxAlign = 1;
  const fields: FieldLayout[] = [];
  for (const f of struct.fields) {
    const { size, align } = typeLayout(f.type, layout, structs);
    cursor = roundUp(cursor, align);
    fields.push({
      name: f.name,
      emitted: emittedName(names?.members ?? NO_NAMES, f.name),
      type: typeKey(f.type),
      offset: cursor,
      align,
      size,
    });
    cursor += size;
    if (align > maxAlign) maxAlign = align;
  }
  const structAlign = layout === 'std140' ? roundUp(maxAlign, 16) : maxAlign;
  return {
    name: struct.name,
    emitted: emittedName(names?.structs ?? NO_NAMES, struct.name),
    size: roundUp(cursor, structAlign),
    align: structAlign,
    fields,
  };
}
