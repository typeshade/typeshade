import {
  glslOnly,
  ioField,
  resourceKind,
  bindingsIncludingInjected,
  sampleTypeOf,
} from './reflect/bindings.js';
// Implements: Rule 4.8, Rule 6.8, Rule 11.10 (docs/language-design.md; traced in reqs/).

import { withoutKernels } from './ir/kernels.js';
import { emittedName, inheritSpellings, spellingsOf } from './spelling-plan.js';
import {
  type ModuleDecl,
  storageTextureLayoutAccess,
  typeKey,
  stageOf,
  workgroupShapeOf,
  type WorkgroupShape,
} from './ir/index.js';
import { entryIo } from './ir/entry-io.js';
import { vertexLayoutOfEntry } from './vertex-layout.js';
import { requiredCaps, requiredLanguageFeatures } from './passes/required-caps.js';
import { bindingStages } from './passes/stage-bindings.js';
import { sampledTextures } from './passes/texture-pairs.js';
import { consoleBuffer } from './passes/console-buffer.js';
import { glslDataTextureOf } from './glsl-data-texture.js';
import { structLayout, type StructLayout } from './reflect/layout.js';
import type { BindEntry, BindGroup } from './reflect/bind-entry.js';
import type { VertexAttr, VertexLayout, EntryInfo, OverrideInfo } from './reflect/entry-types.js';
import type { Reflection, ReflectOptions } from './reflect/reflection.js';
export type { Reflection, ReflectOptions } from './reflect/reflection.js';
export type {
  VertexAttr,
  VertexLayout,
  EntryIoField,
  EntryIo,
  EntryInfo,
  OverrideInfo,
  ExternRequirement,
} from './reflect/entry-types.js';
export type { ResourceKind, BindEntry, BindGroup } from './reflect/bind-entry.js';
export { typeLayout, wgslLayout } from './reflect/layout.js';
export type { LayoutKind, FieldLayout, StructLayout } from './reflect/layout.js';

