// ═══ S4 — the compiler's stage sets equal the sets core.def states ═══
//
// WHAT THIS CLOSES. WGSL restricts some builtins to some entry stages: "Must only be used in a
// fragment shader stage" for the implicit-derivative reads (`wgsl.txt:23438, 24435, 24601,
// 24720`), a fragment-or-compute rule for texture writes and atomics, a compute-only rule for
// the barriers. This package states those rules in TWO hand-written places, in two layers —
// `FRAGMENT_ONLY_CALLS` in the front end (`compiler/ts/lower/function.ts`) and
// `FRAGMENT_ONLY_IDS` in the core lint (`passes/lint/rules/fragment-only-builtin.ts`) — so
// every new id has to be REMEMBERED twice. It was not: the spec audit of 2026-09-21 (#144)
// found `textureSampleCubeArray` in neither list, and a vertex entry sampling a cube array
// compiled clean here and was refused by Tint (fixed in #143).
//
// The fix for the class, rather than for the case, is this file: the sets are DERIVED from
// Tint's own `@stage(...)` attributes (`fixtures/coredef-stages.json`, baked by
// `scripts/bake-coredef-textures.ts`) and compared with the compiler's. A new id in the
// catalogue whose WGSL name is staged is therefore claimed here or the suite fails.
//
// WHY BY WGSL NAME. The catalogue's ids are finer than WGSL's names — `textureSample`,
// `textureSampleArray` and `textureSampleCubeArray` all SPELL `textureSample` — and the stage
// rule belongs to the name. So each id is mapped to the name its WGSL spelling emits, and the
// rule is looked up under that.
//
// WHAT THIS FILE DOES NOT DECIDE. Three names (`textureDimensions`, `textureLoad`,
// `textureNumLayers`) are staged for SOME overloads only — the writable-storage ones — and no
// id-level set can express that. They are recorded below and left to
// `coredef-texture-overloads.test.ts`, which claims each overload separately.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../../compiler/ts/compile.js';
import { INTRINSICS, PORTABLE_INTRINSICS, PRE_EMIT_INTRINSICS } from '../intrinsics.js';
import {
  FRAGMENT_ONLY_CALLS,
  FRAGMENT_OR_COMPUTE_CALLS,
} from '../../compiler/ts/lower/function.js';
import { FRAGMENT_ONLY_IDS } from '../passes/lint/rules/fragment-only-builtin.js';

interface StageRow {
  readonly fn: string;
  /** One entry per DISTINCT `@stage(...)` across the name's overloads; `'any'` for an
   *  overload that carries none. Two entries mean the name's overloads disagree. */
  readonly stageSets: readonly string[];
}

const fixture = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'coredef-stages.json'),
    'utf8',
  ),
) as { readonly rows: readonly StageRow[] };

const namesWith = (set: string): string[] =>
  fixture.rows.filter((r) => r.stageSets.length === 1 && r.stageSets[0] === set).map((r) => r.fn);

/** Names every overload of which is `@stage("fragment")`. */
const FRAGMENT_ONLY_NAMES = new Set(namesWith('fragment'));
/** Names every overload of which is `@stage("fragment", "compute")`. */
const NOT_IN_VERTEX_NAMES = new Set(namesWith('fragment,compute'));
/** Names every overload of which is `@stage("compute")`. */
const COMPUTE_ONLY_NAMES = new Set(namesWith('compute'));
/** Names whose overloads DISAGREE — the rule is per-overload, not per-name. */
const MIXED_NAMES = fixture.rows.filter((r) => r.stageSets.length > 1).map((r) => r.fn);

/** The WGSL call name an id emits, or `null` when its spelling is not a plain call (an
 *  inlined operator) or one target has no form for it at all. */
