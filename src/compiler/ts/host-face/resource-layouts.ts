import type { Layout } from '../../../core/host-entry.js';
import type { StructDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { layoutOf } from '../../../core/manifest.js';
import type { ClassLayouts } from '../../../runtime/resource.js';
import { authorTypeText } from '../context.js';

export function resourceLayouts(
  name: string,
  structs: ReadonlyMap<string, StructDecl>,
): ClassLayouts {
  const t: ShaderType = { kind: 'struct', name };
  const u = layoutOf(t, 'std140', structs, authorTypeText);
  const s = layoutOf({ kind: 'array', elem: t }, 'std430', structs, authorTypeText);
  return {
    ...('none' in u ? { un: u.none } : { u }),
    ...('none' in s ? { sn: s.none } : { s: s as Layout & { k: 'a' } }),
  };
}