/** Recover a module's pipeline metadata from its IR. It is what a host reads to build bind
 *  groups, write uniform buffers, describe vertex state and check device features, without
 *  parsing a line of emitted source.
 *
 *  The result carries:
 *
 *  - `bindGroups`: every declared binding, sorted by group then binding, each with its name,
 *    address space, access mode, resource kind, owner, and the stages that reference it. It
 *    also includes the bindings the f64 emulation adds on the author's behalf, the `_fp64`
 *    guard texture among them (see {@link ReflectOptions}), because a host builds its bind
 *    group from this list and a binding missing here is a binding never bound.
 *  - `uniforms` and `storage`: std140 and std430 struct layouts, per field offset, align and
 *    size plus the struct's own size and alignment. This is where a byte offset comes from,
 *    so nothing counts them by hand.
 *  - `vertex`: the vertex entry's `@location` attributes with their offsets and the array
 *    stride. Attributes are tightly packed in declaration order, with no padding between
 *    them. The stride is the sum of their format sizes, as in `packModule()` and the manifest.
 *  - `entries`: one signature per entry point, with its stage, its workgroup size for a
 *    compute entry, its input and output types, its structured location and builtin interface,
 *    and `portable` when the kernel declares that tier.
 *  - `requiredFeatures`: every capability the emit needs, sorted and deduplicated. It covers
 *    the capabilities derived from the module's shape (a storage binding, a compute entry, a
 *    multisampled texture load), the capabilities the module declared in `enables`, and the
 *    closure over implication, so a module declaring `float32Blend` also reports `floatRenderTarget`,
 *    since blending into a float target needs that target to be colour-renderable first. The
 *    ids are neutral, so translate them through {@link hostFeaturesFor} for one target.
 *  - `overrides`: each specialization constant's name, type and default, the values a host
 *    pins through pipeline constants or a define header.
 *  - `requires`: the host-provided globals the module references and does not declare.
 *
 *  A texture binding reports three more fields a host needs to create a matching view and
 *  layout. `textureDim` is `'2d'`, `'2d-ms'`, `'2d-array'`, `'cube'`, `'3d'`, `'1d'` or
 *  `'cube-array'`, and `textureElem` is the texel element, `f32`, `u32` or `i32`. Both axes are
 *  needed: WebGPU's `sampleType` must be `'uint'` or `'sint'` for an integer texture, and WebGL2
 *  must back one with an integer internal format. Getting that pairing wrong raises nothing on
 *  WebGL2, since a texture whose format disagrees with its sampler type is merely incomplete and
 *  reads zero. `sampleType` is the layout's own word for it, `'depth'`, `'uint'`, `'sint'`,
 *  `'float'` or `'unfilterable-float'`: an `f32` texture is `'float'` when a call of an entry
 *  pairs it with a `sampler`, and `'unfilterable-float'` when the entries only load, measure or
 *  count it, which a 32-bit float format needs.
 *
 *  Reflection is read-only over the IR and never runs on the emit path. It takes a module and
 *  never a backend, which is why every id it reports is target-neutral.
 *
 *  {@link wgslLayout} is the same offset engine on its own, for a single struct with no module
 *  around it.
 *
 *  Exported from `typeshade`.
 *
 *  @param m - the module to describe.
 *  @param opts - the emit facts that change what a host must bind, the fp64 flavour among
 *    them. Pass the same values the emit will get; a default here that disagrees with the
 *    emit describes a different program.
 *  @returns the target-neutral pipeline metadata described above.
 *
 *  @example
 *  ```ts
 *  import { reflect, hostFeaturesFor, wgslBackend } from 'typeshade'
 *
 *  const r = reflect(MODULE)
 *  const device = await adapter.requestDevice({
 *    requiredFeatures: hostFeaturesFor(wgslBackend, r.requiredFeatures),
 *  })
 *  r.uniforms[0].fields // [{ name: 'mvp', offset: 0, size: 64, align: 16 }, …]
 *  ```
 *
 *  @see {@link wgslLayout} for the offset engine alone.
 *  @see {@link hostFeaturesFor} for turning `requiredFeatures` into one target's strings.
 */
