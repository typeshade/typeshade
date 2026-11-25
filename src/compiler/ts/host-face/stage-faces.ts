import type { ComputeEntry } from '../../../core/host-entry.js';
import type { FuncDecl } from '../../../core/ir/nodes.js';
import { workgroupShapeOf } from '../../../core/ir/nodes.js';
import { colourOf } from './entry-shapes.js';
import { glDrawOf } from '../../../core/manifest.js';
import { typeLayout } from '../../../core/reflect.js';
import type { HostExport } from '../host-face-contracts.js';
import { REASON } from '../host-face-shared.js';
import { isBufferBinding, objectType } from '../host-view.js';
import type { FaceCtx } from './context.js';
import { barrierIn } from './reach.js';
import { guardBinding } from './guard.js';
import { noCpuTier, wgslEntryPoint, glTier } from './entry-tier.js';
import { never } from './never-export.js';
import { COMPUTE_BUILTINS, FRAGMENT_BUILTINS } from './entry-vocabulary.js';
import { entryBindings } from './entry-bindings.js';

export function computeFace(name: string, f: FuncDecl, c: FaceCtx): HostExport {
  const x = c.entry;
  for (const p of f.params)
    if (p.builtin === undefined || !COMPUTE_BUILTINS.has(p.builtin))
      return never(name, `parameter "${p.name}" is not a builtin the call can fill in`);
  const reached = entryBindings(f, c);
  if ('none' in reached) return never(name, reached.none);
  const { bindings, types, queued, waiting, closure } = reached;
  if (x.guard !== undefined) bindings.push(guardBinding(x.guard));
  const barrier = barrierIn(closure, c.byName, x.declared);
  const noCpu = noCpuTier(closure, bindings, c);
  const gl = glTier(f, c);
  const touched = new Set([...(x.reads.get(f.name) ?? []), ...(x.writes.get(f.name) ?? [])]);
  const workgroupVars = (x.module.vars ?? []).filter(
    (v) => v.space === 'workgroup' && touched.has(v.name),
  );
  return {
    kind: 'compute',
    name,
    entry: {
      name,
      fn: f.name,
      ...wgslEntryPoint(f, c),
      wg: workgroupShapeOf(f) ?? [64, 1, 1],
      ...(f.workgroupSizeOverrides === undefined
        ? {}
        : {
            workgroupSizeOverrides: f.workgroupSizeOverrides.map((n) => n ?? null) as [
              string | null,
              string | null,
              string | null,
            ],
          }),
      ...(workgroupVars.length === 0
        ? {}
        : {
            workgroupVars: workgroupVars.map((v) => ({
              name: v.name,
              size: typeLayout(v.type, 'std430', c.structs).size,
              ...(v.type.kind === 'array' && v.type.sizeOverride !== undefined
                ? { override: v.type.sizeOverride }
                : {}),
            })),
          }),
      params: f.params.map((p) => p.builtin!),
      bindings,
      workgroupZero: Object.fromEntries(
        workgroupVars.map((v) => [v.name, x.workgroupZero[v.name]]),
      ) as ComputeEntry['workgroupZero'],
      ...(barrier !== undefined ? { barrier } : {}),
      ...(noCpu !== undefined ? { noCpu } : {}),
      ...gl,
    },
    bindingsType: objectType(types),
    ...(bindings.some((b) => isBufferBinding(b) && b.writes) &&
    bindings.every(
      (b) => !isBufferBinding(b) || !b.writes || (b.layout.k === 'a' && b.layout.n === null),
    )
      ? { queuedType: objectType(queued), waitingType: objectType(waiting) }
      : {}),
  };
}

export function fragmentFace(name: string, f: FuncDecl, c: FaceCtx): HostExport {
  const x = c.entry;
  for (const p of f.params)
    if (p.builtin === undefined || !FRAGMENT_BUILTINS.has(p.builtin))
      return never(name, REASON.fragmentInput(p.name));
  const out = colourOf(f, c.structs);
  if (out === undefined) return never(name, REASON.fragmentOutput);
  const reached = entryBindings(f, c);
  if ('none' in reached) return never(name, reached.none);
  const { bindings, draw: drawTypes, closure } = reached;
  if (x.guard !== undefined) bindings.push(guardBinding(x.guard));
  const draw = glDrawOf(x.module, f, bindings, closure, c.byName, x.declared);
  const gl =
    'none' in draw ? draw : { frag: draw.fragment, blocks: draw.blocks, samplers: draw.samplers };
  const noCpu = noCpuTier(closure, bindings, c);
  return {
    kind: 'fragment',
    name,
    entry: {
      name,
      fn: f.name,
      ...wgslEntryPoint(f, c),
      params: f.params.map((p) => p.builtin!),
      out,
      bindings,
      ...('none' in gl ? { noGl: gl.none } : { gl }),
      ...(noCpu !== undefined ? { noCpu } : {}),
      ...gl,
    },
    bindingsType: objectType(drawTypes),
  };
}
