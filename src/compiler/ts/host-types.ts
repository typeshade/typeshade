// Convert shader types into host value layouts, shared by analysis and declaration generation.
import type { HostType } from '../../core/host-values.js';
import type { StructDecl } from '../../core/ir/nodes.js';
import type { ShaderType } from '../../core/ir/types.js';
import { authorTypeText } from './context.js';
import { keyTypeText, keysOf, recordKeyText, recordOf } from './key-types.js';
import { optionalInner } from './optional.js';

// ─── reasons (Rule 8.20) ─────────────────────────────────────────────────────────────────────

const GPU_HALF = 'an entry takes it as a binding instead (Rule 8.24)';

const ITEM_15 = 'roadmap item 15 adds it';

// ─── host types (Rule 8.21) ────────────────────────────────────────────────────────────────────

/** The host type of `t`, or why it has none. */
export function hostTypeOf(
  t: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
): HostType | { readonly none: string } {
  switch (t.kind) {
    case 'scalar': {
      if (t.scalar === 'bool') return { k: 'bool', s: 'bool' };
      // A key type is its members on the host (change 0081, Rule 8.21).
      const keys = keysOf(t);
      if (keys !== undefined) return { k: 'key', m: keys, s: keyTypeText(keys) };
      return { k: 'num', t: t.scalar, s: t.scalar };
    }
    case 'f64':
      return { k: 'num', t: 'f64', s: 'f64' };
    case 'vec': {
      const suffix = { f32: '', i32: 'i', u32: 'u', bool: 'b' }[t.elem];
      return { k: 'vec', n: t.n, e: t.elem, s: `vec${t.n}${suffix}` };
    }
    case 'vec64':
      return { k: 'vec', n: t.n, e: 'f64', s: `vec${t.n}f64` };
    case 'mat':
      return {
        k: 'mat',
        c: t.cols,
        r: t.rows,
        e: t.elem,
        s: t.elem === 'f64' ? `mat${t.cols}x${t.rows}<f64>` : `mat${t.cols}x${t.rows}`,
      };
    case 'array': {
      if (t.size === undefined)
        return { none: `a runtime-sized array has no host value yet; ${ITEM_15}` };
      const e = hostTypeOf(t.elem, structs);
      if ('none' in e) return e;
      // A Record is an object of its keys on the host (change 0081, Rule 8.21).
      const rec = recordOf(t);
      if (rec !== undefined)
        return { k: 'rec', m: rec.keys, e, s: `Record<${recordKeyText(rec)}, ${e.s}>` };
      return { k: 'arr', n: t.size, e, s: `array<${e.s}, ${t.size}>` };
    }
    case 'struct': {
      // An optional value has no host value in this change (Rule 8.21, change 0088, D4).
      if (optionalInner(t) !== undefined)
        return {
          none: `an optional value, ${authorTypeText(t)}, has no host value yet (Rule 8.21)`,
        };
      const decl = structs.get(t.name);
      if (decl === undefined) return { none: `struct ${t.name} is not declared` };
      const f: (readonly [string, HostType])[] = [];
      for (const field of decl.fields) {
        const ft = hostTypeOf(field.type, structs);
        if ('none' in ft) return { none: `field ${t.name}.${field.name}: ${ft.none}` };
        f.push([field.name, ft]);
      }
      return { k: 'struct', f, s: t.name };
    }
    case 'void':
      return { k: 'void', s: 'void' };
    default:
      return { none: `a ${authorTypeText(t)} has no host value; ${GPU_HALF}` };
  }
}