function wgslNameOf(id: string): string | null {
  const spelling = (INTRINSICS as Readonly<Record<string, { wgsl(a: readonly string[]): string }>>)[
    id
  ];
  if (spelling === undefined) return id; // portable and pre-emit ids spell as themselves
  let text: string;
  try {
    text = spelling.wgsl(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  } catch {
    return null;
  }
  return /^([A-Za-z_]\w*)\s*\(/.exec(text)?.[1] ?? null;
}

const CATALOGUE = [
  ...Object.keys(INTRINSICS),
  ...PORTABLE_INTRINSICS,
  ...PRE_EMIT_INTRINSICS,
].sort();

const idsSpelling = (names: ReadonlySet<string>): string[] =>
  CATALOGUE.filter((id) => {
    const name = wgslNameOf(id);
    return name !== null && names.has(name);
  });

// The roadmap row the subgroup and quad entries rest on, cited by its name and not by a line
// number: a line number goes stale as soon as a row above it moves, which is what happened to
// the one written here before. The test below checks the row is still there and still says so.
const SUBGROUP_ROW = 'Subgroup operations';
const SUBGROUP_ROW_REASON =
  'A WebGPU extension with no WebGL2 equivalent and no oracle meaning yet';
const SUBGROUPS = `subgroup operations: docs/roadmap.md, After 1.0, row "${SUBGROUP_ROW}": "${SUBGROUP_ROW_REASON}"`;
const QUADS = `quad operations, part of the WGSL subgroups extension: docs/roadmap.md, After 1.0, row "${SUBGROUP_ROW}"`;

/** A staged `core.def` name this package has no catalogue id for. Each entry says why, and the
 *  list is shrink-only: the arm below fails a name that HAS gained an id but kept its entry. */

const NOT_IN_CATALOGUE: Readonly<Record<string, string>> = {
  // The 25 subgroup names, listed one by one rather than matched by prefix: a prefix would
  // swallow a future `subgroupSomething` this package DOES spell.
  ...Object.fromEntries(
    [
      'subgroupAdd',
      'subgroupAll',
      'subgroupAnd',
      'subgroupAny',
      'subgroupBallot',
      'subgroupBroadcast',
      'subgroupBroadcastFirst',
      'subgroupElect',
      'subgroupExclusiveAdd',
      'subgroupExclusiveMul',
      'subgroupInclusiveAdd',
      'subgroupInclusiveMul',
      'subgroupMatrixMultiplyAccumulate',
      'subgroupMatrixScalarAdd',
      'subgroupMatrixScalarMultiply',
      'subgroupMatrixScalarSubtract',
      'subgroupMax',
      'subgroupMin',
      'subgroupMul',
      'subgroupOr',
      'subgroupShuffle',
      'subgroupShuffleDown',
      'subgroupShuffleUp',
      'subgroupShuffleXor',
      'subgroupXor',
    ].map((name) => [name, SUBGROUPS]),
  ),
  inputAttachmentLoad:
    'input attachments are a WebGPU extension with no WebGL2 equivalent; nothing in this package spells one',
  quadBroadcast: QUADS,
  quadSwapDiagonal: QUADS,
  quadSwapX: QUADS,
  quadSwapY: QUADS,
  // `textureBarrier` and `atomicCompareExchangeWeak` were here until #164 gave each an id, and
  // the arm below is what said so: a name that gains an id has to leave this list in the same
  // commit, or the list would go on excusing a name the catalogue already carries.
  atomicStoreMax: 'audit G13: `atomic<vec2<u32>>` min/max, proposed After 1.0 in #144 §8',
  atomicStoreMin: 'audit G13: proposed After 1.0 in #144 §8',
};

/** An id this package does NOT refuse from a vertex entry although `core.def` stages its name
 *  `fragment, compute`. EMPTY, and the emptiness is the record: audit G34 had all ten atomics
 *  here, because `lower/atomics.ts` carried no stage check and an atomic in a `@vertex` entry
 *  compiled clean. #164 closed it, and the arm below is what reported the closure — it listed
 *  every id to delete, by compiling each witness rather than by reading a set, which is why it
 *  still fired when the fix landed somewhere neither this file nor the old comment predicted. */
const VERTEX_GAPS: Readonly<Record<string, string>> = {};

/** One `@vertex` program per atomic: the call WGSL stages `fragment, compute` sitting in a
 *  vertex entry. Each is now REFUSED, which the arm below asserts id by id; they were the
 *  measurement that emptied `VERTEX_GAPS` above, so they stay as the positive rule. */
const atomicVertex = (call: string, yieldsValue: boolean): string => `"use typeshade"
declare const hist: storage<array<atomic<u32>>, "read_write">
class Clip {
  @builtin("position") pos: vec4;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
${
  yieldsValue
    ? `  const r = ${call}\n  return { pos: vec4(f32(r), 0., 0., 1.) }`
    : `  ${call}\n  return { pos: vec4(0., 0., 0., 1.) }`
}
}
`;

const ATOMIC_VERTEX_WITNESS: Readonly<Record<string, string>> = {
  atomicAdd: atomicVertex('atomicAdd(hist[0], 1)', true),
  atomicAnd: atomicVertex('atomicAnd(hist[0], 1)', true),
  atomicExchange: atomicVertex('atomicExchange(hist[0], 1)', true),
  atomicLoad: atomicVertex('atomicLoad(hist[0])', true),
  atomicMax: atomicVertex('atomicMax(hist[0], 1)', true),
  atomicMin: atomicVertex('atomicMin(hist[0], 1)', true),
  atomicOr: atomicVertex('atomicOr(hist[0], 1)', true),
  atomicStore: atomicVertex('atomicStore(hist[0], 1)', false),
  atomicSub: atomicVertex('atomicSub(hist[0], 1)', true),
  atomicXor: atomicVertex('atomicXor(hist[0], 1)', true),
};

const errorsOf = (src: string): string[] =>
  compile(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => d.message);

describe('the compiler stage sets equal the sets core.def states (S4)', () => {
  it('reads a fixture that actually carries the three stage rules', () => {
    // A fixture that parsed to nothing would make every arm below vacuously green.
    expect([...FRAGMENT_ONLY_NAMES]).toContain('textureSample');
    expect([...NOT_IN_VERTEX_NAMES]).toContain('textureStore');
    expect([...COMPUTE_ONLY_NAMES]).toContain('workgroupBarrier');
  });

  it('names every staged builtin either by a catalogue id or by an explicit absence', () => {
    const spelled = new Set(CATALOGUE.map(wgslNameOf).filter((n): n is string => n !== null));
    const unaccounted = fixture.rows
      .map((r) => r.fn)
      .filter((fn) => !spelled.has(fn) && !(fn in NOT_IN_CATALOGUE));
    expect(unaccounted).toEqual([]);
  });

  it('cites a docs/roadmap.md row that is still there, under "After 1.0", with the reason quoted', () => {
    const roadmap = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'roadmap.md'),
      'utf8',
    );
    const after = roadmap.slice(roadmap.indexOf('### After 1.0'));
    const row = after.split('\n').find((l) => l.startsWith(`| ${SUBGROUP_ROW} `));
    expect(row, `roadmap "After 1.0" has no "${SUBGROUP_ROW}" row`).toBeDefined();
    expect(row).toContain(SUBGROUP_ROW_REASON);
  });

  it('loses the NOT_IN_CATALOGUE entry of a name that has since gained an id', () => {
    const spelled = new Set(CATALOGUE.map(wgslNameOf).filter((n): n is string => n !== null));
    expect(Object.keys(NOT_IN_CATALOGUE).filter((fn) => spelled.has(fn))).toEqual([]);
  });

  it('gates exactly the ids whose WGSL name core.def stages "fragment", in the two layers together', () => {
    // The union, not either set: the front end reports some ids and the core lint the rest,
    // and which layer owns an id is an implementation detail. What must hold is that no id
    // falls between them — which is precisely how `textureSampleCubeArray` was lost.
    const gated = [...new Set([...FRAGMENT_ONLY_CALLS, ...FRAGMENT_ONLY_IDS.keys()])].sort();
    expect(gated).toEqual(idsSpelling(FRAGMENT_ONLY_NAMES));
  });

  it('gates no id whose WGSL name core.def leaves unstaged, so a fix cannot be over-eager', () => {
    // `textureGather` carries no `@stage` row: it takes no implicit derivative and is legal in
    // any stage, which Tint confirms. A "gate everything named texture*" fix would break it.
    const overGated = [...FRAGMENT_ONLY_CALLS, ...FRAGMENT_ONLY_IDS.keys()].filter((id) => {
      const name = wgslNameOf(id);
      return name === null || !FRAGMENT_ONLY_NAMES.has(name);
    });
    expect(overGated).toEqual([]);
  });

  it('refuses from a vertex entry every id whose WGSL name core.def stages "fragment, compute"', () => {
    const missing = idsSpelling(NOT_IN_VERTEX_NAMES).filter(
      (id) => !FRAGMENT_OR_COMPUTE_CALLS.has(id) && !(id in VERTEX_GAPS),
    );
    expect(missing).toEqual([]);
  });

  // BY MEASUREMENT, not by set membership — which is what made this arm useful. While the ids
  // were still gaps it asked whether each PROGRAM compiled, not whether the id sat in some set,
  // so when #164 fixed it by adding the atomics to `FRAGMENT_OR_COMPUTE_CALLS` (a set the old
  // comment here predicted the fix would NOT touch) the arm fired anyway and named all ten.
  // Now that they are refused, the same witnesses read as the rule.
  it('refuses every atomic from a vertex entry, naming the id and the entry', () => {
    const accepted: string[] = [];
    for (const [id, witness] of Object.entries(ATOMIC_VERTEX_WITNESS)) {
      const errors = errorsOf(witness);
      if (errors.length === 0) {
        accepted.push(id);
        continue;
      }
      // The sentence has to name the author's own id and entry, not just refuse.
      if (!errors.some((m) => m.includes(`"${id}"`) && m.includes('"vs" is a vertex entry')))
        accepted.push(`${id}: ${errors.join(' / ')}`);
    }
    expect(
      accepted,
      'An atomic is not refused from a vertex entry, or is refused without naming it. WGSL: ' +
        '"Atomic built-in functions must not be used in a vertex shader stage" (wgsl.txt:25422).',
    ).toEqual([]);
  });

  it('keeps VERTEX_GAPS empty, so a new gap has to be added deliberately', () => {
    // A regression would be re-admitting an atomic in a vertex entry. The arm above catches
    // that directly; this one keeps the allowlist itself from quietly growing back.
    expect(Object.keys(VERTEX_GAPS)).toEqual([]);
  });

  it('refuses a compute-only builtin from a vertex and from a fragment entry', () => {
    // The barriers are gated at the call site (`lower/barriers.ts`) rather than through a set,
    // so this arm measures the behaviour instead of reading a constant.
    const ids = idsSpelling(COMPUTE_ONLY_NAMES);
    // `textureBarrier` joined the other two when #164 gave it an id.
    expect(ids).toEqual(['storageBarrier', 'textureBarrier', 'workgroupBarrier']);
    // The clause after the semicolon says what the entry LACKS, and it is per-builtin: a
    // texture barrier orders writes, the other two are waits. Pinned per id rather than
    // matched loosely, so rewording any of the three sentences fails here.
    const WHY: Readonly<Record<string, string>> = {
      storageBarrier: 'has no workgroup to wait for',
      workgroupBarrier: 'has no workgroup to wait for',
      textureBarrier: 'has no workgroup whose texture writes it could order',
    };
    for (const id of ids) {
      const fragment = `"use typeshade"
class V {
  @builtin("position") pos: vec4;
  @location(0) uv: vec2;
}
@fragment
export function fs(v: V): vec4 {
  ${id}()
  return vec4(0., 0., 0., 1.)
}
`;
      const vertex = `"use typeshade"
class Clip {
  @builtin("position") pos: vec4;
}
@vertex
export function vs(@builtin("vertex_index") i: u32): Clip {
  ${id}()
  return { pos: vec4(0., 0., 0., 1.) }
}
`;
      const compute = `"use typeshade"
@compute([64, 1, 1])
export function cs(@builtin("global_invocation_id") gid: vec3u): void {
  ${id}()
}
`;
      const why = WHY[id];
      expect(why, `${id} is compute-only with no pinned reason clause`).toBeDefined();
      expect(errorsOf(fragment), `${id} in a fragment entry`).toEqual([
        `${id}() belongs in a compute entry or a function it calls; a fragment entry ${why}.`,
      ]);
      expect(errorsOf(vertex), `${id} in a vertex entry`).toEqual([
        `${id}() belongs in a compute entry or a function it calls; a vertex entry ${why}.`,
      ]);
      expect(errorsOf(compute), `${id} in a compute entry`).toEqual([]);
    }
  });

  it('records the names whose overloads DISAGREE about the stage, which no id-level set can express', () => {
    // `textureLoad` on a sampled texture is legal in a vertex entry and on a WRITABLE storage
    // texture is not. The rule is per-overload, and `coredef-texture-overloads.test.ts` claims
    // each overload with its own witness. This arm exists so the class stays visible here.
    expect(MIXED_NAMES).toEqual(['textureDimensions', 'textureLoad', 'textureNumLayers']);
  });
});
