// ═══ Generated chains of kernel calls, held to the fuse planner's facts and to the calls apart (change 0058) ═══
//
// A fuse scope (`typeshade/fuse`) fuses the consecutive calls the facts F1 to F5 allow into one
// dispatch. `generateChain` (`random-ir.ts`) draws chains of kernel calls over arrays the caller
// keeps, and `fuse-chain.ts` makes of each what the scope works on: the face of every kernel
// function with its fuse record, the planner's groups, the fused entries and the calls run apart.
// This file holds the chains of the generator to three differentials. They are the half of the
// GPU differential's chain arm (`scripts/gpu-differential.ts`) that needs no GPU:
//
//   P  the groups the planner makes ≡ the groups the facts give for the chain as the generator
//      built it, and the planner's words for a group that stands apart name the same fact. The
//      model reads no fact the compiler wrote, so a fact the proof gets wrong shows here.
//   F  the groups run on the f32 oracle, a fused group as the entry the builder made, ≡ the
//      calls run apart, every array a call writes and every result: bit for bit as the module is
//      built and after `O1`, and within a tolerance after `O2`, which may change a zero's sign.
//   C  the face made from IR ≡ the face the compiler writes from a source both can read, so that
//      P and F speak about the faces the runtime reads.
//
// Instrument first (AGENTS.md#gate-discipline): the corpus must reach chains of every length,
// every kind of element, and each fact the planner refuses on; and P and F must notice what is
// wrong on purpose: a face with a wrong fact, a pair the planner refused fused anyway, and a fused
// group dispatched one iteration short.
//
// It carries no rule tag yet: the rule it verifies is written by a later step of the change, which
// tags this file then (`reqs/README.md`).

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { compile } from '../../compiler/ts/compile.js';
import { hostFace } from '../../compiler/ts/host-face.js';
import { groupCalls } from '../fuse-group.js';
import type { KernelFace } from '../host-kernel.js';
import { typeKey } from '../ir/types.js';
import { determinismReport } from '../passes/determinism.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import type { Stmt } from '../ir/index.js';
import type { OptLevel } from '../passes/opt/optimize.js';
import {
  groupCallsOf,
  inputsOf,
  lowerChain,
  lowerFace,
  modelGroups,
  readsAtCounter,
  reasonOf,
  runApart,
  runGrouped,
  shapeOf,
  tripsOf,
  type GroupFault,
  type Lowered,
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
  return { inputs, calls, groups: groupCalls(calls, LIMIT) };
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
    ])
      expect(f[k] ?? 0, `the corpus never generated '${k}'`).toBeGreaterThan(0);
    // The kernel functions have no reduction, no scatter and no statement the proof refuses.
    for (const k of ['combine', 'scatter', 'refusedRead', 'refusedScatter', 'refusedBreak'])
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
    // Every kind of fact the planner refuses on, and groups of two, three and four or more calls.
    const reasons = new Map<Reason, number>();
    const fused = new Set<number>();
    for (const { c } of LOWERED)
      for (const s of SIZES)
        for (const g of modelGroups(c, s, LIMIT)) {
          if (g.because !== undefined) reasons.set(g.because, (reasons.get(g.because) ?? 0) + 1);
          if (g.calls.length > 1) fused.add(g.calls.length);
        }
    console.log(
      `[0058 chains] groups apart: ${JSON.stringify([...reasons])} · fused of ${JSON.stringify([...fused].sort())}`,
    );
    for (const r of [
      'continues',
      'empty',
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
    for (const { c, lows } of LOWERED)
      c.calls.forEach((call, j) => {
        const loop = lows[j]!.face.fuse!.facts[0]!;
        const at = `seed ${String(c.seed)} ${call.fn}`;
        expect(lows[j]!.face.fuse!.facts, at).toHaveLength(1);
        expect([loop.reduces, loop.scatters, loop.continues], at).toEqual([
          false,
          false,
          call.continues,
        ]);
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
        arrays += loop.arrays.length;
      });
    expect(arrays).toBeGreaterThan(200);
  });

  it('the range function gives the trip count the chain was built with', () => {
    let calls = 0;
    for (const { c, lows } of LOWERED)
      for (const s of SIZES) {
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
    for (const { c, lows } of LOWERED)
      for (const s of SIZES) {
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
        });
      }
    expect(groups).toBeGreaterThan(300);
  });

  it('F: the groups run on the oracle give what the calls give apart', () => {
    const LEVELS: readonly (OptLevel | undefined)[] = [undefined, 'O1', 'O2'];
    let fusedRuns = 0;
    for (const { c, lows } of LOWERED)
      for (const s of SIZES.slice(1)) {
        const { inputs, calls, groups } = planned(c, lows, s, c.seed);
        const want = runApart(c, inputs, 'f32');
        for (const level of LEVELS) {
          const got = runGrouped(
            c,
            lows,
            calls,
            groups,
            inputs,
            level === undefined ? {} : { level },
          );
          if (groups.some((g) => g.fused)) fusedRuns++;
          const same = level === 'O2' ? closeEnough(want, got, 1e-9) : bitEqual(want, got);
          expect(
            same,
            `seed ${String(c.seed)} at ${JSON.stringify(s)} ${level ?? 'as built'}: ${show(want)} ≠ ${show(got)}`,
          ).toBe(true);
        }
      }
    console.log(`[0058 chains F] ${String(fusedRuns)} runs of a plan with a fused group`);
    expect(fusedRuns).toBeGreaterThan(150);
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
        if (JSON.stringify(shapeOf(groups)) !== JSON.stringify(shapeOf(want))) reported++;
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
      if (!bitEqual(runApart(c, inputs, 'f32'), runGrouped(c, lows, calls, forced, inputs)))
        found = `seed ${String(seed)}`;
    }
    expect(
      found,
      'no chain of the first 600 gives other values when a refused read is fused',
    ).toBeDefined();
  });

  it('F notices a fused group dispatched one iteration short', () => {
    const fault: GroupFault = 'skip-first-iteration';
    let skipped = 0;
    for (const { c, lows } of LOWERED) {
      const { inputs, calls, groups } = planned(c, lows, SIZES[2]!, c.seed);
      if (!groups.some((g) => g.fused)) continue;
      if (
        !bitEqual(runApart(c, inputs, 'f32'), runGrouped(c, lows, calls, groups, inputs, { fault }))
      )
        skipped++;
    }
    expect(skipped).toBeGreaterThan(10);
  });

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
    expect([...faces.keys()]).toEqual(['square', 'blur', 'stride', 'bump', 'pick']);
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
  });
});
