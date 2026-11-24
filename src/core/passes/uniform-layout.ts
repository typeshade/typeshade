// Why: WGSL's uniform address space requires every array element to start on a 16-byte
// boundary, so `array<f32, 4>` in a `var<uniform>` is a shader-creation error unless the optional
// `uniform_buffer_standard_layout` language feature is present. Chromium 141 refuses it with
// `'uniform' storage requires that array elements are aligned to 16 bytes`; Chromium 153 accepts
// it. The pass pads so that the emit and `reflect()` describe the same bytes on both.
// `@size(16)` in a wrapper struct sets the element stride, because no member attribute reaches
// the element. `@align(16)` on the member sets the array offset, because `@size` does not raise
// a struct's alignment.
// GLSL ES 3.00 needs no pass: a std140 block gives `float[4]` a 16-byte stride natively.

import type { BindingDecl, Expr, ModuleDecl, Stmt, StructDecl } from '../ir/nodes.js';
import { arrayT, structT, typeKey, type ShaderType } from '../ir/types.js';
import { eachStmtExpr, mapChildren, mapStmtExpr } from '../ir/visit.js';
import { UnsupportedFeatureError } from '../backend.js';
import { typeLayout } from '../reflect.js';

const UNIFORM_ARRAY_ALIGN = 16;

const WRAPPED_FIELD = 'v';

const roundUp = (x: number, a: number): number => Math.ceil(x / a) * a;

function makeLayout(
  structs: ReadonlyMap<string, StructDecl>,
  decide: (elem: ShaderType, wrapperSize: number) => void,
): (t: ShaderType) => { size: number; align: number } | undefined {
  const memo = new Map<string, { size: number; align: number } | undefined>();
  const layout = (
    t: ShaderType,
    seen: ReadonlySet<string>,
  ): { size: number; align: number } | undefined => {
    switch (t.kind) {
      case 'scalar':
      case 'f64':
      case 'vec':
      case 'mat':
      case 'atomic':
        return typeLayout(t, 'std430', new Map());
      case 'struct': {
        if (seen.has(t.name)) return undefined;
        if (memo.has(t.name)) return memo.get(t.name);
        const decl = structs.get(t.name);
        if (decl === undefined) return undefined;
        const next = new Set(seen).add(t.name);
        let cursor = 0;
        let align = 1;
        let ok = true;
        for (const f of decl.fields) {
          const fl = layout(f.type, next);
          if (fl === undefined) {
            ok = false;
            break;
          }
          const size = f.size ?? fl.size;
          const fieldAlign = f.align ?? fl.align;
          cursor = roundUp(cursor, fieldAlign) + size;
          if (fieldAlign > align) align = fieldAlign;
        }
        const out = ok ? { size: roundUp(cursor, align), align } : undefined;
        memo.set(t.name, out);
        return out;
      }
      case 'array': {
        if (t.size === undefined) return undefined;
        const el = layout(t.elem, seen);
        if (el === undefined) return undefined;
        const natural = roundUp(el.size, el.align);
        const stride = roundUp(natural, UNIFORM_ARRAY_ALIGN);
        if (stride === natural) return { size: natural * t.size, align: UNIFORM_ARRAY_ALIGN };
        decide(t.elem, stride);
        return { size: stride * t.size, align: UNIFORM_ARRAY_ALIGN };
      }
      default:
        return undefined;
    }
  };
  return (t) => layout(t, new Set());
}

const wrapperName = (elem: ShaderType): string =>
  `_Pad16_${typeKey(elem).replace(/[^A-Za-z0-9]/g, '_')}`;

// Why: a texture or sampler binding carries `space: 'uniform'` too, because it has no address
// space of its own. Only the type check separates it from a buffer binding.
const isBufferBinding = (b: BindingDecl): boolean =>
  b.type.kind === 'struct' ||
  b.type.kind === 'array' ||
  b.type.kind === 'scalar' ||
  b.type.kind === 'vec' ||
  b.type.kind === 'mat';

function reachableStructs(
  t: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
  out: Set<string>,
): void {
  if (t.kind === 'array') return reachableStructs(t.elem, structs, out);
  if (t.kind !== 'struct' || out.has(t.name)) return;
  out.add(t.name);
  for (const f of structs.get(t.name)?.fields ?? []) reachableStructs(f.type, structs, out);
}

