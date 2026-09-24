// Implements: Rule 8.23, a kernel function emitted by no target (docs/language-design.md; traced in reqs/).
// A kernel function (Rule 8.22) is an exported function that takes an array with no size. It
// runs on the host's side of the call, which dispatches its loops (change 0013), so no target
// emits it and no reflection lists it.

import type { ModuleDecl } from './nodes.js';

/** `m` without its kernel functions; `m` itself when it has none. */
export function withoutKernels(m: ModuleDecl): ModuleDecl {
  return m.funcs.some((f) => f.kernel === true)
    ? { ...m, funcs: m.funcs.filter((f) => f.kernel !== true) }
    : m;
}
