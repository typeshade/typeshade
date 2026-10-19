// The names a module function may not take on each writer (Proposal 0070: a plan-free module
// shared by the spelling plan and the function rename, so neither imports the other).
// Implements: Rule 3.2, Rule 9.5 (docs/language-design.md; traced in reqs/).

import { BUILTIN_IDS } from '../builtin-ids.js';
import { GLSL_ES300_BUILTIN_FUNCTIONS, WGSL_PREDECLARED } from '../reserved-words.js';

/** The two writers this pass renames for. */
export type RenameTarget = 'wgsl' | 'glsl';

/** The target a backend's `id` names, or undefined for a backend this pass has no list for, such
 *  as one a test defines: it renames nothing. */
export function renameTargetOf(backendId: string): RenameTarget | undefined {
  return backendId === 'wgsl' ? 'wgsl' : backendId === 'glsl-es300' ? 'glsl' : undefined;
}

const namesOf = new Map<RenameTarget, ReadonlySet<string>>();

/** Every name a module function may not have on `target`: what the target predeclares and the
 *  id of each builtin the IR carries. */
export function predeclaredFunctionNames(target: RenameTarget): ReadonlySet<string> {
  let names = namesOf.get(target);
  if (names === undefined) {
    names = new Set([
      ...BUILTIN_IDS,
      ...(target === 'wgsl' ? WGSL_PREDECLARED : GLSL_ES300_BUILTIN_FUNCTIONS),
    ]);
    namesOf.set(target, names);
  }
  return names;
}
