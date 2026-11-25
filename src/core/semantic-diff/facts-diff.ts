import type { ModuleDecl } from '../ir/nodes.js';
import type { SemanticDiff } from './result.js';
import { EMPTY_CANON, buildCanon } from './canon.js';
import { controlFlowFacts } from './skeleton.js';
import { interfaceFacts, resourceFacts } from './reflection-facts.js';
import { constantFacts } from './constant-facts.js';

function diffFacts(a: readonly string[], b: readonly string[], ignoreOrder: boolean): string[] {
  const key = (xs: readonly string[]): string[] =>
    ignoreOrder ? [...xs].sort() : xs.map((x, i) => `@${i} ${x}`);
  const left = key(a);
  const right = key(b);
  const counts = new Map<string, number>();
  for (const x of left) counts.set(x, (counts.get(x) ?? 0) + 1);
  for (const x of right) counts.set(x, (counts.get(x) ?? 0) - 1);
  const out: string[] = [];
  for (const [line, n] of counts) {
    for (let i = 0; i < n; i++) out.push(`-${line}`);
    for (let i = 0; i < -n; i++) out.push(`+${line}`);
  }
  return out.sort();
}

interface ModuleFacts {
  readonly interface: readonly string[];
  readonly resources: readonly string[];
  readonly constants: readonly string[];
  readonly controlFlow: readonly string[];
}

export const BUCKETS = ['interface', 'resources', 'constants', 'controlFlow'] as const;

export function moduleFacts(m: ModuleDecl, canonNames: boolean): ModuleFacts {
  const c = canonNames ? buildCanon(m) : EMPTY_CANON;
  return {
    interface: interfaceFacts(m, c),
    resources: resourceFacts(m, c),
    constants: constantFacts(m, c),
    controlFlow: controlFlowFacts(m, c),
  };
}

export const diffAllFacts = (fa: ModuleFacts, fb: ModuleFacts, order: boolean): SemanticDiff => ({
  interface: diffFacts(fa.interface, fb.interface, order),
  resources: diffFacts(fa.resources, fb.resources, order),
  constants: diffFacts(fa.constants, fb.constants, order),
  controlFlow: diffFacts(fa.controlFlow, fb.controlFlow, order),
});

export function resolvedLines(prev: readonly string[], next: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const l of prev) counts.set(l, (counts.get(l) ?? 0) + 1);
  for (const l of next) {
    const n = counts.get(l);
    if (n !== undefined) counts.set(l, n - 1);
  }
  const out: string[] = [];
  for (const [line, n] of counts) for (let i = 0; i < n; i++) out.push(line);
  return out;
}
