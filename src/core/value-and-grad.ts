// ═══ valueAndGrad — a function's value and its derivatives, callable from the host ═══
//
// `grad` (passes/grad.ts) is an IR pass: it adds one derivative per call to a module, and a
// caller who wants to use it on the CPU threads the module through `grad` once per parameter,
// compiles the result, and looks each derivative up by the name the pass chose. That is five
// steps and an untyped `fns[name]` for what a caller wants in one: `(args) → value and
// derivatives`. This is that one step, the shape JAX calls `value_and_grad`, over the pieces
// that already exist: `grad` per parameter (per lane for a vector), and `compileModuleJs`.
//
// A vector parameter is differentiated along each lane, so its entry in `grad` is one
// derivative per lane: for a function returning `f32` that is the gradient vector; for one
// returning a vector, the Jacobian's columns.

import type { ModuleDecl } from './ir/nodes.js';
import type { CpuValue } from './cpu-runtime.js';
import type { CpuPrecision } from './oracle.js';
import { compileModuleJs } from './cpu-codegen.js';
import { grad } from './passes/grad.js';
import { dslError } from './diagnostics/error.js';

/** Options for {@link valueAndGrad}.
 *
 *  Exported from `typeshade`. */
export interface ValueAndGradOptions {
  /** How f32 arithmetic is evaluated, as {@link compileModuleJs} takes it. Defaults to `'f64'`. */
  readonly precision?: CpuPrecision;
}

/** What a {@link valueAndGrad} function returns for one set of arguments.
 *
 *  Exported from `typeshade`. */
export interface ValueAndGradResult<P extends string> {
  /** The function's own result at the arguments. */
  readonly value: CpuValue;
  /** The derivative of the result with respect to each requested parameter: a value of the
   *  result's type for a scalar parameter, one such value per lane for a vector parameter. */
  readonly grad: { readonly [K in P]: CpuValue };
}

/** The function {@link valueAndGrad} returns: called with the original function's arguments,
 *  it returns the value and the derivatives. `module` is the module with every derivative in
 *  it, for a caller who emits it for a GPU as well; `names` says which function in it is which.
 *
 *  Exported from `typeshade`. */
export type ValueAndGrad<P extends string> = ((...args: CpuValue[]) => ValueAndGradResult<P>) & {
  readonly module: ModuleDecl;
  readonly names: { readonly [K in P]: string | readonly string[] };
};

/** Differentiate `fn` with respect to each of `params` and return one host function that
 *  computes its value and all of those derivatives at a point, on the CPU.
 *
 *  It is {@link grad} once per scalar parameter, and once per lane of a vector parameter,
 *  compiled with {@link compileModuleJs}. The same refusals apply: a construct with no
 *  derivative rule is `SD0118`, naming it.
 *
 *  Exported from `typeshade`.
 *
 *  @param m - the module holding `fn`.
 *  @param fn - the name of the function to differentiate.
 *  @param params - the parameters to differentiate with respect to, each an `f32` or an `f32`
 *    vector.
 *  @param opts - the CPU precision.
 *  @returns a function of `fn`'s arguments returning `{ value, grad }`, carrying the module
 *    with the derivatives in it and their names.
 *  @throws `SD0118` for a parameter or construct `grad` cannot differentiate, and for a
 *    parameter named twice.
 *
 *  @example
 *  ```ts
 *  import { compile, valueAndGrad } from 'typeshade'
 *
 *  const { module } = compile(`"use typeshade"
 *  export function wave(x: f32, a: f32, k: f32): f32 {
 *    return a * sin(k * x)
 *  }`)
 *  const wave = valueAndGrad(module, 'wave', ['a', 'k'])
 *  const { value, grad } = wave(0.5, 2, 3) // grad.a, grad.k
 *  ```
 */
export function valueAndGrad<P extends string>(
  m: ModuleDecl,
  fn: string,
  params: readonly P[],
  opts?: ValueAndGradOptions,
): ValueAndGrad<P> {
  const f = m.funcs.find((g) => g.name === fn);
  if (f === undefined) throw dslError('SD0118', `no function "${fn}" in the module`);
  let module = m;
  const names = {} as Record<P, string | string[]>;
  const taken = new Set(m.funcs.map((g) => g.name));
  const fresh = (base: string): string => {
    let n = base;
    for (let i = 2; taken.has(n); i++) n = `${base}${i}`;
    taken.add(n);
    return n;
  };
  for (const p of params) {
    if (p in names) throw dslError('SD0118', `"${p}" is named twice in the parameter list`);
    const decl = f.params.find((q) => q.name === p);
    const t = decl?.type;
    if (t !== undefined && t.kind === 'vec') {
      const lanes: string[] = [];
      for (let i = 0; i < t.n; i++) {
        const direction = Array.from({ length: t.n }, (_, j) => (j === i ? 1 : 0));
        const r = grad(module, fn, p, { direction, name: fresh(`${fn}_d_${p}_${'xyzw'[i]}`) });
        module = r.module;
        lanes.push(r.name);
      }
      names[p] = lanes;
    } else {
      // A scalar, or a name `grad` refuses with its own sentence (no such parameter, a type
      // with no derivative).
      const r = grad(module, fn, p, { name: fresh(`${fn}_d_${p}`) });
      module = r.module;
      names[p] = r.name;
    }
  }
  const cpu = compileModuleJs(module, opts?.precision ? { precision: opts.precision } : undefined);
  const call = (name: string, args: CpuValue[]): CpuValue => cpu.fns[name]!(...args) as CpuValue;
  const run = (...args: CpuValue[]): ValueAndGradResult<P> => {
    const g = {} as Record<P, CpuValue>;
    for (const p of params) {
      const n = names[p];
      g[p] = typeof n === 'string' ? call(n, args) : (n.map((x) => call(x, args)) as CpuValue);
    }
    return { value: call(fn, args), grad: g };
  };
  return Object.assign(run, { module, names });
}
