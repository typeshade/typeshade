import type { ModuleDecl } from '../ir/nodes.js';
import { reflect } from '../reflect.js';
import { subStructs, type Canon } from './canon.js';

export function interfaceFacts(m: ModuleDecl, c: Canon): string[] {
  const r = reflect(m);
  const out: string[] = [];
  for (const e of r.entries) {
    const inputs = e.inputs.map((i) => subStructs(i, c)).join(',');
    const wg = e.workgroupShape?.join('x').replace(/(x1)+$/, '') ?? '-';
    const wgOverrides = e.workgroupSizeOverrides?.map((name) => name ?? '-').join(',');
    out.push(
      `entry ${e.name} stage=${e.stage} wg=${wg}${wgOverrides === undefined ? '' : `[${wgOverrides}]`} in=[${inputs}] out=${subStructs(e.output, c)}`,
    );
  }
  if (r.vertex) {
    out.push(`vertex stride=${r.vertex.arrayStride}`);
    for (const a of r.vertex.attributes)
      out.push(`vertex.attr ${a.name} loc=${a.location} ${subStructs(a.type, c)} off=${a.offset}`);
  }
  return out;
}

export function resourceFacts(m: ModuleDecl, c: Canon): string[] {
  const r = reflect(m);
  const out: string[] = [];
  for (const g of r.bindGroups)
    for (const e of g.entries)
      out.push(
        `bind ${e.group}:${e.binding} ${e.name} ${e.space}${e.access ? '/' + e.access : ''} ` +
          `${e.resourceKind} struct=${e.structName ?? '-'} dim=${e.textureDim ?? '-'} elem=${e.textureElem ?? '-'}`,
      );
  for (const [kind, layouts] of [
    ['std140', r.uniforms],
    ['std430', r.storage],
  ] as const)
    for (const l of layouts) {
      out.push(
        `layout ${kind} ${subStructs(`struct:${l.name}`, c)} size=${l.size} align=${l.align}`,
      );
      for (const f of l.fields)
        out.push(
          `field ${l.name}.${f.name} ${subStructs(f.type, c)} off=${f.offset} align=${f.align} size=${f.size}`,
        );
    }
  for (const cap of r.requiredFeatures) out.push(`cap ${cap}`);
  return out;
}
