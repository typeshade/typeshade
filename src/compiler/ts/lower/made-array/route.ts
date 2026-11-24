// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { MadeArray, UnreadLoop } from './registry.js';

export interface MadeRoute {
  readonly made: MadeArray;
  readonly unread?: UnreadLoop;
}

export function routeOf(made: MadeArray, countable: boolean): MadeRoute {
  const { unread, open, ...rest } = made;
  if (countable) return { made: { ...rest, counted: true } };
  if (open === true || unread !== undefined)
    return { made: { ...rest, growing: true }, ...(unread !== undefined ? { unread } : {}) };
  return { made };
}
