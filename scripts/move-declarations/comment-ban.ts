import { commentLines, publicDefinitions } from '../comment-policy.js';
import { refuse } from './refusal.js';

const SURFACE_PATH = 'src/__api__/surface.md';

export function checkComments(
  base: ReadonlyMap<string, string>,
  source: string,
  target: string,
  targetText: string,
  movedNames: readonly string[],
): void {
  const keys = publicDefinitions(base.get(SURFACE_PATH) ?? '');
  for (const name of movedNames) if (keys.has(`${source}#${name}`)) keys.add(`${target}#${name}`);
  const banned = commentLines(target, targetText, keys).banned;
  if (banned > 0) {
    refuse(
      `moved units carry ${banned} banned comment lines; remove the comments first in an ordinary pull request (CLAUDE.md, Comments)`,
    );
  }
}

export function surfaceNames(
  base: ReadonlyMap<string, string>,
  source: string,
  movedNames: readonly string[],
): string[] {
  const keys = publicDefinitions(base.get(SURFACE_PATH) ?? '');
  return movedNames.filter((name) => keys.has(`${source}#${name}`));
}
