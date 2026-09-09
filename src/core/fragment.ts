// ═══ Shader DSL — module FRAGMENTS: declarations without a stage wrapper (#1711) ═══
//
// A host-integrated consumer does not always want a whole stage. It wants the module's
// declarations and helpers to splice into a program the HOST owns — MapLibre's GLSL
// prelude today, an assembled WGSL module tomorrow (WGSL has no preprocessor and no
// `#include`, so composition there is the host concatenating module fragments).
//
// The emitters produce a complete stage, so consumers strip the header with a regex.
// That is not merely inelegant, it is WRONG in a way that only shows up on some modules:
// the GLSL header is `#version` → `#extension … : require` (present exactly when a
// declared capability directs one) → the precision lines, so the obvious
// `/^#version[^\n]*\n(?:precision[^\n]*\n)*/` strips the whole block on a module with no
// extension and only the `#version` line on a module with one — leaving `#extension` and
// every precision line inside the include, to be redeclared when the host composes it.
// The same strip is what threw away `precision highp usampler2D;` (#1703) and cost a
// second bespoke post-process to put back.
//
// So the rule here is: whatever the backend needs for CORRECTNESS comes back as
// STRUCTURED DATA in `preamble`, never silently dropped and never left for a regex. A
// composer merges and de-duplicates those lines across the fragments it assembles.

import { collectFnRefs, emptyRefSet } from './ir/collect-refs.js'
import { isKnownIntrinsic } from './intrinsics.js'
import type { FuncDecl, ModuleDecl } from './ir/nodes.js'

/** What a fragment declares in the program it is composed into: the manifest a composer
 *  checks its host prelude against. Names are the emitted spellings, so they are the ones
 *  a host actually collides with. */
export interface FragmentDeclares {
  /** Helper functions defined in the fragment (entry points are listed separately). */
  readonly functions: readonly string[]
  /** Plain struct types. A struct consumed as a uniform or storage binding is emitted as
   *  a block, so its name appears under `bindings` instead. */
  readonly structs: readonly string[]
  /** Resource bindings the fragment declares, by binding name. */
  readonly bindings: readonly string[]
  /** Module constants. */
  readonly consts: readonly string[]
  /** Pipeline specialization constants (`overrideConst`). */
  readonly overrides: readonly string[]
  /** Stage entry points. Listed whether or not they were emitted, so a composer that asked
   *  for declarations only still knows what it excluded. */
  readonly entryPoints: readonly string[]
}

/** A module emitted without its stage wrapper, plus everything the host must supply or
 *  ensure for the result to compile. Produced by {@link emitFragment} (WGSL) and
 *  {@link emitGlslFragment} (GLSL). */
export interface EmitFragment {
  /** The header-less source: declarations, helpers, and (unless excluded) entry points. */
  readonly source: string
  /** Directive and precision lines the host must place ahead of `source`, in order. They
   *  are returned as data so a composer can merge and de-duplicate them across fragments. */
  readonly preamble: readonly string[]
  /** The manifest of what `source` declares. */
  readonly declares: FragmentDeclares
  /** Symbols the fragment references but does not define: functions declared with
   *  {@link externFn}, and variables declared with {@link externVar}, spelled for the
   *  target. A composer can check this list against what the host actually provides.
   *  Function names come from call sites that resolve to neither a module function nor a
   *  known intrinsic. Sorted and de-duplicated. */
  readonly requires: readonly string[]
}

/** Call ids referenced by `walk` that name neither a module function nor a known
 *  intrinsic — i.e. the host-provided ones. Sorted and de-duplicated so the manifest is
 *  deterministic.
 *
 *  `moduleFns` is the WHOLE module's function set, not just the scoped subset being
 *  emitted: a helper that the stage scope dropped is still ours, and reporting a call to
 *  it as a host requirement would send a composer looking for a symbol the host was never
 *  meant to have. */
export function externCallNames(
  walk: readonly FuncDecl[],
  moduleFns: ReadonlySet<string>,
): readonly string[] {
  const refs = emptyRefSet()
  for (const f of walk) collectFnRefs(f, refs)
  return [...refs.calls].filter((n) => !moduleFns.has(n) && !isKnownIntrinsic(n)).sort()
}

/** Everything a fragment expects its host to provide: the extern FUNCTIONS it calls
 *  (derived from call sites, since `externFn` leaves no declaration) plus the extern
 *  VARIABLES it declares (#1713), spelled for `target` — the host binds by the spelling,
 *  not by the logical name. Sorted and de-duplicated. */
export function fragmentRequires(
  m: ModuleDecl,
  walk: readonly FuncDecl[],
  target: 'wgsl' | 'glsl',
): readonly string[] {
  const out = new Set(externCallNames(walk, new Set(m.funcs.map((f) => f.name))))
  for (const e of m.externs ?? [])
    out.add((target === 'wgsl' ? e.spelling?.wgsl : e.spelling?.glsl) ?? e.name)
  return [...out].sort()
}
