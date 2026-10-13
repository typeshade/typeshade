// ═══ One spelling plan per module: the emitted name of each authored name, per target ═══
//
// Proposal 0070. A name the author writes is kept by the authored IR, the CPU oracle, the
// diagnostics and the host contract. A target that cannot spell the name gets a fresh emitted
// name, and every reference to it takes that name. This module decides those names. It reads
// the authored module only and returns the same plan for the same module, so the writers, the
// reflection and the manifest read one answer. Nothing is rewritten here: the late pass
// (`passes/spell-names.ts`) and the writers apply the plan.
//
// The WGSL spelling is `emitted`. The GLSL spelling is read from `emittedGlsl` when it differs
// (Proposal 0070, D3 and its amendment). The plan keeps the two targets apart per kind: a binding,
// an override, a struct, a constant, a variable, a helper, an entry, and a member (a struct field
// or an entry parameter, keyed by the authored string so one varying has one spelling).

import type { ModuleDecl, ShaderType } from './ir/index.js';
import { stageOf } from './ir/index.js';
import { collectLocals } from './passes/opt/expr-utils.js';
import { predeclaredFunctionNames } from './passes/predeclared-names.js';
import { freshSpelling } from './passes/variable-names.js';
import { UnsupportedFeatureError } from './backend.js';
import {
  GLSL_ES300_RESERVED,
  GLSL_WRITER_RESERVED,
  WGSL_PREDECLARED,
  WGSL_RESERVED,
} from './reserved-words.js';

export { freshSpelling } from './passes/variable-names.js';

/** The two writers a plan spells for. */
export type SpellTarget = 'wgsl' | 'glsl';

/** Authored name to emitted name on one target, only for a pair that differs. */
export interface TargetSpellings {
  /** Helper functions: a function with no stage. */
  readonly funcs: ReadonlyMap<string, string>;
  /** Entry points: a function with a stage. */
  readonly entries: ReadonlyMap<string, string>;
  readonly consts: ReadonlyMap<string, string>;
  /** Module variables (`private` and `workgroup`). */
  readonly vars: ReadonlyMap<string, string>;
  /** Resource bindings whose owner is not the host. */
  readonly bindings: ReadonlyMap<string, string>;
  readonly overrides: ReadonlyMap<string, string>;
  readonly structs: ReadonlyMap<string, string>;
  /** Struct field names of the structs the host does not name, and entry-point parameter names.
   *  One table, keyed by the authored string, so the vertex `out` and the fragment `in` of one
   *  varying get one spelling. */
  readonly members: ReadonlyMap<string, string>;
  /** Structs whose fields the host names: the struct of a host-owned binding and each struct its
   *  fields reach. Their names and fields are never renamed. */
  readonly hostStructs: ReadonlySet<string>;
}

/** The plan of one module: a spelling per target. */
export interface SpellingPlan {
  readonly wgsl: TargetSpellings;
  readonly glsl: TargetSpellings;
}

/** Every spelling the GLSL writer cannot use for an identifier: the ES 3.00 list and the
 *  writer's own six. */
const GLSL_SPELLING_RESERVED: ReadonlySet<string> = new Set([
  ...GLSL_ES300_RESERVED,
  ...GLSL_WRITER_RESERVED,
]);

/** Whether `target` cannot spell `name` as an identifier. The same predicates the two writers
 *  apply: `wgsl.ts` `preOptimize` and `glsl-sanitize.ts` `sanitizeReservedIdents`. */
export function unspellable(target: SpellTarget, name: string): boolean {
  if (target === 'wgsl') {
    return WGSL_RESERVED.has(name) || name.includes('$') || name.startsWith('__') || name === '_';
  }
  return (
    GLSL_SPELLING_RESERVED.has(name) ||
    /[^A-Za-z0-9_]/u.test(name) ||
    name.startsWith('gl_') ||
    name.includes('__')
  );
}

/** Whether no name of `t` is renamed. */
export const spellsNothing = (t: TargetSpellings): boolean =>
  [t.funcs, t.entries, t.consts, t.vars, t.bindings, t.overrides, t.structs, t.members].every(
    (map) => map.size === 0,
  );

