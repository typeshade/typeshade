import type { DeclaredSymbol } from '../../compiler/ts/symbols.js';
import type { ShaderType } from '../../core/ir/types.js';
import { wgslType } from '../../core/backends/wgsl.js';
import { optionalInner, optionalAbsence } from '../../compiler/ts/optional.js';
import {
  collectionKeyOf,
  keysOf,
  keyTypeText,
  recordOf,
  recordKeyText,
} from '../../compiler/ts/key-types.js';
import type { StructNames } from './types.js';

// Why: `wgslType` throws SD0040 on `f64`, `vecN<f64>` and `matNxN<f64>`, which are pre-lowering types.

export function spellShaderType(t: ShaderType, struct: StructNames = (name) => name): string {
  const spell = (inner: ShaderType): string => spellShaderType(inner, struct);
  const optional = optionalInner(t);
  if (optional !== undefined)
    return `${spell(optional)}${optionalAbsence(t)! & 2 ? ' | null' : ''}${optionalAbsence(t)! & 1 ? ' | undefined' : ''}`;
  const keys = keysOf(t);
  if (keys !== undefined) return keyTypeText(keys);
  const rec = recordOf(t);
  if (rec !== undefined && t.kind === 'array')
    return `Record<${recordKeyText(rec)}, ${spell(t.elem)}>`;
  if (t.kind === 'collection') {
    const members = keysOf(collectionKeyOf(t));
    const key = members === undefined ? t.key : keyTypeText(members);
    return t.value === undefined ? `Set<${key}>` : `Map<${key}, ${spell(t.value)}>`;
  }
  switch (t.kind) {
    case 'struct':
      return struct(t.name);
    case 'f64':
      return 'f64';
    case 'vec64':
      return `vec${t.n}<f64>`;
    case 'mat':
      return t.elem === 'f64' ? `mat${t.cols}x${t.rows}<f64>` : wgslType(t);
    case 'array':
      return t.size !== undefined
        ? `array<${spell(t.elem)}, ${t.size}>`
        : `array<${spell(t.elem)}>`;
    default:
      return wgslType(t);
  }
}

export const typesOf = (symbol: DeclaredSymbol): string =>
  [spellShaderType(symbol.type), ...(symbol.params ?? []).map((p) => spellShaderType(p.type))].join(
    '|',
  );

export function withDeclaredName(name: string, emitted: string, to: string): string {
  if (name === emitted) return to;
  return name.startsWith(`${emitted}_`) ? `${to}${name.slice(emitted.length)}` : name;
}
