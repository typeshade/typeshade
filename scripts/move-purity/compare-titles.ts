import { groupBy, matchGroups } from './multiset.js';
import { testTitles, type Title } from './titles.js';

export interface TitleDiff {
  readonly vanished: Title[];
  readonly appeared: Title[];
}

const isTestFile = (path: string): boolean => path.endsWith('.test.ts');

function titlesOf(files: ReadonlyMap<string, string>, paths: readonly string[]): Title[] {
  return paths.flatMap((path) => {
    const text = files.get(path);
    return text === undefined || !isTestFile(path) ? [] : testTitles(path, text);
  });
}

export function compareTitles(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
  paths: readonly string[],
): TitleDiff {
  const baseGroups = groupBy(titlesOf(base, paths), (t) => t.title);
  const headGroups = groupBy(titlesOf(head, paths), (t) => t.title);
  const vanished: Title[] = [];
  const appeared: Title[] = [];
  for (const title of new Set([...baseGroups.keys(), ...headGroups.keys()])) {
    const match = matchGroups(baseGroups.get(title) ?? [], headGroups.get(title) ?? []);
    vanished.push(...match.vanished);
    appeared.push(...match.appeared);
  }
  return { vanished, appeared };
}
