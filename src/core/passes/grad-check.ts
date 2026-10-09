// ═══ gradCheck — a derivative held to a central difference on the f64 oracle (change 0056) ═══
//
// Roadmap item 20, delivered with reverse mode (change 0056, decision 6). `gradCheck` builds the
// derivative `grad` builds, in either mode, and compares every partial derivative it gives with
// a central difference of the original function on the CPU oracle at `f64`, at the points the
// caller passes. It is the check `grad.test.ts` and `grad-reverse.test.ts` run, as an export.

import type { ModuleDecl } from '../ir/nodes.js';
import { compileModule } from '../oracle.js';
import { grad, refuse } from './grad.js';

/** Options for {@link gradCheck}.
 *
 *  Exported from `typeshade`. */
export interface GradCheckOptions {
  /** The parameters to check the derivative with respect to: one name or a list. Each is an
   *  `f32` or an `f32` vector, and in reverse mode also an `f32` matrix. */
  readonly wrt: string | readonly string[];
  /** The points: each is the argument list of one call of the function, in its order, with a
   *  vector or a matrix as an array of numbers. */
  readonly at: readonly (readonly unknown[])[];
  /** The mode of the derivative under check. Defaults to `'forward'`. */
  readonly mode?: 'forward' | 'reverse';
  /** The step of the central difference. Defaults to `1e-5`. */
  readonly h?: number;
  /** The relative tolerance: a partial derivative passes when it is within
   *  `tolerance * max(1, |difference|)` of the central difference. Defaults to `1e-4`. */
  readonly tolerance?: number;
}

/** What {@link gradCheck} returns.
 *
 *  Exported from `typeshade`. */
export interface GradCheckResult {
  /** `true` when every partial derivative is within the tolerance. */
  readonly ok: boolean;
  /** The count of partial derivatives compared. */
  readonly checked: number;
  /** The partial derivative farthest outside the tolerance, relative to it, and where the
   *  derivative and the central difference part. Absent when `ok`. */
  readonly worst?: {
    /** The parameter. */
    readonly param: string;
    /** The index of the point in {@link GradCheckOptions.at}. */
    readonly point: number;
    /** The component of the parameter, `0` for a scalar. */
    readonly component: number;
    /** The component of the result, `0` for a scalar. */
    readonly output: number;
    /** The partial derivative the derivative function gives. */
    readonly derivative: number;
    /** The central difference. */
    readonly difference: number;
  };
}

type Fn = (...args: unknown[]) => unknown;
const flat = (v: unknown): number[] =>
  Array.isArray(v) ? (v as unknown[]).flatMap(flat) : [v as number];

/** `v` with its `c`-th number moved by `s`, its shape kept. */
function shifted(v: unknown, c: number, s: number): unknown {
  let k = 0;
  const walk = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(walk) : k++ === c ? (x as number) + s : x;
  return walk(v);
}

/** `v`'s shape with every number zero but the `c`-th, which is one. */
function basis(v: unknown, c: number): unknown {
  let k = 0;
  const walk = (x: unknown): unknown => (Array.isArray(x) ? x.map(walk) : k++ === c ? 1 : 0);
  return walk(v);
}

/** Compare the derivative {@link grad} builds for `fn` with a central difference on the CPU
 *  oracle at `f64`, at each point of `opts.at`, for every component of every parameter of
 *  `opts.wrt` and every component of the result. It builds the derivative in the mode
 *  `opts.mode` names, so it holds forward mode and reverse mode alike.
 *
 *  Exported from `typeshade`.
 *
 *  @param m - the module holding `fn`.
 *  @param fn - the name of the function.
 *  @param opts - the parameters, the points, the mode, the step and the tolerance.
 *  @returns whether every partial derivative agrees, how many were compared and the worst.
 *  @throws `SD0118` when `grad` refuses the function or a parameter.
 *
 *  @example
 *  ```ts
 *  import { compile, gradCheck } from 'typeshade'
 *
 *  const { module } = compile(`"use typeshade"
 *  export function f(x: f32, k: f32): f32 {
 *    return sin(k * x) * k
 *  }`)
 *  gradCheck(module, 'f', { wrt: ['x', 'k'], at: [[0.5, 2]], mode: 'reverse' }).ok // true
 *  ```
 */
