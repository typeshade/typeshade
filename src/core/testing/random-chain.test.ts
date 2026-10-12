// ═══ Generated chains of kernel calls, held to the fuse planner's facts and to the calls apart (change 0058) ═══
//
// A fuse scope (`typeshade/fuse`) fuses the consecutive calls the facts F1 to F6 allow into one
// dispatch. `generateChain` (`random-ir.ts`) draws chains of kernel calls over arrays the caller
// keeps, with scratch arrays among them and, in three chains of ten, a call that reduces.
// `fuse-chain.ts` makes of each what the scope works on: the face of every kernel function with
// its fuse record, the planner's groups with the scratch arrays it holds as locals, the fused
// entries and the calls run apart. This file holds the chains of the generator to three
// differentials. They are the half of the GPU differential's chain arm
// (`scripts/gpu-differential.ts`) that needs no GPU:
//
//   P  the groups the planner makes ≡ the groups the facts give for the chain as the generator
//      built it, the scratch arrays each holds as locals among them, and the planner's words for a
//      group that stands apart name the same fact. The dispatches the plan makes, a fold for each
//      level of partials of a reduction among them, ≡ the dispatches the facts give. The model
//      reads no fact the compiler wrote, so a fact the proof gets wrong shows here.
//   F  the groups run on the f32 oracle, a fused group as the entry the builder made and a
//      reduction through its loop and its folds, ≡ the calls run apart, every array a call writes
//      that the host reads and every result: bit for bit as the module is built and after `O1`,
//      and within a tolerance after `O2`, which may change a zero's sign. A scratch array is left
//      out of what is compared: the host never reads it.
//   C  the face made from IR ≡ the face the compiler writes from a source both can read, a
//      function that reduces and one that names a length among them, so that P and F speak about
//      the faces the runtime reads.
//
// Instrument first (AGENTS.md#gate-discipline): the corpus must reach chains of every length,
// every kind of element, each fact the planner refuses on, scratch arrays held as locals and kept
// as buffers for each clause of Rule 11.13, and reductions fused and apart; and P and F must
// notice what is wrong on purpose: a face with a wrong fact (a read at the counter, a reduction
// left out, a length not noticed), a pair the planner refused fused anyway, a scratch array held
// as a local against the facts, a scratch buffer that starts with words other than zeros, a fused
// group dispatched one iteration short, and a fused reduction whose last level of partials is not
// folded or whose partials are zeroed between the levels.
//
// Verifies: Rule 11.13 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { compile } from '../../compiler/ts/compile.js';
import { hostFace } from '../../compiler/ts/host-face.js';
import type { Group } from '../fuse-group.js';
import type { KernelFace } from '../host-kernel.js';
import { typeKey } from '../ir/types.js';
import { determinismReport } from '../passes/determinism.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import type { Stmt } from '../ir/index.js';
import type { OptLevel } from '../passes/opt/optimize.js';
import {
  contractAgainstFacts,
  dispatchesOf,
  foldChain,
  foldLevels,
  forgetsLength,
  forgetsReduction,
  groupCallsOf,
  inputsOf,
  lowerChain,
  lowerFace,
  modelGroups,
  planChain,
  plannedDispatches,
  readsAtCounter,
  reasonOf,
  runApart,
  runGrouped,
  scratchFates,
  scratchStencil,
  shapeOf,
  stencilChain,
  tripsOf,
  withScratchContents,
  type Fate,
  type GroupFault,
  type Lowered,
  type ModelGroup,
  type Outcome,
  type Reason,
  type ScalarOf,
  type Sizes,
} from './fuse-chain.js';
import { describeCorpus, generateChain, type ChainCorpus } from './random-ir.js';

const SEEDS = 50;

/** The sizes a chain runs at: one iteration and an `m` of two, a small count, and a count past one
 *  workgroup of 64 that is not a multiple of it. */
const SIZES: readonly Sizes[] = [
  { n: 1, m: 2 },
  { n: 7, m: 3 },
  { n: 70, m: 33 },
];

/** A chain with a call that reduces also runs at 300 iterations, past the workgroup of 256 that a
 *  reduction runs in: its loop makes two partials, and one more dispatch folds them. */
const BIG: Sizes = { n: 300, m: 129 };

/** The sizes a chain runs at. */
const sizesOf = (c: ChainCorpus): readonly Sizes[] =>
  c.calls.some((call) => call.reduces > 0) ? [...SIZES, BIG] : SIZES;

/** The storage buffers a dispatch may bind: the WebGPU default, which the planner takes too. */
const LIMIT = 8;

