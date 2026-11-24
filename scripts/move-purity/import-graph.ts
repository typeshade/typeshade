import type { Links } from './module-links.js';
import type { Side } from './side-program.js';

export interface ImportGraph {
  componentSize(path: string): number;
  cycleThrough(path: string): string[] | undefined;
  orderFrom(root: string): string[];
  cycles(): string[][];
}

export function buildImportGraph(side: Side, links: Links): ImportGraph {
  const paths = [...side.texts.keys()].filter((p) => p.endsWith('.ts'));
  const edges = new Map<string, string[]>();
  for (const path of paths) {
    edges.set(
      path,
      links
        .of(path)
        .filter((link) => link.sideEffect || link.valueLoad)
        .map((link) => link.target)
        .filter((target) => side.texts.has(target)),
    );
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const component = new Map<string, number>();
  let counter = 0;
  let components = 0;
  const connect = (path: string): void => {
    index.set(path, counter);
    low.set(path, counter);
    counter += 1;
    stack.push(path);
    onStack.add(path);
    for (const next of edges.get(path) ?? []) {
      if (!index.has(next)) {
        connect(next);
        low.set(path, Math.min(low.get(path)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(path, Math.min(low.get(path)!, index.get(next)!));
      }
    }
    if (low.get(path) === index.get(path)) {
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.set(member, components);
      } while (member !== path);
      components += 1;
    }
  };
  for (const path of paths) if (!index.has(path)) connect(path);
  const orderFrom = (root: string): string[] => {
    const seen = new Set<string>();
    const order: string[] = [];
    const visit = (path: string): void => {
      seen.add(path);
      for (const next of edges.get(path) ?? []) if (!seen.has(next)) visit(next);
      order.push(path);
    };
    if (edges.has(root)) visit(root);
    return order;
  };
  const sizes = new Map<number, number>();
  for (const id of component.values()) sizes.set(id, (sizes.get(id) ?? 0) + 1);
  const componentSize = (path: string): number => sizes.get(component.get(path) ?? -1) ?? 0;
  const cycleThrough = (path: string): string[] | undefined => {
    if (componentSize(path) < 2) return undefined;
    const id = component.get(path);
    const parent = new Map<string, string>();
    const queue = [path];
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head]!;
      for (const next of edges.get(current) ?? []) {
        if (component.get(next) !== id) continue;
        if (next === path) {
          const route = [current];
          while (route[0] !== path) route.unshift(parent.get(route[0]!)!);
          return [...route, path];
        }
        if (!parent.has(next) && next !== path) {
          parent.set(next, current);
          queue.push(next);
        }
      }
    }
    return undefined;
  };
  const cycles = (): string[][] => {
    const members = new Map<number, string[]>();
    for (const [path, id] of component) members.set(id, [...(members.get(id) ?? []), path]);
    return [...members.values()]
      .filter((files) => files.length > 1)
      .map((files) => files.sort())
      .sort((a, b) => b.length - a.length || a[0]!.localeCompare(b[0]!));
  };
  return {
    cycles,
    componentSize,
    cycleThrough,
    orderFrom,
  };
}