export function gradCheck(m: ModuleDecl, fn: string, opts: GradCheckOptions): GradCheckResult {
  const wrt = typeof opts.wrt === 'string' ? [opts.wrt] : opts.wrt;
  const h = opts.h ?? 1e-5;
  const tol = opts.tolerance ?? 1e-4;
  const f0 = m.funcs.find((g) => g.name === fn);
  if (f0 === undefined) throw refuse(`no function "${fn}" in the module`);
  const index = (w: string): number => {
    const i = f0.params.findIndex((p) => p.name === w);
    if (i < 0)
      throw refuse(
        `"${fn}" has no parameter "${w}"; it takes ${f0.params.map((q) => q.name).join(', ') || 'none'}`,
      );
    return i;
  };

  // The derivative functions: one in reverse mode, one for each component in forward mode.
  let mod = m;
  let reverse: { name: string; adjoints: Readonly<Record<string, string>> } | undefined;
  const forward = new Map<string, string[]>();
  if (opts.mode === 'reverse') {
    const d = grad(mod, fn, wrt, { mode: 'reverse', name: unused(mod, `${fn}_gradcheck`) });
    mod = d.module;
    reverse = { name: d.name, adjoints: d.adjoints! };
  } else {
    for (const w of wrt) {
      const p = f0.params[index(w)]!;
      const names: string[] = [];
      const n = p.type.kind === 'vec' ? p.type.n : 1;
      for (let c = 0; c < n; c++) {
        const d = grad(mod, fn, w, {
          name: unused(mod, `${fn}_gradcheck_${w}_${c}`),
          ...(p.type.kind === 'vec'
            ? { direction: Array.from({ length: n }, (_, j) => (j === c ? 1 : 0)) }
            : {}),
        });
        mod = d.module;
        names.push(d.name);
      }
      forward.set(w, names);
    }
  }

  const cm = compileModule(mod);
  const f = cm.fns[fn] as Fn;
  let checked = 0;
  let worst: GradCheckResult['worst'];
  let worstRatio = 1;
  opts.at.forEach((pt, point) => {
    const y0 = f(...pt);
    const outputs = flat(y0).length;
    // The analytic Jacobian, J[w][o][c].
    const analytic = new Map<string, number[][]>();
    for (const w of wrt) {
      const at = index(w);
      const n = flat(pt[at]).length;
      const J = Array.from({ length: outputs }, () => new Array<number>(n).fill(0));
      if (reverse !== undefined) {
        for (let o = 0; o < outputs; o++) {
          const r = (cm.fns[reverse.name] as Fn)(...pt, basis(y0, o)) as Record<string, unknown>;
          flat(r[reverse.adjoints[w]!]).forEach((x, c) => (J[o]![c] = x));
        }
      } else {
        forward.get(w)!.forEach((name, c) => {
          flat((cm.fns[name] as Fn)(...pt)).forEach((x, o) => (J[o]![c] = x));
        });
      }
      analytic.set(w, J);
    }
    for (const w of wrt) {
      const at = index(w);
      const n = flat(pt[at]).length;
      for (let c = 0; c < n; c++) {
        const args = (s: number) => pt.map((v, i) => (i === at ? shifted(v, c, s) : v));
        const hi = flat(f(...args(h)));
        const lo = flat(f(...args(-h)));
        for (let o = 0; o < outputs; o++) {
          const difference = (hi[o]! - lo[o]!) / (2 * h);
          const derivative = analytic.get(w)![o]![c]!;
          const bound = tol * Math.max(1, Math.abs(difference));
          const err = Math.abs(derivative - difference);
          checked++;
          const ratio = Number.isNaN(err) ? Infinity : err / bound;
          if (ratio > worstRatio || (Number.isNaN(err) && worst === undefined)) {
            worstRatio = ratio;
            worst = { param: w, point, component: c, output: o, derivative, difference };
          }
        }
      }
    }
  });
  return worst === undefined ? { ok: true, checked } : { ok: false, checked, worst };
}

function unused(m: ModuleDecl, base: string): string {
  const taken = new Set([...m.funcs.map((g) => g.name), ...m.structs.map((s) => s.name)]);
  let n = base;
  for (let i = 2; taken.has(n) || taken.has(`${n}_adjoints`); i++) n = `${base}${i}`;
  return n;
}
