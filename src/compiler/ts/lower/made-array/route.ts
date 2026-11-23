// Implements: Rule 8.23 (docs/language-design.md; traced in reqs/).
import type { DeferredRefusal, MadeArray } from './registry.js';

export type MadeRoute = { readonly made: MadeArray } | { readonly refused: DeferredRefusal };

export function routeOf(made: MadeArray, countable: boolean): MadeRoute {
  const { deferred, open, ...rest } = made;
  if (countable) return { made: { ...rest, counted: true } };
  if (deferred !== undefined) return { refused: deferred };
  if (open === true) return { made: { ...rest, growing: true } };
  return { made };
}