export function padUniformArrays(m: ModuleDecl): ModuleDecl {
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const inUniform = new Set<string>();
  const inStorage = new Set<string>();
  for (const b of m.bindings) {
    if (!isBufferBinding(b)) continue;
    reachableStructs(b.type, structs, b.space === 'storage' ? inStorage : inUniform);
  }
  const bareUniformArrays = m.bindings.filter(
    (b) => b.space !== 'storage' && isBufferBinding(b) && b.type.kind === 'array',
  );
  if (inUniform.size === 0 && bareUniformArrays.length === 0) return m;

  const padded = new Map<string, Extract<ShaderType, { kind: 'array' }>>();
  const wrappers = new Map<string, StructDecl>();
  const wrapperSizes = new Map<string, number>();
  const layoutOf = makeLayout(structs, (elem, size) => {
    wrapperSizes.set(typeKey(elem), size);
  });
  const elemLayoutOf = makeLayout(structs, () => undefined);
  for (const b of bareUniformArrays) {
    if (b.type.kind !== 'array' || b.type.size === undefined) continue;
    wrapperSizes.delete(typeKey(b.type.elem));
    layoutOf(b.type);
    if (wrapperSizes.get(typeKey(b.type.elem)) === undefined) continue;
    throw new UnsupportedFeatureError(
      `wgsl: uniform '${b.name}' is a ${typeKey(b.type)}. WGSL aligns every array element in ` +
        `a uniform to 16 bytes, and a bare list has no member to carry that. Wrap it in a ` +
        `struct — interface ${b.name}Data { items: ${typeKey(b.type)} } — or use a list of ` +
        `vec4.`,
    );
  }
  wrapperSizes.clear();

  const nextStructs = m.structs.map((s) => {
    if (!inUniform.has(s.name)) return s;
    let changed = false;
    const fields = s.fields.map((f) => {
      if (f.type.kind === 'struct') {
        const el = elemLayoutOf(f.type);
        if (el === undefined) return f;
        const align = el.align < UNIFORM_ARRAY_ALIGN ? UNIFORM_ARRAY_ALIGN : undefined;
        const size =
          el.size % UNIFORM_ARRAY_ALIGN !== 0 ? roundUp(el.size, UNIFORM_ARRAY_ALIGN) : undefined;
        if ((align === undefined || f.align === align) && (size === undefined || f.size === size))
          return f;
        if (inStorage.has(s.name)) {
          throw new UnsupportedFeatureError(
            `wgsl: struct '${s.name}' is bound as a uniform AND as storage, and its field ` +
              `'${f.name}' is a struct ${f.type.name}, which the two address spaces lay out ` +
              `differently (a uniform aligns a struct member to 16 bytes, storage does not). ` +
              `Declare one struct per address space.`,
          );
        }
        changed = true;
        return {
          ...f,
          ...(align !== undefined ? { align } : {}),
          ...(size !== undefined ? { size } : {}),
        };
      }
      if (f.type.kind !== 'array' || f.type.size === undefined) return f;
      const arrayElem = f.type.elem;
      if (arrayElem.kind === 'array') {
        throw new UnsupportedFeatureError(
          `wgsl: '${s.name}.${f.name}' is a ${typeKey(f.type)} in a uniform. WGSL aligns every ` +
            `array element to 16 bytes, and a list of lists would need that at both levels. ` +
            `Use a list of a struct, or of a vec4.`,
        );
      }
      wrapperSizes.delete(typeKey(arrayElem));
      layoutOf(f.type);
      const size = wrapperSizes.get(typeKey(arrayElem));
      if (size === undefined) {
        const el = elemLayoutOf(arrayElem);
        const needsAlign = el !== undefined && el.align < UNIFORM_ARRAY_ALIGN;
        if (!needsAlign || f.align === UNIFORM_ARRAY_ALIGN) return f;
        changed = true;
        return { ...f, align: UNIFORM_ARRAY_ALIGN };
      }
      if (inStorage.has(s.name)) {
        throw new UnsupportedFeatureError(
          `wgsl: struct '${s.name}' is bound as a uniform AND as storage, and its field ` +
            `'${f.name}' is a ${typeKey(f.type)}, which the two address spaces lay out ` +
            `differently (a uniform rounds the element stride to 16 bytes, storage does not). ` +
            `Declare one struct per address space.`,
        );
      }
      const name = wrapperName(arrayElem);
      if (structs.has(name)) {
        throw new UnsupportedFeatureError(
          `wgsl: this module declares a struct named '${name}', which is the name the uniform ` +
            `layout pass generates for the padded element of '${s.name}.${f.name}' (§51). ` +
            `Rename it; names beginning with '_Pad16_' are reserved for that padding.`,
        );
      }
      if (!wrappers.has(name)) {
        wrappers.set(name, { name, fields: [{ name: WRAPPED_FIELD, type: arrayElem, size }] });
      }
      changed = true;
      padded.set(`${s.name}.${f.name}`, f.type);
      return {
        ...f,
        align: UNIFORM_ARRAY_ALIGN,
        type: arrayT(structT(name), f.type.size),
      };
    });
    return changed ? { ...s, fields } : s;
  });
  if (wrappers.size === 0) {
    return nextStructs.every((s, i) => s === m.structs[i]) ? m : { ...m, structs: nextStructs };
  }

  const paddedMember = (e: Expr): Extract<ShaderType, { kind: 'array' }> | undefined => {
    if (e.op !== 'member' || e.base.type.kind !== 'struct') return undefined;
    return padded.get(`${e.base.type.name}.${e.field}`);
  };

  const wrapperTypeOf = (arr: Extract<ShaderType, { kind: 'array' }>): ShaderType => ({
    kind: 'struct',
    name: wrapperName(arr.elem),
  });

  const retypedMember = (e: Expr, arr: Extract<ShaderType, { kind: 'array' }>): Expr => ({
    ...e,
    ...(e.op === 'member' ? { base: rewrite(e.base) } : {}),
    type: { kind: 'array', elem: wrapperTypeOf(arr), size: arr.size },
  });

  const rewrite = (e: Expr): Expr => {
    if (e.op === 'index') {
      const arr = paddedMember(e.base);
      if (arr !== undefined) {
        return {
          op: 'member',
          type: arr.elem,
          field: WRAPPED_FIELD,
          base: {
            ...e,
            type: wrapperTypeOf(arr),
            base: retypedMember(e.base, arr),
            idx: rewrite(e.idx),
          },
        };
      }
    }
    const arr = paddedMember(e);
    if (arr !== undefined && arr.size !== undefined) {
      const base = retypedMember(e, arr);
      return {
        op: 'construct',
        type: arr,
        args: Array.from({ length: arr.size }, (_, i) => ({
          op: 'member' as const,
          type: arr.elem,
          field: WRAPPED_FIELD,
          base: {
            op: 'index' as const,
            type: wrapperTypeOf(arr),
            base,
            idx: {
              op: 'lit' as const,
              type: { kind: 'scalar' as const, scalar: 'i32' as const },
              value: i,
            },
          },
        })),
      };
    }
    if (e.op === 'construct' && e.type.kind === 'struct') {
      const structName = e.type.name;
      const decl = structs.get(structName);
      if (decl !== undefined && inUniform.has(structName)) {
        const args = e.args.map((a, i) => {
          const field = decl.fields[i];
          const fieldArr = field && padded.get(`${structName}.${field.name}`);
          if (fieldArr === undefined || fieldArr.size === undefined) return rewrite(a);
          const inner = rewrite(a);
          const wrapperT = wrapperTypeOf(fieldArr);
          return {
            op: 'construct' as const,
            type: { kind: 'array' as const, elem: wrapperT, size: fieldArr.size },
            args: Array.from({ length: fieldArr.size }, (_, j) => ({
              op: 'construct' as const,
              type: wrapperT,
              args: [
                {
                  op: 'index' as const,
                  type: fieldArr.elem,
                  base: inner,
                  idx: {
                    op: 'lit' as const,
                    type: { kind: 'scalar' as const, scalar: 'i32' as const },
                    value: j,
                  },
                },
              ],
            })),
          };
        });
        return { ...e, args };
      }
    }
    return mapChildren(e, rewrite);
  };

  for (const f of m.funcs) refuseWholeArrayWrites(f.body, paddedMember);

  return {
    ...m,
    structs: orderWrappers(wrappers, nextStructs),
    funcs: m.funcs.map((f) => ({ ...f, body: f.body.map((s) => mapStmtExpr(s, rewrite)) })),
  };
}