/** The emitted name of `name` in `map`: the name itself when the map does not rename it. */
export const emittedName = (map: ReadonlyMap<string, string>, name: string): string =>
  map.get(name) ?? name;

/** Every emitted name of `t`: the names a local must not take, so the pass that spells locals
 *  never collides with the plan (Proposal 0070, section 2.4 point 5). */
export function plannedNames(t: TargetSpellings): ReadonlySet<string> {
  return new Set(
    [t.funcs, t.entries, t.consts, t.vars, t.bindings, t.overrides, t.structs, t.members].flatMap(
      (map) => [...map.values()],
    ),
  );
}

/** The struct names a type reaches: a struct, or the element of an array. */
function structsOf(type: ShaderType, out: string[]): void {
  if (type.kind === 'struct') out.push(type.name);
  else if (type.kind === 'array') structsOf(type.elem, out);
}

/** The structs the host names: those a host-owned binding's type reaches, and those reached
 *  from their fields, in turn. */
function hostStructNames(m: ModuleDecl): ReadonlySet<string> {
  const byName = new Map(m.structs.map((s) => [s.name, s] as const));
  const out = new Set<string>();
  const visit = (name: string): void => {
    if (out.has(name)) return;
    out.add(name);
    for (const f of byName.get(name)?.fields ?? []) {
      const reached: string[] = [];
      structsOf(f.type, reached);
      reached.forEach(visit);
    }
  };
  for (const b of m.bindings) {
    if (b.owner !== 'host') continue;
    const reached: string[] = [];
    structsOf(b.type, reached);
    reached.forEach(visit);
  }
  return out;
}

/** Every name the module holds in any scope, per the target: the collision set of Proposal
 *  0070 (section 2.3). A fresh spelling avoids all of them, so an authored name is never taken. */
function collisionSet(m: ModuleDecl, t: SpellTarget): Set<string> {
  const out = new Set<string>(['_fp64', '_console']);
  for (const c of m.consts) out.add(c.name);
  for (const b of m.bindings) out.add(b.name);
  for (const o of m.overrides ?? []) out.add(o.name);
  for (const v of m.vars ?? []) out.add(v.name);
  for (const s of m.structs) {
    out.add(s.name);
    for (const f of s.fields) out.add(f.name);
  }
  for (const f of m.funcs) {
    out.add(f.name);
    for (const p of f.params) out.add(p.name);
    collectLocals(f.body, out);
  }
  for (const x of m.externs ?? []) {
    out.add(x.name);
    const spelled = x.spelling?.[t];
    if (spelled !== undefined) out.add(spelled);
  }
  return out;
}

/** The plan of one target. Each kind is allocated once per distinct authored name, in the order
 *  of section 2.3, so the numbering is deterministic. */
