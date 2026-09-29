// ═══ Generated kernel functions, held to the oracle (#349) ═══
//
// `random-ir-differential.test.ts` holds the CPU walks to each other on generated helpers, which
// take and return values. A kernel function (Rule 8.22) is made of what those never reach: arrays
// the caller owns, loops over a runtime length, reductions and scatters. This file holds the
// generated kernel functions of `generateKernelModule` to the same differentials, and adds the
// one only a kernel function has: the plan `lowerKernel` makes for the GPU, run on the oracle.
//
//   A    the interpreter ≡ the codegen, bit for bit, in f64 and in f32;
//   B    O1 is bit-exact, and O2 is within tolerance;
//   S    the stepping walk ≡ the interpreter;
//   L    the lowered plan on the f32 oracle ≡ the function on the f32 oracle, bit for bit, since
//        Rule 7.2 folds a reduction in one tree on every tier (`kernel-plan.ts`).
//
// Each call compares the result and every array after it. `Object.is` per element, so NaN ≡ NaN
// and −0 ≢ +0. An f32 input is an f32 value, as a buffer holds it: the oracle's f32 mode rounds
// operations, not the arguments it is handed.
//
// Instrument first (AGENTS.md#gate-discipline): the corpus must reach each construct, loops the
// proof accepts and loops it refuses, and plans that lower with a reduction and with a scatter;
// and L must notice a plan run wrong on purpose.

import { describe, expect, it } from 'vitest';
import type { ShaderType, StructDecl } from '../ir/index.js';
import { compileModule, type CpuModule, type CpuValue } from '../oracle.js';
import { compileModuleJs } from '../cpu-codegen.js';
import { optimizeAt } from '../passes/opt/optimize.js';
import { proveKernels } from '../passes/parallel-loop.js';
import { lowerKernel, type KernelPlan } from '../passes/kernel-lower.js';
import { startDebugSession } from '../debug/session.js';
import {
  describeCorpus,
  generateKernelModule,
  mulberry32,
  type KernelCorpus,
} from './random-ir.js';
import { copy, runKernelPlan, type KernelRun, type PlanFault } from './kernel-plan.js';
import { determinismReport } from '../passes/determinism.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import type { Stmt } from '../ir/index.js';

const SEEDS = 24;
/** Seeds that caught a defect, kept in the corpus whatever the sweep. */
const PINNED_SEEDS = [
  // #361: two loops scatter into one array with different operators, and the lowering gave each
  // write the last loop's atomic. L caught it on seeds 17, 25, 92, 125, 164, 168 and 200 of 200.
  17, 25, 92,
  // #362: the stepping walk folded a loop's float reduction in iteration order, and every tier folds
  // it in Rule 7.2's tree. In f64 no other seed of the sweep shows the difference, which needs
  // arrays of 7: S caught it on 35 and 51, and in f32 on 11 as well.
  35,
  51,
] as const;

/** Array lengths `[n, h]`: every array but a scatter target holds `n`, a scatter target `h`.
 *  300 is past one workgroup of 256, so a reduction's partials are folded a level. */
const SIZES = [
  [1, 1],
  [7, 3],
  [300, 13],
] as const;

interface Case {
  readonly c: KernelCorpus;
  /** The plan the call dispatches, when every loop lowers. */
  readonly plan?: KernelPlan;
  /** The loops the proof accepted and refused. */
  readonly accepted: number;
  readonly refused: number;
}

const CASES: Case[] = [
  ...Array.from({ length: SEEDS }, (_, i) => i + 1),
  ...PINNED_SEEDS.filter((s) => s > SEEDS),
].map((seed) => {
  const c = generateKernelModule(seed);
  const proof = proveKernels(c.module).find((p) => p.fn === c.kernel)!;
  const f = c.module.funcs.find((x) => x.name === c.kernel)!;
  const plan =
    proof.shape === undefined && proof.loops.every((l) => l.ok)
      ? lowerKernel(f, c.module, proof)
      : undefined;
  return {
    c,
    ...(plan !== undefined && !('noGpu' in plan) ? { plan } : {}),
    accepted: proof.loops.filter((l) => l.ok).length,
    refused: proof.loops.filter((l) => !l.ok).length,
  };
});