export function reflect(m: ModuleDecl, opts?: ReflectOptions): Reflection {
  m = inheritSpellings(withoutKernels(m), m);
  const plan = spellingsOf(m);
  if (opts?.console === 'gpu')
    return reflect(inheritSpellings(consoleBuffer(m).module, m), { ...opts, console: 'cpu' });
  const structs = new Map(m.structs.map((s) => [s.name, s]));
  const { bindings: allBindings, lowered } = bindingsIncludingInjected(m, opts?.fp64Flavor);
  const stages = bindingStages(lowered);
  const sampled = sampledTextures(lowered);
  const byGroup = new Map<number, BindEntry[]>();
  for (const b of allBindings) {
    const e: BindEntry = {
      group: b.group,
      binding: b.binding,
      name: b.name,
      emitted: emittedName(plan.wgsl.bindings, b.name),
      ...glslOnly(b.name, plan.wgsl.bindings, plan.glsl.bindings),
      space: b.space,
      ...(b.access ? { access: b.access } : {}),
      resourceKind: resourceKind(b.space, b.type),
      owner: b.owner ?? 'module',
      ...(b.type.kind === 'struct' && b.owner === 'host'
        ? { glslSpelling: b.glsl ?? 'std140-block' }
        : {}),
      ...(b.type.kind === 'struct' ? { structName: b.type.name } : {}),
      ...(b.type.kind === 'struct'
        ? { structEmitted: emittedName(plan.wgsl.structs, b.type.name) }
        : {}),
      ...(b.type.kind === 'texture'
        ? {
            textureDim: b.type.dim,
            textureElem: b.type.elem,
            sampleType: sampleTypeOf(b.type, sampled === undefined || sampled.has(b.name)),
          }
        : {}),
      ...(b.type.kind === 'depth-texture'
        ? { textureDim: b.type.dim, textureDepth: true, sampleType: 'depth' as const }
        : {}),
      ...(b.type.kind === 'sampler-comparison' ? { samplerComparison: true } : {}),
      ...(b.type.kind === 'storage-texture'
        ? {
            textureDim: b.type.dim,
            storageFormat: b.type.format,
            storageAccess: storageTextureLayoutAccess(b.type.access),
          }
        : {}),
      ...(b.space === 'storage' && glslDataTextureOf(b.type, structs) !== undefined
        ? { glslDataTexture: glslDataTextureOf(b.type, structs)! }
        : {}),
      stages: stages.get(b.name) ?? [],
    };
    (byGroup.get(b.group) ?? byGroup.set(b.group, []).get(b.group)!).push(e);
  }
  const bindGroups: BindGroup[] = [...byGroup.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([group, entries]) => ({ group, entries: entries.sort((a, b) => a.binding - b.binding) }));

  const uniforms: StructLayout[] = [];
  const storage: StructLayout[] = [];
  for (const b of allBindings) {
    if (b.type.kind !== 'struct') continue;
    const s = structs.get(b.type.name);
    if (!s) continue;
    if (b.space === 'uniform') uniforms.push(structLayout(s, 'std140', structs, plan.wgsl));
    else storage.push(structLayout(s, 'std430', structs, plan.wgsl));
  }

  const entries: EntryInfo[] = [];
  let vertex: VertexLayout | undefined;
  for (const f of m.funcs) {
    const stage = stageOf(f);
    if (!stage) continue;
    const io = entryIo(f, structs);
    const shape: WorkgroupShape | undefined =
      stage === 'compute' ? (workgroupShapeOf(f) ?? [64, 1, 1]) : undefined;
    entries.push({
      name: f.name,
      emitted: emittedName(plan.wgsl.entries, f.name),
      stage,
      ...(shape !== undefined ? { workgroupSize: shape[0], workgroupShape: shape } : {}),
      ...(f.workgroupSizeOverrides !== undefined
        ? { workgroupSizeOverrides: f.workgroupSizeOverrides }
        : {}),
      inputs: f.params.map((p) => typeKey(p.type)),
      output: typeKey(f.ret),
      ...(f.portable === true ? { portable: true as const } : {}),
      io: {
        inputs: io.inputs.map(ioField(plan.wgsl.members)),
        outputs: io.outputs.map(ioField(plan.wgsl.members)),
      },
    });
    if (stage === 'vertex' && !vertex) {
      const layout = vertexLayoutOfEntry(f, m.structs);
      if (layout !== undefined)
        vertex = {
          attributes: layout.attributes.map((a): VertexAttr => ({
            name: a.name,
            emitted: emittedName(plan.wgsl.members, a.name),
            location: a.location,
            type: a.type,
            offset: a.offset,
          })),
          arrayStride: layout.arrayStride,
        };
    }
  }

  const overrides: OverrideInfo[] = (m.overrides ?? []).map((o) => ({
    name: o.name,
    emitted: emittedName(plan.wgsl.overrides, o.name),
    ...glslOnly(o.name, plan.wgsl.overrides, plan.glsl.overrides),
    type: typeKey(o.type),
    default: o.default,
  }));

  const requiredFeatures = requiredCaps(m).sort();

  return {
    bindGroups,
    uniforms,
    storage,
    ...(vertex ? { vertex } : {}),
    entries,
    overrides,
    requiredFeatures,
    requiredLanguageFeatures: requiredLanguageFeatures(m),
    requires: (m.externs ?? []).map((e) => ({
      name: e.name,
      type: typeKey(e.type),
      wgsl: e.spelling?.wgsl ?? e.name,
      glsl: e.spelling?.glsl ?? e.name,
      ...(e.stage ? { stage: e.stage } : {}),
    })),
  };
}