function orderWrappers(
  wrappers: ReadonlyMap<string, StructDecl>,
  structs: readonly StructDecl[],
): StructDecl[] {
  const leading: StructDecl[] = [];
  const after = new Map<string, StructDecl[]>();
  for (const w of wrappers.values()) {
    const elem = w.fields[0]?.type;
    if (elem?.kind !== 'struct') {
      leading.push(w);
      continue;
    }
    const list = after.get(elem.name) ?? [];
    list.push(w);
    after.set(elem.name, list);
  }
  const out: StructDecl[] = [...leading];
  const placed = new Set<StructDecl>();
  for (const s of structs) {
    out.push(s);
    for (const w of after.get(s.name) ?? []) {
      out.push(w);
      placed.add(w);
    }
  }
  // Why: an unplaced wrapper cannot arise, because its element came from a field of one of
  // these structs. Dropping it would emit a module that names a type nothing declares, so it
  // leads instead.
  for (const list of after.values()) {
    for (const w of list) if (!placed.has(w)) out.unshift(w);
  }
  return out;
}

function refuseWholeArrayWrites(
  body: readonly Stmt[],
  paddedMember: (e: Expr) => Extract<ShaderType, { kind: 'array' }> | undefined,
): void {
  for (const s of body) {
    if ((s.s === 'assign' || s.s === 'assignOp') && paddedMember(s.target) !== undefined) {
      throw new UnsupportedFeatureError(
        `wgsl: '${s.target.op === 'member' ? s.target.field : '?'}' is a uniform-padded list ` +
          `(§51) and cannot be assigned whole. Write its elements one at a time.`,
      );
    }
    eachStmtExpr(
      s,
      () => undefined,
      (b) => refuseWholeArrayWrites([b], paddedMember),
    );
  }
}