// ── inputs ──────────────────────────────────────────────────────────────────────────────────

function isFloat(t: ShaderType): boolean {
  return t.kind === 'scalar' && t.scalar === 'f32';
}

/** A scalar of `s`: half the sweep at the boundaries where wrap, `x/0` and NaN live. */
function scalarOf(s: string, rnd: () => number, boundary: boolean): number {
  if (s === 'i32') {
    const pool = [0, 1, -1, 2, -2147483648, 2147483647, 255, -7];
    return boundary ? pool[Math.floor(rnd() * pool.length)]! : (Math.floor(rnd() * 4e9) - 2e9) | 0;
  }
  if (s === 'u32') {
    const pool = [0, 1, 2, 4294967295, 2147483648, 255];
    return boundary ? pool[Math.floor(rnd() * pool.length)]! : Math.floor(rnd() * 4294967296) >>> 0;
  }
  const pool = [0, -0, 1, -1, 0.5, NaN, Infinity, -Infinity, 1e-38, 3.4e38];
  return Math.fround(boundary ? pool[Math.floor(rnd() * pool.length)]! : (rnd() - 0.5) * 200);
}

function valueOf(
  t: ShaderType,
  structs: ReadonlyMap<string, StructDecl>,
  rnd: () => number,
  boundary: boolean,
): CpuValue {
  if (t.kind === 'scalar') return scalarOf(t.scalar, rnd, boundary);
  if (t.kind === 'vec') return Array.from({ length: t.n }, () => scalarOf(t.elem, rnd, boundary));
  if (t.kind === 'struct')
    return Object.fromEntries(
      structs.get(t.name)!.fields.map((f) => [f.name, valueOf(f.type, structs, rnd, boundary)]),
    );
  throw new Error(`no generated value of ${t.kind}`);
}

/** The kernel function's arguments, in parameter order, for arrays of `n` (a scatter target `h`). */
function argsOf(c: KernelCorpus, n: number, h: number, boundary: boolean): CpuValue[] {
  const rnd = mulberry32(c.seed * 7919 + n * 31 + h + (boundary ? 1 : 0));
  const structs = new Map(c.module.structs.map((s) => [s.name, s]));
  const f = c.module.funcs.find((x) => x.name === c.kernel)!;
  return f.params.map((p) => {
    if (p.type.kind !== 'array') return valueOf(p.type, structs, rnd, boundary);
    const elem = p.type.elem;
    const length = c.arrays.find((a) => a.name === p.name)!.role === 'scatter' ? h : n;
    return Array.from({ length }, () =>
      valueOf(elem, structs, rnd, boundary),
    ) as unknown as CpuValue;
  });
}

/** Every call of the sweep: each case, each size, each half of the input pool. */
function* sweep(): Generator<{ k: Case; args: CpuValue[]; key: string }> {
  for (const k of CASES)
    for (const [n, h] of SIZES)
      for (const boundary of [false, true])
        yield {
          k,
          args: argsOf(k.c, n, h, boundary),
          key: `seed ${String(k.c.seed)} n=${String(n)} h=${String(h)}${boundary ? ' boundary' : ''}`,
        };
}

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

/** Values within `relTol`, NaN ≡ NaN and a same-signed infinity ≡ itself. */
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

/** Call the kernel function on its own copy of `args`: its result and the arrays after it. */
function call(cpu: CpuModule, c: KernelCorpus, args: readonly CpuValue[]): KernelRun {
  const values = args.map(copy);
  const result = cpu.fns[c.kernel]!(...values);
  return { result, arrays: values.slice(0, c.arrays.length) };
}

const show = (r: KernelRun): string =>
  `${JSON.stringify(r.result)} ${JSON.stringify(r.arrays).slice(0, 160)}`;

