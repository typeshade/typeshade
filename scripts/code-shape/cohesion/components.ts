import type ts from 'typescript';
import { declarationsOf, fileLineCount, type Declaration } from './declarations.js';
import { hubsOf, referenceGraph, type ReferenceGraph } from './graph.js';

export const MIN_DECLARATIONS = 4;

export interface Component {
  members: number[];
  lines: number;
  imports: string[];
  onlyImports: string[];
}

export interface FileCohesion {
  source: ts.SourceFile;
  declarations: Declaration[];
  graph: ReferenceGraph;
  fileLines: number;
  hubs: number[];
  allComponents: number[][];
  components: Component[];
  largest: number;
}

function connected(
  count: number,
  graph: ReferenceGraph,
  excluded: ReadonlySet<number>,
): number[][] {
  const parent = Array.from({ length: count }, (_, at) => at);
  const find = (at: number): number => {
    let root = at;
    while (parent[root] !== root) root = parent[root]!;
    parent[at] = root;
    return root;
  };
  graph.references.forEach((targets, from) => {
    if (excluded.has(from)) return;
    for (const target of targets) {
      if (!excluded.has(target)) parent[find(from)] = find(target);
    }
  });
  const groups = new Map<number, number[]>();
  for (let at = 0; at < count; at += 1) {
    if (excluded.has(at)) continue;
    const root = find(at);
    groups.set(root, [...(groups.get(root) ?? []), at]);
  }
  return [...groups.values()];
}

function describe(
  members: number[],
  declarations: readonly Declaration[],
  graph: ReferenceGraph,
): Component {
  const own = new Set(members);
  const imports = new Set(members.flatMap((at) => [...graph.imports[at]!]));
  const others = new Set(graph.imports.flatMap((used, at) => (own.has(at) ? [] : [...used])));
  return {
    members,
    lines: members.reduce((sum, at) => sum + declarations[at]!.lines, 0),
    imports: [...imports].sort(),
    onlyImports: [...imports].filter((specifier) => !others.has(specifier)).sort(),
  };
}

export function analyseFile(
  checker: ts.TypeChecker,
  source: ts.SourceFile,
): FileCohesion | undefined {
  const declarations = declarationsOf(checker, source);
  if (declarations.length < MIN_DECLARATIONS) return undefined;
  const graph = referenceGraph(checker, declarations);
  const hubs = hubsOf(graph);
  const largest = declarations.reduce(
    (best, declaration, at) => (declaration.lines > declarations[best]!.lines ? at : best),
    0,
  );
  return {
    source,
    declarations,
    graph,
    fileLines: fileLineCount(source),
    hubs: [...hubs].sort((a, b) => a - b),
    allComponents: connected(declarations.length, graph, new Set()),
    components: connected(declarations.length, graph, hubs).map((members) =>
      describe(members, declarations, graph),
    ),
    largest,
  };
}
