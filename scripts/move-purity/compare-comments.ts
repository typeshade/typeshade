import { fileComments, type FileComment } from './comments.js';
import { groupBy, matchGroups } from './multiset.js';

export interface CommentDiff {
  readonly vanished: FileComment[];
  readonly appeared: FileComment[];
}

function commentsOf(files: ReadonlyMap<string, string>, paths: readonly string[]): FileComment[] {
  return paths.flatMap((path) => {
    const text = files.get(path);
    return text === undefined ? [] : fileComments(path, text);
  });
}

export function compareComments(
  base: ReadonlyMap<string, string>,
  head: ReadonlyMap<string, string>,
  paths: readonly string[],
): CommentDiff {
  const baseGroups = groupBy(commentsOf(base, paths), (c) => c.text);
  const headGroups = groupBy(commentsOf(head, paths), (c) => c.text);
  const vanished: FileComment[] = [];
  const appeared: FileComment[] = [];
  for (const text of new Set([...baseGroups.keys(), ...headGroups.keys()])) {
    const match = matchGroups(baseGroups.get(text) ?? [], headGroups.get(text) ?? []);
    vanished.push(...match.vanished);
    appeared.push(...match.appeared);
  }
  return { vanished, appeared };
}
