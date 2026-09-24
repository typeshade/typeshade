// ═══ The runtime the generated CPU code closes over ═══
//
// `cpu-codegen.ts` turns each function of a module into JavaScript source that reads every
// operation off one object, the factory's `$`. This file builds that object, and only that:
// it imports the op library (`cpu-runtime.ts`) and nothing that generates code. Two callers
// build one. `compileModuleJs` builds it next to the code it hands to `new Function`, and a
// module the Vite plugin generates (`src/compiler/ts/host-face.ts`) builds it through
// `typeshade/runtime`, so an application that imports a `.shade.ts` ships the op library and
// not the generator (Rule 11.7).

import type { CmpOp } from './ir/nodes.js';
import { consoleArgs, type ConsoleMethod, type ConsoleSink } from './console.js';
import type { SourceSpan } from './ir/span.js';
import {
  type CpuValue,
  type NumKind,
  applyBin,
  matVec,
  matMul,
  matVecShaped,
  matMulShaped,
  vecMatShaped,
  matColumn,
  matTransposeShaped,
  setMatColumn,
  BUILTINS,
  GPU_STUBS,
  f32ToU32Sat,
  f32ToI32Sat,
  intDiv,
  intRem,
  cloneValue,
  inoutReturn,
  convertComponent,
  convertComponents,
  atomicStep,
  compareValues,
  selectComponents,
  bitBuiltin,
} from './cpu-runtime.js';
import { barrierOutsideDispatch } from './intrinsics.js';

/** The runtime object closed over by every generated fn (the factory's `$`). */
export interface CodegenRuntime {
  applyBin: typeof applyBin;
  matVec: typeof matVec;
  matMul: typeof matMul;
  matVecShaped: typeof matVecShaped;
  matColumn: typeof matColumn;
  matTransposeShaped: typeof matTransposeShaped;
  setMatColumn: typeof setMatColumn;
  matMulShaped: typeof matMulShaped;
  vecMatShaped: typeof vecMatShaped;
  B: typeof BUILTINS;
  bindings: Record<string, CpuValue>;
  /** The module variables by name (roadmap 0.2 item 5); see `ModCtx.varNames`. */
  vars: Record<string, CpuValue>;
  /** name → resolved impl (compiled fn or interpreter fallback). Populated after
   *  both halves are built so cross-fn calls see the final table. */
  F: Record<string, (...a: CpuValue[]) => CpuValue>;
  splat: (n: number, v: number) => number[];
  swiz: (a: number[], idx: number[]) => number[];
  negVec: (a: number[]) => number[];
  /** A componentwise comparison of two vectors, and a per-component select (§27). */
  cmpVec: (cop: CmpOp, a: CpuValue, b: CpuValue, f32: boolean) => CpuValue;
  /** One of the kind-dependent bit builtins (§10) on already-evaluated arguments. */
  bit: (fn: string, kind: 'u32' | 'i32', args: CpuValue[]) => CpuValue;
  selVec: (cond: readonly CpuValue[], ifTrue: CpuValue, ifFalse: CpuValue) => CpuValue;
  gpuStub: (name: string, ...args: CpuValue[]) => CpuValue;
  console: (
    method: string,
    args: CpuValue[],
    span?: unknown,
    labels?: readonly (string | number)[],
    tableRows?: number,
  ) => void;
  /** One atomic builtin on `base[key]` (roadmap 0.2 item 4): read, `atomicStep`, write back. */
  atomicAt: (
    fn: string,
    base: CpuValue,
    key: string | number,
    arg: number,
    kind: NumKind,
    store?: number,
  ) => CpuValue;
  /** A barrier reached by a directly called invocation: throws, naming `dispatch`. */
  barrier: (fn: string) => never;
  /** The same on a JS local, through the getter and setter the generated code closes over. */
  atomicRef: (
    fn: string,
    get: () => CpuValue,
    set: (v: CpuValue) => void,
    arg: number,
    kind: NumKind,
    store?: number,
  ) => CpuValue;
  /** WGSL saturating f32→u32/i32 (float sources only — see cpu-runtime). */
  u32Sat: typeof f32ToU32Sat;
  i32Sat: typeof f32ToI32Sat;
  /** WGSL integer `/` and `%` (X-GIS #2274) — the SAME helpers `scalarBin` calls. */
  intDiv: typeof intDiv;
  intRem: typeof intRem;
  /** Aggregate copy at a `let` / `var` binding — the SAME helper the interpreter calls. */
  clone: typeof cloneValue;
  inout: typeof inoutReturn;
  /** Element-converting vector constructor components — the SAME helpers the interpreter's
   *  `construct` case calls, so the two CPU backends convert identically. */
  cvt: typeof convertComponent;
  cvtVec: typeof convertComponents;
}

/** What the runtime is built with: whether a GPU-only intrinsic answers a placeholder (the
 *  `gpuStubs` of `compileModule`) and where a `console.*` call goes. */
export interface CodegenRuntimeOptions {
  readonly gpuStubs?: boolean;
  readonly consoleSink?: ConsoleSink;
}

/** A fresh runtime for one generated module: its own binding, variable and function tables. */
export function createCodegenRuntime(opts?: CodegenRuntimeOptions): CodegenRuntime {
  return {
    applyBin,
    matVec,
    matMul,
    matVecShaped,
    matMulShaped,
    vecMatShaped,
    matColumn,
    matTransposeShaped,
    setMatColumn,
    B: BUILTINS,
    bindings: {},
    vars: {},
    F: {},
    splat: (n, v) => new Array(n).fill(v),
    swiz: (a, idx) => idx.map((i) => a[i]!),
    negVec: (a) => a.map((v) => -v),
    cmpVec: compareValues,
    bit: (fn, kind, args) => bitBuiltin(fn, args, kind),
    selVec: selectComponents,
    u32Sat: f32ToU32Sat,
    i32Sat: f32ToI32Sat,
    atomicAt: (fn, base, key, arg, kind, store) => {
      const obj = base as unknown as Record<string | number, CpuValue>;
      const step = atomicStep(fn, obj[key] as number, arg, kind, store);
      if (fn !== 'atomicLoad') obj[key] = step.next;
      return step.result;
    },
    atomicRef: (fn, get, set, arg, kind, store) => {
      const step = atomicStep(fn, get() as number, arg, kind, store);
      if (fn !== 'atomicLoad') set(step.next);
      return step.result;
    },
    barrier: (fn) => {
      throw barrierOutsideDispatch(fn);
    },
    clone: cloneValue,
    inout: inoutReturn,
    cvt: convertComponent,
    cvtVec: convertComponents,
    intDiv,
    intRem,
    gpuStub: (name, ...args) => {
      if (!(opts?.gpuStubs ?? false))
        throw new Error(
          `typeshade/cpu: '${name}' is GPU-only and not computable here — pass compileModule(m, { gpuStubs: true }) to accept placeholder values (X-GIS #763 O3)`,
        );
      return GPU_STUBS[name]!(...args);
    },
    console: (method, args, span, labels, tableRows) => {
      opts?.consoleSink?.({
        method: method as ConsoleMethod,
        args: consoleArgs(args, labels, tableRows),
        span: typeof span === 'string' ? JSON.parse(span) : (span as SourceSpan | undefined),
      });
    },
  };
}