interface Built {
  readonly c: ChainCorpus;
  readonly lows: readonly Lowered[] | { readonly none: string };
}

const CHAINS: Built[] = Array.from({ length: SEEDS }, (_, i) => {
  const c = generateChain(i + 1, { exact: true });
  return { c, lows: lowerChain(c) };
});

/** The chains whose calls all lower, which is all of them: the first test holds it. */
const LOWERED = CHAINS.flatMap(({ c, lows }) => ('none' in lows ? [] : [{ c, lows }]));

// ── inputs ──────────────────────────────────────────────────────────────────────────────────

/** A scalar of `kind`: half the sweep at the boundaries where wrap, `x/0`, NaN and the sign of a
 *  zero live. The GPU differential draws the values it can hold bit for bit instead. */
const scalarOf: ScalarOf = (kind, rnd, boundary) => {
  if (kind === 'i32') {
    const pool = [0, 1, -1, 2, -2147483648, 2147483647, 255, -7];
    return boundary ? pool[Math.floor(rnd() * pool.length)]! : (Math.floor(rnd() * 4e9) - 2e9) | 0;
  }
  if (kind === 'u32') {
    const pool = [0, 1, 2, 4294967295, 2147483648, 255];
    return boundary ? pool[Math.floor(rnd() * pool.length)]! : Math.floor(rnd() * 4294967296) >>> 0;
  }
  const pool = [0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity, 1e-38, 3.4e38];
  return Math.fround(boundary ? pool[Math.floor(rnd() * pool.length)]! : (rnd() - 0.5) * 200);
};

// ── comparison ──────────────────────────────────────────────────────────────────────────────

/** Bit equality, element by element, through arrays and structs. */
function bitEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => bitEqual(v, b[i]));
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const ka = Object.keys(a);
    return (
      ka.length === Object.keys(b).length &&
      ka.every((k) =>
        bitEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
      )
    );
  }
  return Object.is(a, b);
}

/** Values within `relTol`, NaN ≡ NaN, a same-signed infinity ≡ itself and a zero ≡ either zero. */
function closeEnough(a: unknown, b: unknown, relTol: number): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => closeEnough(v, b[i], relTol));
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null)
    return Object.keys(a).every((k) =>
      closeEnough((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], relTol),
    );
  if (typeof a !== 'number' || typeof b !== 'number') return Object.is(a, b);
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= relTol * Math.max(1, Math.abs(a), Math.abs(b));
}

const show = (o: Outcome): string => JSON.stringify(o).slice(0, 200);

// ── the groups ──────────────────────────────────────────────────────────────────────────────

/** What a test needs of a chain at one size: the inputs, the planner's input and its groups. */
function planned(c: ChainCorpus, lows: readonly Lowered[], s: Sizes, variant: number) {
  const inputs = inputsOf(c, s, variant, scalarOf);
  const calls = groupCallsOf(c, lows, inputs);
  return { inputs, calls, groups: planChain(c, calls, LIMIT) };
}

/** Whether the planner's groups are the groups the facts give: the same calls, the same reason for
 *  each group that stands apart, and the same scratch arrays held as locals. */
function groupsAgree(got: readonly Group[], want: readonly ModelGroup[]): boolean {
  return (
    JSON.stringify(shapeOf(got)) === JSON.stringify(shapeOf(want)) &&
    got.every(
      (g, i) =>
        reasonOf(g.why) === want[i]!.because &&
        JSON.stringify(g.contracted.map((a) => (a as { id: string }).id).sort()) ===
          JSON.stringify([...want[i]!.contracted].sort()),
    )
  );
}

