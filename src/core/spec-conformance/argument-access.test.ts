// ═══ The access table equals what core.def's parameter types say (#348) ═══
//
// WHAT THIS CLOSES. How a builtin uses each argument used to be written into each analysis that
// needed it. `arrayLength(xs)` measures `xs` and reads none of its elements: the Rule 7.5 bound
// check, uniformity and the kernel lowering each skipped inside it by hand, and the kernel proof
// did not, so a loop that read `out.length` while writing `out` ran on the CPU (#345). The
// analyses now ask `passes/access.ts`, and this file holds that table to Tint's overloads, so a
// builtin that takes a pointer cannot arrive without an answer.
//
// HOW. An overload's parameter types say how it uses the argument: a pointer to an atomic is an
// atomic's place, a pointer to a runtime-sized array is the array `arrayLength` measures, any
// other pointer is read through, and `textureStore`'s first parameter is the texture it stores a
// texel in. Which of the atomics reads, writes or does both is WGSL's (the atomic built-in
// functions): `atomicLoad` reads, `atomicStore` writes, and the rest read and write in one step.
// Every overload TypeShade does not refuse is held to the table.

import { describe, expect, it } from 'vitest';
import type { CoreDefRow } from '../builtins/coredef-types.js';
import { COREDEF } from '../builtins/coredef.js';
import { claimOf } from '../builtins/overlay.js';
import {
  ARGUMENT_ACCESS,
  argAccess,
  isAtomicAccess,
  writesPlace,
  type Access,
} from '../passes/access.js';
import { EFFECTFUL_INTRINSICS } from '../passes/effects.js';

/** The access an overload's parameter types give its argument at `k`. */
function expected(name: string, type: string, k: number): Access {
  if (type.startsWith('ptr<')) {
    if (type.includes('atomic<'))
      return name === 'atomicLoad'
        ? 'atomic-load'
        : name === 'atomicStore'
          ? 'atomic-store'
          : 'atomic-update';
    if (type.includes('runtime_array<')) return 'length';
    return 'value';
  }
  return name === 'textureStore' && k === 0 ? 'texel-write' : 'value';
}

/** The builtin overloads TypeShade takes: supported, or deferred to the family whose pull request
 *  takes them over (0017). A row refused, or deferred to an extension TypeShade does not spell,
 *  is no program's. `workgroupUniformLoad` is not among them: Tint keeps it in `wgsl.def`, which
 *  the bake does not read, and its pointer is read like any argument the table does not list. */
const ROWS = COREDEF.rows.filter((r) => {
  const claim = r.kind === 'fn' ? claimOf(r, COREDEF.matchers) : undefined;
  return (
    claim?.status === 'SUPPORTED' || (claim?.status === 'DEFERRED' && claim.to !== 'an extension')
  );
});

const takesPointer = (r: CoreDefRow): boolean => r.params.some((p) => p.type.startsWith('ptr<'));

/** Every way `access` and `listed` disagree with the overloads in `rows`. */
function disagreements(
  rows: readonly CoreDefRow[],
  access: (fn: string, k: number) => Access,
  listed: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    // A builtin that takes a pointer or stores a texel is listed, even when its pointer is only
    // read: the table answers for it on purpose, not by default.
    if ((takesPointer(r) || r.name === 'textureStore') && !listed.has(r.name))
      out.add(`${r.name}: takes a pointer or stores a texel, and access.ts does not list it`);
    r.params.forEach((p, k) => {
      const want = expected(r.name, p.type, k);
      const got = access(r.name, k);
      if (got !== want)
        out.add(
          `${r.signature}: argument ${String(k)} (${p.type}) is ${want}, access.ts says ${got}`,
        );
    });
  }
  for (const name of listed)
    if (!rows.some((r) => r.name === name))
      out.add(`${name}: listed in access.ts, and core.def has no overload of it TypeShade takes`);
  return [...out];
}

/** The listed builtins that read or write an atomic's place or store a texel, and that the
 *  optimizer would take for a pure call because `EFFECTFUL_INTRINSICS` does not have them. */
function unorderedEffects(effectful: ReadonlySet<string>): string[] {
  return [...ARGUMENT_ACCESS]
    .filter(([, accesses]) => accesses.some((a) => isAtomicAccess(a) || writesPlace(a)))
    .map(([name]) => name)
    .filter((name) => !effectful.has(name));
}

describe('how a builtin uses its arguments (access.ts) is what core.def says (#348)', () => {
  it('sees a row the table gets wrong, and reads the overloads that take a pointer', () => {
    // AGENTS.md#gate-discipline: the check fails on a table that is wrong, before its zero is
    // believed. `arrayLength` read as a value is #345.
    const wrong = (fn: string, k: number): Access =>
      fn === 'arrayLength' ? 'value' : argAccess(fn, k);
    expect(disagreements(ROWS, wrong, new Set(ARGUMENT_ACCESS.keys()))).toEqual([
      'fn arrayLength<T, AS: workgroup_uniform_storage, A: access>(ptr<AS, runtime_array<T>, A>) -> u32: argument 0 (ptr<AS, runtime_array<T>, A>) is length, access.ts says value',
    ]);
    const unlisted = new Set([...ARGUMENT_ACCESS.keys()].filter((n) => n !== 'textureStore'));
    expect(disagreements(ROWS, argAccess, unlisted)).toContain(
      'textureStore: takes a pointer or stores a texel, and access.ts does not list it',
    );
    // The eleven atomics and arrayLength, at least.
    expect(ROWS.filter(takesPointer).length).toBeGreaterThanOrEqual(12);
  });

  it('agrees with every overload TypeShade does not refuse', () => {
    expect(disagreements(ROWS, argAccess, new Set(ARGUMENT_ACCESS.keys()))).toEqual([]);
  });

  it('keeps every call to an atomic or a texel store an effect the optimizer orders', () => {
    const missing = new Set([...EFFECTFUL_INTRINSICS].filter((n) => n !== 'textureStore'));
    expect(unorderedEffects(missing)).toEqual(['textureStore']);
    expect(unorderedEffects(EFFECTFUL_INTRINSICS)).toEqual([]);
  });
});
