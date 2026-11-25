import type { DrawBinding } from '../../../core/host-entry.js';
import type { BindingDecl, FuncDecl } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { layoutOf } from '../../../core/manifest.js';
import { closureOf } from '../../../core/manifest/reach.js';
import { emittedName, spellingsOf } from '../../../core/spelling-plan.js';
import { authorTypeText } from '../context.js';
import type { HostExport } from '../host-face-contracts.js';
import { bindingsTypes, objectType, type Naming } from '../host-view.js';
import type { FaceCtx } from './context.js';
import { spell } from './spell.js';

export function entryBindings(
  f: FuncDecl,
  c: FaceCtx,
):
  | {
      bindings: DrawBinding[];
      types: string[];
      draw: string[];
      queued: string[];
      waiting: string[];
      closure: ReadonlySet<string>;
    }
  | { none: string } {
  const x = c.entry;
  const closure = closureOf(f.name, x.callees);
  const { touched, written } = x.reach(f.name);
  const bindings: DrawBinding[] = [];
  for (const b of x.bindings) {
    if (!touched.has(b.name)) continue;
    const at = {
      name: b.name,
      group: b.group,
      binding: b.binding,
      s: spell(b.type),
      glsl: emittedName(spellingsOf(x.module).glsl.bindings, b.name),
    };
    if (b.type.kind === 'texture' && b.type.dim === '2d' && b.type.elem === 'f32') {
      bindings.push({ ...at, space: 'texture' });
      continue;
    }
    if (b.type.kind === 'sampler') {
      bindings.push({ ...at, space: 'sampler' });
      continue;
    }
    const handle = ['texture', 'storage-texture', 'depth-texture', 'sampler-comparison'];
    const space = b.space === 'storage' ? 'storage' : 'uniform';
    if (handle.includes(b.type.kind))
      return {
        none: `binding "${b.name}" is a ${spell(b.type)}, which has no host value yet; #204, the rendering design, adds it`,
      };
    const layout = layoutOf(
      b.type,
      space === 'uniform' ? 'std140' : 'std430',
      c.structs,
      authorTypeText,
    );
    if ('none' in layout) return { none: `binding "${b.name}": ${layout.none}` };
    const writes = f.stage === 'compute' && space === 'storage' && written.has(b.name);
    const rw = space === 'storage' && b.access === 'read_write';
    bindings.push({ ...at, space, writes, ...(rw ? { rw: true as const } : {}), layout });
  }
  return { bindings, ...bindingsTypes(bindings, (n) => typeOfBinding(x.bindings, n)), closure };
}

export const typeOfBinding = (
  bindings: readonly BindingDecl[],
  name: string,
): ShaderType | undefined => bindings.find((b) => b.name === name)?.type;

export function namedBindings(
  e: HostExport & { kind: 'compute' | 'fragment' },
  typeOf: (name: string) => ShaderType | undefined,
  naming: Naming,
): HostExport {
  const { types, draw, queued, waiting } = bindingsTypes(e.entry.bindings, typeOf, naming);
  if (e.kind === 'fragment') return { ...e, bindingsType: objectType(draw) };
  return {
    ...e,
    bindingsType: objectType(types),
    ...(e.queuedType !== undefined
      ? { queuedType: objectType(queued), waitingType: objectType(waiting) }
      : {}),
  };
}