describe('generated chains of kernel calls, held to the facts and to the calls apart (change 0058)', () => {
  // ── the instrument check, first: a green run below means nothing without it ──
  it('every call lowers, and the corpus reaches chains of every length and every kind of element', () => {
    for (const { c, lows } of CHAINS)
      expect(
        'none' in lows ? lows.none : undefined,
        `chain seed ${String(c.seed)}`,
      ).toBeUndefined();
    const f = describeCorpus(LOWERED.map(({ c }) => c));
    console.log(
      `[0058 chains] ${String(LOWERED.length)} chains · ${String(f['chainCall'])} calls · features: ${JSON.stringify(f)}`,
    );
    for (const k of [
      'chainCall',
      'kernelLoop',
      'arrayRead',
      'shiftedRead',
      'structRead',
      'affineWrite',
      'stridedWrite',
      'conditionalWrite',
      'loopContinue',
      'callFn',
      'combine',
      'reducingCall',
      'scratchArray',
      'lengthRead',
    ])
      expect(f[k] ?? 0, `the corpus never generated '${k}'`).toBeGreaterThan(0);
    // The kernel functions scatter nowhere and carry no statement the proof refuses.
    for (const k of ['scatter', 'refusedRead', 'refusedScatter', 'refusedBreak'])
      expect(f[k] ?? 0, `a chain generated '${k}'`).toBe(0);
    expect(new Set(LOWERED.map(({ c }) => c.calls.length))).toEqual(new Set([2, 3, 4, 5, 6]));
    const elems = new Set(LOWERED.flatMap(({ c }) => c.arrays.map((a) => typeKey(a.elem))));
    for (const e of ['f32', 'i32', 'u32', 'vec2<f32>', 'vec3<f32>', 'vec4<f32>', 'struct:S0'])
      expect(elems.has(e), `no array of ${e}`).toBe(true);
    const calls = LOWERED.flatMap(({ c }) => c.calls);
    expect(calls.some((call) => call.args.some((a) => 'scalar' in a))).toBe(true);
    expect(calls.some((call) => call.start !== 0)).toBe(true);
    expect(calls.some((call) => call.step !== 1)).toBe(true);
    expect(calls.some((call) => call.over === 'm')).toBe(true);
    expect(calls.some((call) => call.continues)).toBe(true);
    // A call folds one variable and another folds two, and a scratch array holds each element a
    // scope makes.
    expect(new Set(calls.map((call) => call.reduces))).toEqual(new Set([0, 1, 2]));
    const scratch = new Set(
      LOWERED.flatMap(({ c }) => c.arrays.filter((a) => a.scratch).map((a) => typeKey(a.elem))),
    );
    expect(scratch).toEqual(new Set(['f32', 'i32', 'u32']));
    // A scratch array no call writes is one the generator draws, and so is a chain that reads
    // nothing it wrote as scratch.
    expect(
      LOWERED.some(({ c }) => c.arrays.some((a) => a.scratch && !a.written)),
      'no scratch array that no call writes',
    ).toBe(true);
    for (const { c } of LOWERED)
      expect(
        c.arrays.some((a) => a.written && !a.scratch),
        `chain seed ${String(c.seed)} leaves the host nothing to read`,
      ).toBe(true);
    // Every kind of fact the planner refuses on, and groups of two, three and four or more calls.
    const reasons = new Map<Reason, number>();
    const fused = new Set<number>();
    const fates = new Map<Fate, number>();
    let [reductions, fusedReductions, levels, ends] = [0, 0, 0, 0];
    for (const { c } of LOWERED) {
      if (c.calls[c.calls.length - 1]!.reduces > 0) ends++;
      for (const s of sizesOf(c)) {
        const model = modelGroups(c, s, LIMIT);
        for (const g of model) {
          if (g.because !== undefined) reasons.set(g.because, (reasons.get(g.because) ?? 0) + 1);
          if (g.calls.length > 1) fused.add(g.calls.length);
          const last = c.calls[g.calls[g.calls.length - 1]!]!;
          if (last.reduces > 0) {
            reductions++;
            if (g.calls.length > 1) fusedReductions++;
            levels += foldLevels(tripsOf(last, s));
          }
        }
        for (const fate of scratchFates(c, model).values())
          fates.set(fate, (fates.get(fate) ?? 0) + 1);
      }
    }
    console.log(
      `[0058 chains] groups apart: ${JSON.stringify([...reasons])} · fused of ${JSON.stringify([...fused].sort())} · scratch arrays: ${JSON.stringify([...fates])} · ${String(ends)} chains end in a reduction, ${String(reductions)} reductions run (${String(fusedReductions)} fused as the last call of a group) in ${String(levels)} fold levels`,
    );
    for (const r of [
      'continues',
      'empty',
      'reduces',
      'trips',
      'start',
      'step',
      'waw',
      'war',
      'read',
      'write',
      'limit',
    ] as const)
      expect(reasons.get(r) ?? 0, `no group stands apart for '${r}'`).toBeGreaterThan(0);
    for (const n of [2, 3]) expect(fused.has(n), `no fused group of ${String(n)}`).toBe(true);
    expect(Math.max(...fused), 'no fused group of four or more').toBeGreaterThanOrEqual(4);
    // A scratch array held as a local, and one kept as a buffer for each clause of Rule 11.13.
    for (const fate of ['local', 'outside', 'writers', 'offset', 'measured'] as const)
      expect(fates.get(fate) ?? 0, `no scratch array is '${fate}'`).toBeGreaterThan(0);
    // Reductions: chains that end in one, fused with the calls before it and apart, and a fold.
    expect(ends).toBeGreaterThan(3);
    expect(fusedReductions).toBeGreaterThan(3);
    expect(reductions - fusedReductions).toBeGreaterThan(0);
    expect(levels).toBeGreaterThan(0);
  });

  it('a chain is the same from its seed, and its float literals have a few bits each', () => {
    expect(JSON.stringify(generateChain(7, { exact: true }))).toBe(
      JSON.stringify(generateChain(7, { exact: true })),
    );
    expect(JSON.stringify(generateChain(7, { exact: true }))).not.toBe(
      JSON.stringify(generateChain(8, { exact: true })),
    );
    // The GPU differential holds a chain to the oracle bit for bit, which rests on the report of
    // `determinism.ts` listing nothing but order, and on no grouping of the arithmetic rounding a
    // sum or a product of the literals (#378).
    const rows = new Set<string>();
    const literals = new Set<number>();
    const walk = (st: Stmt): void =>
      eachStmtExpr(
        st,
        (e) =>
          eachExpr(e, (x) => {
            if (
              x.op === 'lit' &&
              typeof x.value === 'number' &&
              x.type.kind === 'scalar' &&
              x.type.scalar === 'f32'
            )
              literals.add(x.value);
          }),
        walk,
      );
    for (const { c } of CHAINS) {
      for (const r of determinismReport(c.module)) rows.add(`${r.op} ${r.elem} ${r.kind}`);
      for (const f of c.module.funcs) f.body.forEach(walk);
    }
    expect([...rows].filter((r) => !r.endsWith(' order'))).toEqual([]);
    expect(literals.size).toBeGreaterThan(4);
    for (const v of literals)
      expect(Number.isInteger(v * 8) && Math.abs(v) <= 1000, `${String(v)}`).toBe(true);
  });

  it('a face carries the facts the function was built with', () => {
    let arrays = 0;
    let measured = 0;
    for (const { c, lows } of LOWERED)
      c.calls.forEach((call, j) => {
        const loop = lows[j]!.face.fuse!.facts[0]!;
        const at = `seed ${String(c.seed)} ${call.fn}`;
        expect(lows[j]!.face.fuse!.facts, at).toHaveLength(1);
        expect([loop.reduces, loop.scatters, loop.continues], at).toEqual([
          call.reduces > 0,
          false,
          call.continues,
        ]);
        // A call that reduces carries the entry that folds its partials, and the variables it
        // folds are the ones it was built with.
        expect(loop.fold !== undefined, at).toBe(call.reduces > 0);
        expect(lows[j]!.face.gpu!.loops[0]!.reduce?.vars.length ?? 0, at).toBe(call.reduces);
        const want = call.access.flatMap((a) => {
          if (a.reads === 'none' && a.writes === 'none') return [];
          const access = a.writes === 'none' ? 'read' : a.reads === 'none' ? 'write' : 'readwrite';
          return [{ param: a.param, access, atI: a.reads !== 'shifted' && a.writes !== 'strided' }];
        });
        expect(
          loop.arrays.map(({ param, access, atI }) => ({ param, access, atI })),
          at,
        ).toEqual(want);
        // The first access that is not at the counter is worded, and only that one.
        for (const a of loop.arrays) expect(a.first === undefined, `${at} ${a.param}`).toBe(a.atI);
        // The arrays whose length the iteration names are the ones it was built to name.
        const names = call.access.filter((a) => a.measures).map((a) => a.param);
        expect((loop.bare ?? []).map((b) => b.param).sort(), at).toEqual(names.sort());
        measured += names.length;
        arrays += loop.arrays.length;
      });
    expect(arrays).toBeGreaterThan(200);
    expect(measured).toBeGreaterThan(10);
  });

  it('the range function gives the trip count the chain was built with', () => {
    let calls = 0;
    for (const { c, lows } of LOWERED)
      for (const s of sizesOf(c)) {
        const { calls: seen } = planned(c, lows, s, 0);
        c.calls.forEach((call, j) => {
          calls++;
          expect(
            seen[j]!.range!.n,
            `seed ${String(c.seed)} ${call.fn} at ${JSON.stringify(s)}`,
          ).toBe(tripsOf(call, s));
        });
      }
    expect(calls).toBeGreaterThan(500);
  });

  it('P: the planner makes the groups the facts give, for the facts it names', () => {
    let groups = 0;
    let locals = 0;
    for (const { c, lows } of LOWERED)
      for (const s of sizesOf(c)) {
        const { groups: got } = planned(c, lows, s, c.seed);
        const want = modelGroups(c, s, LIMIT);
        const at = `seed ${String(c.seed)} at ${JSON.stringify(s)}`;
        expect(shapeOf(got), at).toEqual(shapeOf(want));
        got.forEach((g, i) => {
          groups++;
          expect(reasonOf(g.why), `${at} group ${String(i)}: ${String(g.why)}`).toBe(
            want[i]!.because,
          );
          // The first group has nothing to stand apart from.
          expect(g.why === undefined, `${at} group ${String(i)}`).toBe(i === 0);
          // The scratch arrays the entry of the group holds as locals.
          expect(
            g.contracted.map((a) => (a as { id: string }).id).sort(),
            `${at} group ${String(i)}`,
          ).toEqual([...want[i]!.contracted].sort());
          locals += g.contracted.length;
        });
      }
    expect(groups).toBeGreaterThan(300);
    expect(locals).toBeGreaterThan(30);
  });

  it('P: the plan makes the dispatches the facts give, a fold for each level of a reduction', () => {
    let folds = 0;
    for (const { c, lows } of LOWERED)
      for (const s of sizesOf(c)) {
        const { inputs, calls, groups } = planned(c, lows, s, c.seed);
        const want = dispatchesOf(c, s, modelGroups(c, s, LIMIT));
        expect(
          plannedDispatches(c, lows, calls, groups, inputs),
          `seed ${String(c.seed)} at ${JSON.stringify(s)}`,
        ).toBe(want);
        if (c.calls.some((call) => call.reduces > 0) && s === BIG) folds += want;
      }
    expect(folds).toBeGreaterThan(30);
    // A loop makes a partial for each 256 iterations, and a dispatch folds 256 partials into one.
    expect([0, 1, 256, 257, 300, 65536, 65537, 70000].map(foldLevels)).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2,
    ]);
  });

  it('a scratch array is left out of what a chain compares, and starts as zeros', () => {
    let left = 0;
    for (const { c, lows } of LOWERED) {
      const { inputs } = planned(c, lows, SIZES[1]!, c.seed);
      const got = runApart(c, inputs, 'f32');
      expect(Object.keys(got.arrays).sort(), `seed ${String(c.seed)}`).toEqual(
        c.arrays
          .filter((a) => a.written && !a.scratch)
          .map((a) => a.id)
          .sort(),
      );
      for (const a of c.arrays.filter((x) => x.scratch)) {
        left++;
        expect(inputs.arrays.get(a.id)!.every((v) => v === 0)).toBe(true);
      }
    }
    expect(left).toBeGreaterThan(50);
  });

  // The oracle runs a fused module slowly (a reduction dispatches workgroups of 256), so the
  // module as built runs at every size, and the passes of `O1` and `O2` at 70 iterations, for the
  // chains that only map. `fuse-entry.test.ts` runs fused reductions through every level.
  const LEVELS: readonly (OptLevel | undefined)[] = [undefined, 'O1', 'O2'];
  const same = (
    c: ChainCorpus,
    lows: readonly Lowered[],
    s: Sizes,
    level: OptLevel | undefined,
  ): { planned: ReturnType<typeof planned>; ok: boolean; text: string } => {
    const p = planned(c, lows, s, c.seed);
    const want = runApart(c, p.inputs, 'f32');
    const got = runGrouped(
      c,
      lows,
      p.calls,
      p.groups,
      p.inputs,
      level === undefined ? {} : { level },
    );
    return {
      planned: p,
      ok: level === 'O2' ? closeEnough(want, got, 1e-9) : bitEqual(want, got),
      text: `seed ${String(c.seed)} at ${JSON.stringify(s)} ${level ?? 'as built'}: ${show(want)} ≠ ${show(got)}`,
    };
  };

  it('F: the groups of chains that map, run on the oracle, give what the calls give apart', () => {
    let fusedRuns = 0;
    let localRuns = 0;
    for (const { c, lows } of LOWERED) {
      if (c.calls.some((call) => call.reduces > 0)) continue;
      for (const s of SIZES.slice(1))
        for (const level of s === SIZES[1] ? [undefined] : LEVELS) {
          const r = same(c, lows, s, level);
          if (r.planned.groups.some((g) => g.fused)) fusedRuns++;
          if (r.planned.groups.some((g) => g.contracted.length > 0)) localRuns++;
          expect(r.ok, r.text).toBe(true);
        }
    }
    console.log(
      `[0058 chains F] ${String(fusedRuns)} runs of a plan with a fused group, ${String(localRuns)} with a scratch array held as a local`,
    );
    expect(fusedRuns).toBeGreaterThan(60);
    expect(localRuns).toBeGreaterThan(20);
  });

  it('F: the groups of chains that reduce, run on the oracle, give what the calls give apart', () => {
    let reductionRuns = 0;
    let localRuns = 0;
    for (const { c, lows } of LOWERED) {
      if (!c.calls.some((call) => call.reduces > 0)) continue;
      // The loop of a reduction runs in one workgroup of 256 at 7 and at 70 iterations alike.
      for (const s of [SIZES[2]!, BIG]) {
        const r = same(c, lows, s, undefined);
        if (
          r.planned.groups.some(
            (g) => g.fused && c.calls[g.calls[g.calls.length - 1]!]!.reduces > 0,
          )
        )
          reductionRuns++;
        if (r.planned.groups.some((g) => g.contracted.length > 0)) localRuns++;
        expect(r.ok, r.text).toBe(true);
      }
    }
    console.log(
      `[0058 chains F] ${String(reductionRuns)} runs of a plan with a reduction fused as the last call, ${String(localRuns)} with a scratch array held as a local`,
    );
    expect(reductionRuns).toBeGreaterThan(10);
    expect(localRuns).toBeGreaterThan(5);
  });

  // ── what the comparisons must see ──
  it('P notices a face with a wrong fact: every read at the counter', () => {
    let reported = 0;
    for (const { c, lows } of LOWERED)
      for (const s of SIZES.slice(1)) {
        const want = modelGroups(c, s, LIMIT);
        if (!want.some((g) => g.because === 'read')) continue;
        const lies = lows.map(readsAtCounter);
        const { groups } = planned(c, lies, s, c.seed);
        // The planner fuses what the wrong fact lets it, and the facts give another grouping.
        if (!groupsAgree(groups, want)) reported++;
      }
    expect(reported).toBeGreaterThan(0);
  });

  it('P notices a face that forgets a reduction: a call joins after it', () => {
    let reported = 0;
    for (const { c, lows } of LOWERED) {
      if (!c.calls.some((call) => call.reduces > 0)) continue;
      for (const s of sizesOf(c).slice(1)) {
        const lies = lows.map((low, j) => (c.calls[j]!.reduces > 0 ? forgetsReduction(low) : low));
        const { groups } = planned(c, lies, s, c.seed);
        if (!groupsAgree(groups, modelGroups(c, s, LIMIT))) reported++;
      }
    }
    expect(reported).toBeGreaterThan(0);
  });

  it('P notices a face that forgets a length read: a measured scratch array held as a local', () => {
    let reported = 0;
    for (const { c, lows } of LOWERED) {
      if (!c.calls.some((call) => call.access.some((a) => a.measures))) continue;
      for (const s of SIZES.slice(1)) {
        const { groups } = planned(c, lows.map(forgetsLength), s, c.seed);
        if (!groupsAgree(groups, modelGroups(c, s, LIMIT))) reported++;
      }
    }
    expect(reported).toBeGreaterThan(0);
  });

  it('F notices a pair the planner refused, fused anyway', () => {
    // A call that reads another index of an array the call before it wrote, run in the same
    // dispatch, reads what its own invocation wrote or what another has not written yet. It
    // changes a value only where the call uses what it reads, which a few chains in a hundred do,
    // so chains are drawn until one does.
    let found: string | undefined;
    for (let seed = 1; found === undefined && seed <= 600; seed++) {
      const c = generateChain(seed, { exact: true });
      const s = SIZES[2]!;
      const at = modelGroups(c, s, LIMIT).findIndex(
        (g, i) => g.because === 'read' && modelGroups(c, s, LIMIT)[i - 1]!.calls.length === 1,
      );
      if (at < 1) continue;
      const lows = lowerChain(c);
      if ('none' in lows) continue;
      const { inputs, calls, groups } = planned(c, lows, s, seed);
      // The singleton before it, and the first call of the group the planner refused.
      const [m, rest] = [groups[at - 1]!.calls[0]!, groups[at]!.calls];
      const forced = [
        ...groups.slice(0, at - 1),
        { calls: [m, rest[0]!] },
        ...(rest.length > 1 ? [{ calls: rest.slice(1) }] : []),
        ...groups.slice(at + 1),
      ];
      // The planner's own locals belong to its own groups, so a forced plan runs with none.
      try {
        if (!bitEqual(runApart(c, inputs, 'f32'), runGrouped(c, lows, calls, forced, inputs)))
          found = `seed ${String(seed)}`;
      } catch {
        // The builder refused the pair, or a call names an array a group of the planner holds as
        // a local: this chain is no instrument.
      }
    }
    expect(
      found,
      'no chain of the first 600 gives other values when a refused read is fused',
    ).toBeDefined();
  });

  it('F notices a scratch array held as a local against the facts', () => {
    // `stencil` reads the scratch array `t` at `i` and at `i ^ 1`, an element another invocation
    // writes, so the planner keeps it apart from `produce`, which wrote `t`, and holds nothing as
    // a local. An entry that holds `t` as a local gives `stencil` the element `produce` wrote for
    // `i` in the place of its pair's.
    const c = stencilChain();
    const lows = lowerChain(c);
    if ('none' in lows) throw new Error(lows.none);
    const s: Sizes = { n: 70, m: 33 };
    const { inputs, calls, groups } = planned(c, lows, s, 1);
    expect(shapeOf(groups)).toEqual([[0], [1]]);
    expect(groups[1]!.why).toMatch(
      /^produce and stencil run as two dispatches because stencil reads `t\[i \^ 1\]` \(line \d+\)$/,
    );
    expect(groups.map((g) => g.contracted)).toEqual([[], []]);
    const model = modelGroups(c, s, LIMIT);
    expect(groupsAgree(groups, model)).toBe(true);
    const stencil = scratchStencil(c, model)!;
    expect(stencil.array.id).toBe('x0');
    const want = runApart(c, inputs, 'f32');
    // The plan as the planner makes it gives what the calls give apart.
    expect(bitEqual(want, runGrouped(c, lows, calls, groups, inputs))).toBe(true);
    // Held as a local against the facts, it does not.
    const forced = contractAgainstFacts(groups, stencil);
    expect(forced.map((g) => [g.calls, (g.contracted ?? []).length])).toEqual([[[0, 1], 1]]);
    expect(bitEqual(want, runGrouped(c, lows, calls, forced, inputs))).toBe(false);
  });

  it('F notices a scratch buffer that starts with words other than zeros', () => {
    // A scratch array holds zeros when the plan starts. Where a call writes it under a condition,
    // or reads it before it is written, the elements it leaves are what the next call reads.
    let changed = 0;
    for (const { c, lows } of LOWERED) {
      if (changed > 3) break;
      const { inputs, calls, groups } = planned(c, lows, SIZES[2]!, c.seed);
      const dirty = withScratchContents(c, inputs, 1, scalarOf);
      // The plan as it is holds the calls apart's answer from zeros, and not from other words.
      const clean = runGrouped(c, lows, calls, groups, inputs);
      expect(bitEqual(runApart(c, inputs, 'f32'), clean), `seed ${String(c.seed)}`).toBe(true);
      if (!bitEqual(clean, runGrouped(c, lows, calls, groups, dirty))) changed++;
    }
    expect(changed).toBeGreaterThan(3);
  });

  it('F notices a fused group dispatched one iteration short', () => {
    const fault: GroupFault = 'skip-first-iteration';
    let skipped = 0;
    for (const { c, lows } of LOWERED) {
      if (skipped > 10) break;
      const { inputs, calls, groups } = planned(c, lows, SIZES[2]!, c.seed);
      if (!groups.some((g) => g.fused)) continue;
      if (
        !bitEqual(runApart(c, inputs, 'f32'), runGrouped(c, lows, calls, groups, inputs, { fault }))
      )
        skipped++;
    }
    expect(skipped).toBeGreaterThan(10);
  });

  it.each<GroupFault>(['drop-last-level', 'zero-partials'])(
    'F notices a fused reduction dispatched wrong (%s)',
    (fault) => {
      // The loop makes two partials at 300 iterations, and one fold makes the value of them. A
      // fold that is not dispatched leaves the slot it would write as zeros, and partials zeroed
      // after the loop leave the fold nothing to fold. Either changes the result wherever the
      // variable is not the operator's identity.
      let found = 0;
      for (const { c, lows } of LOWERED) {
        if (found > 3) break;
        const { inputs, calls, groups } = planned(c, lows, BIG, c.seed);
        const g = groups.find((x) => x.fused && c.calls[x.calls[x.calls.length - 1]!]!.reduces > 0);
        if (g === undefined || foldLevels(tripsOf(c.calls[g.calls[0]!]!, BIG)) === 0) continue;
        const want = runApart(c, inputs, 'f32');
        expect(
          bitEqual(want, runGrouped(c, lows, calls, groups, inputs)),
          `seed ${String(c.seed)}`,
        ).toBe(true);
        if (!bitEqual(want, runGrouped(c, lows, calls, groups, inputs, { fault }))) found++;
      }
      expect(found).toBeGreaterThan(3);
    },
  );

  // ── C ──
  it('C: the face made from IR is the face the compiler writes from the source', () => {
    const fileName = '/app/ops.shade.ts';
    const source = `"use typeshade";
function act(x: f32): f32 { return x * x + 1.; }
export function square(out: array<f32>, x: array<f32>, k: f32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = act(x[i]) * k;
  }
}
export function blur(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 1; i < out.length; i++) {
    out[i] = x[i] + x[i - 1];
  }
}
export function stride(out: array<f32>, x: array<f32>): void {
  for (let i: u32 = 0; i < x.length; i++) {
    out[2 * i] = x[i];
  }
}
export function bump(xs: array<f32>): void {
  for (let i: u32 = 0; i < xs.length; i++) {
    xs[i] = xs[i] + 1.;
  }
}
export function pick(out: array<vec2<f32>>, a: array<vec2<f32>>, w: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    if (w[i] > 0.) {
      out[i] = a[(i + 1) % a.length];
    }
  }
}
export function measured(out: array<f32>, t: array<f32>): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = t[i] + f32(t.length);
  }
}
export function total(xs: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}
export function stats(out: array<f32>, xs: array<vec2<f32>>): f32 {
  let s: vec2<f32> = vec2<f32>(0., 0.);
  let hi: f32 = -1000.;
  for (let i: u32 = 0; i < xs.length; i++) {
    out[i] = xs[i].x * 2.;
    s += xs[i];
    hi = max(hi, xs[i].y);
  }
  return s.x + hi;
}
`;
    const made = hostFace(source, {
      fileName,
      runtime: resolve(__dirname, '..', 'host-runtime.ts'),
      fuse: true,
    });
    expect(made.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const r = compile(source, { fileName });
    const faces = new Map<string, KernelFace>();
    for (const e of made.exports ?? []) if (e.kind === 'kernel') faces.set(e.name, e.face);
    expect([...faces.keys()]).toEqual([
      'square',
      'blur',
      'stride',
      'bump',
      'pick',
      'measured',
      'total',
      'stats',
    ]);
    for (const [name, face] of faces) {
      const mine = lowerFace(r.module, name, fileName);
      expect('none' in mine ? mine.none : undefined, name).toBeUndefined();
      if ('none' in mine) continue;
      const f = mine.face;
      expect(f.params, name).toEqual(face.params);
      expect(f.gpu, name).toEqual(face.gpu);
      expect(f.fuse, name).toEqual(face.fuse);
      expect(f.result, name).toEqual(face.result);
    }
    // The three it adds say what they are: a function that names a length, one that reduces a
    // variable, and one that reduces two beside a write.
    const fact = (name: string) => faces.get(name)!.fuse!.facts[0]!;
    expect(fact('measured').bare?.map((b) => [b.param, b.first.text])).toEqual([['t', 't.length']]);
    expect([fact('total').reduces, fact('total').fold !== undefined]).toEqual([true, true]);
    expect(faces.get('total')!.gpu!.loops[0]!.reduce!.vars).toHaveLength(1);
    expect(faces.get('stats')!.gpu!.loops[0]!.reduce!.vars).toHaveLength(2);
    expect(fact('stats').arrays.map((a) => [a.param, a.access])).toEqual([
      ['out', 'write'],
      ['xs', 'read'],
    ]);
  });
});

describe('the chains built from source', () => {
  it('fuse a reduction with the call before it, and fold it in two levels at 70000 iterations', () => {
    const s: Sizes = { n: 70000, m: 4000 };
    for (const fused of [true, false]) {
      const c = foldChain(fused);
      const lows = lowerChain(c);
      if ('none' in lows) throw new Error(lows.none);
      const { inputs, calls, groups } = planned(c, lows, s, 1);
      const model = modelGroups(c, s, LIMIT);
      expect(groupsAgree(groups, model)).toBe(true);
      // `scale`, the scratch array `t` and `total` are one dispatch, and `total` alone is one;
      // then the loop's 274 partials, 2 of them and 1.
      expect(shapeOf(groups)).toEqual(fused ? [[0, 1]] : [[0]]);
      expect(groups.flatMap((g) => g.contracted.map((a) => (a as { id: string }).id))).toEqual(
        fused ? ['x0'] : [],
      );
      expect(plannedDispatches(c, lows, calls, groups, inputs)).toBe(3);
      expect(dispatchesOf(c, s, model)).toBe(3);
    }
  });
});
