import type { Links } from './module-links.js';
import type { Side } from './side-program.js';

export interface ImportGraph {
  componentOf(path: string): number | undefined;
  orderFrom(root: string): string[];
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
  return { componentOf: (path) => component.get(path), orderFrom };
}