/** Every call of the sweep on two engines; up to 8 disagreements, and how many calls it made. */
function differential(
  a: (k: Case) => CpuModule,
  b: (k: Case) => CpuModule,
  same: (x: KernelRun, y: KernelRun) => boolean = bitEqual,
): { divergences: string[]; checks: number } {
  const divergences: string[] = [];
  let checks = 0;
  const engines = new Map<Case, [CpuModule, CpuModule]>();
  for (const { k, args, key } of sweep()) {
    let pair = engines.get(k);
    if (pair === undefined) engines.set(k, (pair = [a(k), b(k)]));
    const x = call(pair[0], k.c, args);
    const y = call(pair[1], k.c, args);
    checks++;
    if (!same(x, y) && divergences.length < 8) divergences.push(`${key}: ${show(x)} ≠ ${show(y)}`);
  }
  return { divergences, checks };
}

/** Every call of the sweep whose kernel lowers, through its plan against the function, both on
 *  the f32 oracle. With a fault, it stops at the first disagreement: one is all it has to show. */
function lowering(fault?: PlanFault): { divergences: string[]; checks: number } {
  const divergences: string[] = [];
  let checks = 0;
  const oracles = new Map<Case, CpuModule>();
  for (const { k, args, key } of sweep()) {
    if (k.plan === undefined) continue;
    if (fault !== undefined && divergences.length > 0) break;
    let oracle = oracles.get(k);
    if (oracle === undefined)
      oracles.set(k, (oracle = compileModule(k.c.module, { precision: 'f32' })));
    const want = call(oracle, k.c, args);
    const got = runKernelPlan(k.c.module, k.c.kernel, k.plan, args, fault);
    checks++;
    if (!bitEqual(want, got) && divergences.length < 8)
      divergences.push(`${key}: function ${show(want)} ≠ plan ${show(got)}`);
  }
  return { divergences, checks };
}

