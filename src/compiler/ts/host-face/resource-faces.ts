import type { BindingDecl } from '../../../core/ir/nodes.js';
import type { ClassExport, FaceExport } from '../host-face-contracts.js';
import { REASON } from '../host-face-shared.js';
import { hostResourceOf, type ResourceClassFacts } from '../host-resource.js';
import { never } from './never-export.js';
import type { BindingRef } from './binding-ref.js';

export function resourceFaces(
  faces: readonly (FaceExport | BindingRef)[],
  bindings: readonly BindingDecl[],
): FaceExport[] {
  const classes = faces.filter((e): e is ClassExport => e.kind === 'class');
  const classOf = (name: string, layout: 'u' | 's'): ResourceClassFacts | undefined => {
    const cls = classes.find((e) => e.type.s === name);
    if (cls === undefined) return undefined;
    const why = layout === 'u' ? cls.layouts.un : cls.layouts.sn;
    return {
      name: cls.name,
      abstract: cls.abstract,
      ...(why !== undefined ? { layoutProblem: why } : {}),
    };
  };
  return faces.map((e): FaceExport => {
    if (e.kind !== 'binding') return e;
    const b = bindings.find((x) => x.name === e.binding);
    if (b === undefined || b.type === undefined) return never(e.name, REASON.bindingExport);
    const r = hostResourceOf(b, classOf);
    if (r.kind === 'other') return never(e.name, REASON.bindingExport);
    if (r.kind === 'none') return never(e.name, REASON.bindingNoResource(r.why));
    return r.length === undefined
      ? { kind: 'resource', name: e.name, cls: r.cls }
      : { kind: 'resource', name: e.name, cls: r.cls, length: r.length };
  });
}
