export { eachExpr, mapChildren } from '../../ir/visit.js';
export { foldIntLit, intElemOf, wrapInt } from './expr-utils/int-fold.js';
export { isCompound, keyOf } from './expr-utils/key.js';
export { bodyHasRaw, collectLets, collectLocals, mapStmtValue } from './expr-utils/statements.js';
export { collectMutatedRoots, refsLocal, rootName } from './expr-utils/roots.js';
export { isWorthHoisting } from './expr-utils/hoisting.js';