function planTarget(m: ModuleDecl, t: SpellTarget): TargetSpellings {
  const taken = collisionSet(m, t);
  const predeclared = predeclaredFunctionNames(t);
  const unspell = (name: string): boolean => unspellable(t, name);
  const hidesPredeclared = (name: string): boolean => unspell(name) || predeclared.has(name);
  const hostStructs = hostStructNames(m);

  const allocate = (
    names: Iterable<string>,
    needsFresh: (name: string) => boolean,
    bad: (candidate: string) => boolean,
  ): Map<string, string> => {
    const out = new Map<string, string>();
    for (const name of new Set(names)) {
      if (!needsFresh(name)) continue;
      const fresh = freshSpelling(name, (c) => taken.has(c), bad);
      taken.add(fresh);
      out.set(name, fresh);
    }
    return out;
  };

  const helpers = m.funcs.filter((f) => stageOf(f) === undefined).map((f) => f.name);
  const entries = m.funcs.filter((f) => stageOf(f) !== undefined).map((f) => f.name);
  const nonHostStructs = m.structs.filter((s) => !hostStructs.has(s.name));

  // Helper functions: a name the target cannot spell or predeclares.
  const funcs = allocate(helpers, hidesPredeclared, hidesPredeclared);
  // A WGSL module-scope name that WGSL predeclares hides the predeclared name for the whole
  // module (Proposal 0070, Q1b, measured on Tint: `const max` refuses `max(...)`, `var<storage>`
  // `length` the same, and `const vec4` refuses `vec4<f32>`). Such a name takes a fresh spelling.
  const shadowed = (name: string): boolean =>
    unspell(name) || (t === 'wgsl' && WGSL_PREDECLARED.has(name));
  // Constants and module variables: a name the target cannot spell, or WGSL predeclares.
  const consts = allocate(
    m.consts.map((c) => c.name),
    shadowed,
    unspell,
  );
  const vars = allocate(
    (m.vars ?? []).map((v) => v.name),
    shadowed,
    unspell,
  );
  // Entry points: WGSL also renames a name it predeclares (Q1: unconditionally); GLSL spells
  // every entry `main`, so only a name it cannot spell is renamed.
  const entryNeeds = t === 'wgsl' ? hidesPredeclared : unspell;
  const entryMap = allocate(entries, entryNeeds, hidesPredeclared);
  // Bindings, overrides and structs: a name the target cannot spell, or WGSL predeclares. A
  // host-owned binding and a host struct keep their names (Q3: an unspellable one is refused by
  // `assertHostOwnedSpellable`).
  const bindings = allocate(
    m.bindings.filter((b) => b.owner !== 'host').map((b) => b.name),
    shadowed,
    unspell,
  );
  const overrides = allocate(
    (m.overrides ?? []).map((o) => o.name),
    shadowed,
    unspell,
  );
  const structs = allocate(
    nonHostStructs.map((s) => s.name),
    shadowed,
    unspell,
  );
  // Members: fields of the structs the host does not name, and entry-point parameters. An entry
  // parameter that WGSL predeclares hides the name in its entry, so it takes a fresh spelling. A
  // field that shares its name with such a parameter is spelled the same (one table, Q3).
  const entryParams = new Set(
    m.funcs.filter((f) => stageOf(f) !== undefined).flatMap((f) => f.params.map((p) => p.name)),
  );
  const memberNames = [
    ...nonHostStructs.flatMap((s) => s.fields.map((f) => f.name)),
    ...entryParams,
  ];
  const members = allocate(
    memberNames,
    (name) =>
      unspell(name) || (t === 'wgsl' && entryParams.has(name) && WGSL_PREDECLARED.has(name)),
    unspell,
  );

  return {
    funcs,
    entries: entryMap,
    consts,
    vars,
    bindings,
    overrides,
    structs,
    members,
    hostStructs,
  };
}

/** The plan of `m`, for both targets. A pure function of the authored module: the same module
 *  (or the same module after a portable round trip) gives the same plan. */
export function planSpellings(m: ModuleDecl): SpellingPlan {
  return { wgsl: planTarget(m, 'wgsl'), glsl: planTarget(m, 'glsl') };
}

const plans = new WeakMap<ModuleDecl, SpellingPlan>();

/** The plan of `m`, computed once per module object. A derived module registers its parent's
 *  plan through `inheritSpellings`. */
export function spellingsOf(m: ModuleDecl): SpellingPlan {
  let plan = plans.get(m);
  if (plan === undefined) {
    plan = planSpellings(m);
    plans.set(m, plan);
  }
  return plan;
}

/** `child` derived from `parent`: `child` takes `parent`'s plan, so both name the same things
 *  the same way. Returns `child`. */
export function inheritSpellings<T extends ModuleDecl>(child: T, parent: ModuleDecl): T {
  if (child !== parent) plans.set(child, spellingsOf(parent));
  return child;
}

/** Refuses a host-owned name the target cannot spell (Proposal 0070, Q3). The host names these,
 *  so they are never renamed, and a name the target cannot spell has no valid text. */
export function assertHostOwnedSpellable(m: ModuleDecl, t: SpellTarget): void {
  const hostStructs = hostStructNames(m);
  const refuse = (what: string, name: string): void => {
    if (!unspellable(t, name)) return;
    throw new UnsupportedFeatureError(
      `${t}: host-owned ${what} '${name}' is a reserved word on ${t} and the host names it, so it cannot be spelled; pick another name`,
    );
  };
  for (const b of m.bindings) if (b.owner === 'host') refuse('binding', b.name);
  for (const s of m.structs) {
    if (!hostStructs.has(s.name)) continue;
    refuse('struct', s.name);
    for (const f of s.fields) refuse(`field '${s.name}.${f.name}'`, f.name);
  }
}
