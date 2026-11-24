import ts from 'typescript';
import { refuse } from './refusal.js';
import type { SourceAnalysis } from './references.js';

export interface Blocker {
  readonly names: readonly string[];
  readonly exported: boolean;
  readonly usedBy: readonly string[];
  readonly alsoUsedBy: readonly string[];
}

export interface Selection {
  readonly moved: ReadonlySet<number>;
  readonly pulled: ReadonlySet<number>;
  readonly blockers: readonly Blocker[];
}

const isMovableKind = (node: ts.Node): boolean =>
  ts.isFunctionDeclaration(node) ||
  ts.isClassDeclaration(node) ||
  ts.isInterfaceDeclaration(node) ||
  ts.isTypeAliasDeclaration(node) ||
  ts.isEnumDeclaration(node) ||
  ts.isVariableStatement(node);

const isDefaultExport = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false);

const declares = (node: ts.Node): boolean =>
  !ts.isExportDeclaration(node) && !ts.isExportAssignment(node);

interface Blocks {
  readonly blockOf: readonly number[];
  readonly members: ReadonlyMap<number, readonly number[]>;
  readonly byName: ReadonlyMap<string, readonly number[]>;
}

function groupByName(analysis: SourceAnalysis): Blocks {
  const { units } = analysis;
  const parent = units.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) index = parent[index]!;
    return index;
  };
  const byName = new Map<string, number[]>();
  units.forEach((unit, index) => {
    if (!declares(unit.node)) return;
    for (const name of unit.names) {
      const known = byName.get(name);
      if (known === undefined) byName.set(name, [index]);
      else {
        known.push(index);
        parent[find(index)] = find(known[0]!);
      }
    }
  });
  const blockOf = units.map((_, index) => find(index));
  const members = new Map<number, number[]>();
  blockOf.forEach((block, index) => members.set(block, [...(members.get(block) ?? []), index]));
  return { blockOf, members, byName };
}

function listedBlocks(analysis: SourceAnalysis, blocks: Blocks, listed: readonly string[]) {
  const chosen = new Set<number>();
  for (const name of listed) {
    const indexes = blocks.byName.get(name);
    if (indexes === undefined) {
      refuse(`name not found among the top-level declarations of ${analysis.path}: ${name}`);
    }
    for (const index of indexes!) {
      const node = analysis.units[index]!.node;
      if (isDefaultExport(node)) refuse(`${name} is a default export; default exports do not move`);
      if (!isMovableKind(node)) {
        refuse(`${name} is not a function, class, constant, type, interface or enum declaration`);
      }
    }
    chosen.add(blocks.blockOf[indexes![0]!]!);
  }
  for (const block of chosen) {
    const names = new Set(blocks.members.get(block)!.flatMap((i) => analysis.units[i]!.names));
    const missing = [...names].filter((name) => !listed.includes(name));
    if (missing.length > 0) {
      refuse(
        `${[...names].join(', ')} are declared together (one statement or one merged declaration): list all of them; missing ${missing.join(', ')}`,
      );
    }
  }
  return chosen;
}

function dependencies(analysis: SourceAnalysis, blocks: Blocks) {
  const uses = new Map<number, Set<number>>();
  const users = new Map<number, Set<number>>();
  for (const { from, to } of analysis.locals) {
    const a = blocks.blockOf[from]!;
    const b = blocks.blockOf[to]!;
    if (a === b) continue;
    uses.set(a, (uses.get(a) ?? new Set<number>()).add(b));
    users.set(b, (users.get(b) ?? new Set<number>()).add(a));
  }
  return { uses, users };
}

function reachableFrom(roots: ReadonlySet<number>, uses: ReadonlyMap<number, Set<number>>) {
  const found = new Set<number>();
  const stack = [...roots];
  while (stack.length > 0) {
    for (const next of uses.get(stack.pop()!) ?? []) {
      if (!roots.has(next) && !found.has(next)) {
        found.add(next);
        stack.push(next);
      }
    }
  }
  return found;
}

function pulledBlocks(
  analysis: SourceAnalysis,
  blocks: Blocks,
  chosen: ReadonlySet<number>,
  graph: ReturnType<typeof dependencies>,
): Set<number> {
  const candidates = reachableFrom(chosen, graph.uses);
  for (const block of [...candidates]) {
    const kinds = blocks.members.get(block)!.map((i) => analysis.units[i]!.node);
    const movable = kinds.every(
      (node) => declares(node) && isMovableKind(node) && !isDefaultExport(node),
    );
    if (!movable || kinds.length === 0) candidates.delete(block);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of [...candidates]) {
      const outside = [...(graph.users.get(block) ?? [])].some(
        (user) => !chosen.has(user) && !candidates.has(user),
      );
      if (outside) {
        candidates.delete(block);
        changed = true;
      }
    }
  }
  return candidates;
}

const namesOfBlocks = (analysis: SourceAnalysis, blocks: Blocks, ids: Iterable<number>) => [
  ...new Set(
    [...ids].flatMap((b) => blocks.members.get(b)!.flatMap((i) => analysis.units[i]!.names)),
  ),
];

function findBlockers(
  analysis: SourceAnalysis,
  blocks: Blocks,
  moved: ReadonlySet<number>,
  graph: ReturnType<typeof dependencies>,
): Blocker[] {
  const stays = new Set<number>();
  for (const block of moved)
    for (const used of graph.uses.get(block) ?? []) if (!moved.has(used)) stays.add(used);
  return [...stays].map((block) => {
    const users = graph.users.get(block) ?? new Set<number>();
    return {
      names: namesOfBlocks(analysis, blocks, [block]),
      exported: blocks.members.get(block)!.some((i) => analysis.units[i]!.exported),
      usedBy: namesOfBlocks(
        analysis,
        blocks,
        [...users].filter((u) => moved.has(u)),
      ),
      alsoUsedBy: namesOfBlocks(
        analysis,
        blocks,
        [...users].filter((u) => !moved.has(u)),
      ),
    };
  });
}

export function selectUnits(
  analysis: SourceAnalysis,
  listed: readonly string[],
  closure: boolean,
): Selection {
  const blocks = groupByName(analysis);
  const chosen = listedBlocks(analysis, blocks, listed);
  const graph = dependencies(analysis, blocks);
  const pulled = closure ? pulledBlocks(analysis, blocks, chosen, graph) : new Set<number>();
  const movedBlocks = new Set([...chosen, ...pulled]);
  const unitsOf = (ids: Iterable<number>): number[] =>
    [...ids].flatMap((b) => blocks.members.get(b)!);
  return {
    moved: new Set(unitsOf(movedBlocks)),
    pulled: new Set(unitsOf(pulled)),
    blockers: findBlockers(analysis, blocks, movedBlocks, graph),
  };
}
