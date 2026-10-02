import type { LintRule } from '../engine.js';
import { isBuiltinId } from '../../../builtin-ids.js';

/** WGSL has no call stack — a function must not (directly) call itself. */
export const noRecursion: LintRule = {
  id: 'no-recursion',
  description: 'WGSL forbids recursion — a function must not call itself',
  severity: 'error',
  category: 'correctness',
  create: (ctx) => ({
    Expr(e, fn) {
      // A call of the builtin the function is named for is no call of itself (Rule 9.5): the
      // `fract` a declared `fract` reaches through `random`, which expands to one.
      if (e.op === 'call' && e.fn === fn.name && (e.declRef !== undefined || !isBuiltinId(e.fn))) {
        ctx.report(`fn '${fn.name}' calls itself — WGSL has no recursion`, { fn: fn.name });
      }
    },
  }),
};
