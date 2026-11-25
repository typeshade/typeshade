import { importEdges } from './imports.js';
import { LAYER_POLICY_PATH, parseLayerPolicy, type LayerPolicy } from './layer-policy.js';
import type { Finding, ShapeContext, Signal } from './types.js';

export function layerOf(rel: string): string | undefined {
  const parts = rel.split('/');
  return parts[0] === 'src' && parts.length > 2 ? parts[1] : undefined;
}

export function policyOf(ctx: ShapeContext): LayerPolicy | undefined {
  const source = ctx.all.find((sf) => ctx.rel(sf) === LAYER_POLICY_PATH);
  return source === undefined ? undefined : parseLayerPolicy(source);
}

export function layerSignal(policy: LayerPolicy | undefined): Signal {
  return (ctx) => {
    if (policy === undefined) return [];
    const findings: Finding[] = [];
    for (const source of ctx.analysed) {
      const fromRel = ctx.rel(source);
      const from = layerOf(fromRel);
      const allowed = from === undefined ? undefined : policy.mayImport[from];
      if (from === undefined || allowed === undefined) continue;
      const first = new Map<string, { line: number; typeOnly: boolean }>();
      for (const edge of importEdges(ctx.checker, source)) {
        const targetRel = ctx.rel(edge.target);
        const to = layerOf(targetRel);
        if (to === undefined || to === from || allowed.includes(to)) continue;
        const key = `${fromRel.slice(4)} -> ${targetRel.slice(4)}`;
        const seen = first.get(key);
        first.set(key, {
          line: seen === undefined ? edge.line : Math.min(seen.line, edge.line),
          typeOnly: (seen?.typeOnly ?? true) && edge.typeOnly,
        });
      }
      if (first.size === 0) continue;
      const keys = [...first.keys()];
      const newEdges = keys.filter((key) => !policy.known.includes(key));
      findings.push({
        signal: 'layer',
        file: fromRel,
        line: Math.min(...[...first.values()].map((entry) => entry.line)),
        kind: 'layer-break',
        evidence: {
          edges: keys.length,
          targets: keys.map((key) => key.split(' -> ')[1]!),
          knownEdges: keys.length - newEdges.length,
          newEdges: newEdges.length,
          newEdgeList: newEdges,
          typeOnlyEdges: [...first.values()].filter((entry) => entry.typeOnly).length,
          layer: from,
        },
        remedy: 'move the file',
      });
    }
    return findings;
  };
}

export const layer: Signal = (ctx) => layerSignal(policyOf(ctx))(ctx);

const sum = (findings: readonly Finding[], key: string): number =>
  findings.reduce((total, finding) => total + Number(finding.evidence[key] ?? 0), 0);

export function summariseLayer(ctx: ShapeContext, findings: readonly Finding[]): string[] {
  if (policyOf(ctx) === undefined)
    return [`The layer policy ${LAYER_POLICY_PATH} was not read: no layer finding.`];
  const edges = sum(findings, 'edges');
  const known = sum(findings, 'knownEdges');
  return [
    `${edges} edges against MAY_IMPORT, from ${findings.length} files.`,
    `${known} of them are in KNOWN, ${edges - known} are not.`,
    `${sum(findings, 'typeOnlyEdges')} of the edges are type-only imports.`,
  ];
}