describe('generated kernel functions, held to the oracle (#349)', () => {
  // ── the instrument check, first: a green run below means nothing without it ──
  it('the corpus reaches arrays, loops over a length, reductions, scatters and structs', () => {
    const f = describeCorpus(CASES.map((k) => k.c));
    console.log(`[#349] ${String(CASES.length)} kernel functions · features: ${JSON.stringify(f)}`);
    for (const k of [
      'kernelLoop',
      'arrayRead',
      'shiftedRead',
      'structRead',
      'affineWrite',
      'structWrite',
      'fieldWrite',
      'conditionalWrite',
      'loopContinue',
      'combine+',
      'combine*',
      'combinemin',
      'combinemax',
      'combine&',
      'combine|',
      'combine^',
      'vecCombine',
      'scatter+',
      'scatter&',
      'scatter|',
      'scatter^',
      'refusedRead',
      'refusedScatter',
      'refusedBreak',
    ])
      expect(f[k] ?? 0, `the corpus never generated '${k}'`).toBeGreaterThan(0);
    // Loops the proof accepts and loops it refuses, so both the lowering and the CPU path of a
    // refused loop are run.
    expect(CASES.reduce((n, k) => n + k.accepted, 0)).toBeGreaterThan(20);
    expect(CASES.reduce((n, k) => n + k.refused, 0)).toBeGreaterThan(3);
    // Plans that lower, with a reduction folded a level and with a scatter's atomics.
    const plans = CASES.flatMap((k) => (k.plan === undefined ? [] : [k.plan]));
    expect(plans.length).toBeGreaterThan(12);
    expect(plans.filter((p) => p.loops.some((l) => l.reduce !== undefined)).length).toBeGreaterThan(
      8,
    );
    expect(
      plans.filter((p) =>
        p.module.bindings.some((b) => b.type.kind === 'array' && b.type.elem.kind === 'atomic'),
      ).length,
    ).toBeGreaterThan(4);
    for (const s of PINNED_SEEDS)
      expect(
        CASES.some((k) => k.c.seed === s),
        `pinned seed ${String(s)} left the corpus`,
      ).toBe(true);
  });

  it('A: the codegen is bit-identical to the interpreter, in f64 and in f32', () => {
    const f64 = differential(
      (k) => compileModule(k.c.module),
      (k) => compileModuleJs(k.c.module),
    );
    const f32 = differential(
      (k) => compileModule(k.c.module, { precision: 'f32' }),
      (k) => compileModuleJs(k.c.module, { precision: 'f32' }),
    );
    console.log(`[#349 A] ${String(f64.checks + f32.checks)} interpreter-vs-codegen calls`);
    expect(f64.divergences).toEqual([]);
    expect(f32.divergences).toEqual([]);
    expect(f64.checks).toBeGreaterThan(100);
  });

  it('B: O1 is bit-exact, and O2 within tolerance', () => {
    const o1 = differential(
      (k) => compileModule(k.c.module),
      (k) => compileModule(optimizeAt(k.c.module, 'O1')),
    );
    const o2 = differential(
      (k) => compileModule(k.c.module),
      (k) => compileModule(optimizeAt(k.c.module, 'O2')),
      (x, y) => closeEnough(x, y, 1e-9),
    );
    expect(o1.divergences).toEqual([]);
    expect(o2.divergences).toEqual([]);
  });

  it('S: the stepping walk agrees with the interpreter, in f64 and in f32', () => {
    const divergences: string[] = [];
    let checks = 0;
    for (const precision of ['f64', 'f32'] as const) {
      for (const { k, args, key } of sweep()) {
        // A step of a debug session is a statement, so a long loop is left to the other arms.
        if (args.some((a) => Array.isArray(a) && (a as unknown[]).length > 7)) continue;
        const want = call(compileModule(k.c.module, { gpuStubs: true, precision }), k.c, args);
        const values = args.map(copy);
        const s = startDebugSession(k.c.module, k.c.kernel, values, { precision, gpuStubs: true });
        s.continue();
        expect(s.done).toBe(true);
        const got: KernelRun = { result: s.result, arrays: values.slice(0, k.c.arrays.length) };
        checks++;
        // The result too, whatever the loops reduce: the session folds a reduction in Rule 7.2's
        // tree, as the interpreter does (#362).
        if (!bitEqual(want, got) && divergences.length < 8)
          divergences.push(`${precision} ${key}: ${show(want)} ≠ ${show(got)}`);
      }
    }
    expect(checks).toBeGreaterThan(100);
    expect(divergences).toEqual([]);
  });

  it('L: the plan the GPU runs computes what the function does, on the f32 oracle', () => {
    const { divergences, checks } = lowering();
    console.log(`[#349 L] ${String(checks)} lowered plans against their functions`);
    expect(checks).toBeGreaterThan(60);
    expect(divergences).toEqual([]);
  });

  it('L notices a plan run wrong: an iteration skipped, a partial dropped', () => {
    expect(lowering('skip-first-iteration').divergences.length).toBeGreaterThan(0);
    expect(lowering('drop-last-partial').divergences.length).toBeGreaterThan(0);
  });
});

// The GPU differential (`scripts/gpu-differential.ts`, `bun run gate:differential`) holds the
// exact corpus to the f32 oracle bit for bit on WebGPU. Its claim rests on two facts about the
// corpus, held here where there is no GPU: the determinism report lists nothing but a reduction's
// `order`, and every float literal has a few bits, so that no grouping a driver may choose
// (WGSL §15.7.5) rounds a sum or a product of them (#378).
describe("the GPU differential's exact corpus (#349)", () => {
  it('reports nothing but order rows, and writes only float literals of a few bits', () => {
    const rows = new Set<string>();
    const literals = new Set<number>();
    const walk = (st: Stmt): void =>
      eachStmtExpr(
        st,
        (e) =>
          eachExpr(e, (x) => {
            if (x.op === 'lit' && typeof x.value === 'number' && isFloat(x.type))
              literals.add(x.value);
          }),
        walk,
      );
    for (let seed = 1; seed <= 48; seed++) {
      const c = generateKernelModule(seed, { exact: true });
      for (const r of determinismReport(c.module)) rows.add(`${r.op} ${r.elem} ${r.kind}`);
      for (const f of c.module.funcs) f.body.forEach(walk);
    }
    expect([...rows].filter((r) => !r.endsWith(' order'))).toEqual([]);
    expect(rows.size).toBeGreaterThan(0);
    expect(literals.size).toBeGreaterThan(4);
    for (const v of literals)
      expect(Number.isInteger(v * 8) && Math.abs(v) <= 1000, `${v}`).toBe(true);
  });
});
