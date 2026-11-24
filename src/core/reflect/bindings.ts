import { emittedName } from '../spelling-plan.js';
import {
  type ShaderType,
  type ModuleDecl,
  type AddressSpace,
  type BindingDecl,
  typeKey,
} from '../ir/index.js';
import type { IoField } from '../ir/entry-io.js';
import { fp64Lower, type Fp64Flavor } from '../passes/fp64-lower.js';
import type { ResourceKind } from './bind-entry.js';
import type { EntryIoField } from './entry-types.js';

export function glslOnly(
  name: string,
  wgsl: ReadonlyMap<string, string>,
  glsl: ReadonlyMap<string, string>,
): { emittedGlsl?: string } {
  const g = emittedName(glsl, name);
  return g === emittedName(wgsl, name) ? {} : { emittedGlsl: g };
}

export const ioField =
  (members: ReadonlyMap<string, string>) =>
  (f: IoField): EntryIoField => ({
    name: f.name,
    emitted: emittedName(members, f.name),
    type: typeKey(f.type),
    ...(f.location !== undefined ? { location: f.location } : {}),
    ...(f.builtin !== undefined ? { builtin: f.builtin } : {}),
  });

export const resourceKind = (space: AddressSpace, t: ShaderType): ResourceKind =>
  t.kind === 'texture' || t.kind === 'depth-texture'
    ? 'texture'
    : t.kind === 'storage-texture'
      ? 'storage-texture'
      : t.kind === 'sampler' || t.kind === 'sampler-comparison'
        ? 'sampler'
        : space === 'storage'
          ? 'storage-buffer'
          : 'uniform-buffer';

export function bindingsIncludingInjected(
  m: ModuleDecl,
  flavor: Fp64Flavor | undefined,
): { readonly bindings: readonly BindingDecl[]; readonly lowered: ModuleDecl } {
  const lowered = fp64Lower(m, flavor !== undefined ? { flavor } : undefined);
  if (lowered === m) return { bindings: m.bindings, lowered };
  const declared = new Set(m.bindings.map((b) => b.name));
  const injected = lowered.bindings.filter((b) => !declared.has(b.name));
  return {
    bindings: injected.length === 0 ? m.bindings : [...m.bindings, ...injected],
    lowered,
  };
}

export const sampleTypeOf = (
  t: Extract<ShaderType, { kind: 'texture' }>,
  paired: boolean,
): 'float' | 'unfilterable-float' | 'sint' | 'uint' =>
  t.elem === 'u32'
    ? 'uint'
    : t.elem === 'i32'
      ? 'sint'
      : paired && t.dim !== '2d-ms'
        ? 'float'
        : 'unfilterable-float';
