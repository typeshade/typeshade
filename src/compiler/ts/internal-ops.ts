// The compiler-internal operations of the libm's source (change 0042, Amendment A1).
//
// The libm is one `"use typeshade"` source (decision N14). It needs operations that the language
// does not have: the two `u32` words of an `f64`, and exact conversions between an `f64` and an
// integer. Each is an IR call with a `__` name, as `__fround` is. None is a name an author can
// write (OD-3, Rule 9.8): the front end lowers these names only inside `withInternalOps`, which
// `compileLibmSource` alone enters, and the ambient library does not declare them. In an
// author's file each name is a name nothing declares, on both halves.
//
// The CPU op library computes each one (`BUILTINS` in `src/core/cpu-runtime.ts`). No shader
// writer spells one, so a module that carries one is never emitted.

import ts from 'typescript';
import type { Expr } from '../../core/ir/nodes.js';
import { f64T, i32T, u32T, type ShaderType } from '../../core/ir/types.js';
import { logicalTypeKey as typeKey } from './optional.js';
import { TS_CODES, type TsCode } from './codes.js';
import { makeDiagnostic } from './diagnostic.js';
import { authorTypeText } from './context.js';
import type { TsCompilerDiagnostic } from './source-file.js';

/** One internal operation: the types of its arguments and of its result. */
export interface InternalOp {
  readonly params: readonly ShaderType[];
  readonly result: ShaderType;
}

/** The internal operations, by the name the libm's source calls. The list holds only what the
 *  routines in the tree need. */
export const INTERNAL_OPS: Readonly<Record<string, InternalOp>> = {
  /** The high 32 bits of an `f64`: the sign, the exponent and the top 20 bits of the fraction. */
  __f64Hi: { params: [f64T], result: u32T },
  /** The low 32 bits of an `f64`. */
  __f64Lo: { params: [f64T], result: u32T },
  /** The `f64` whose high and low words are the two arguments. */
  __f64FromWords: { params: [u32T, u32T], result: f64T },
  /** An `f64` truncated toward zero to an `i32`. A NaN gives 0, and a value outside the range
   *  gives the nearest bound. */
  __f64ToI32: { params: [f64T], result: i32T },
  /** A `u32` as an `f64`, which is exact. */
  __u32ToF64: { params: [u32T], result: f64T },
};

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}

let enabled = false;

/** Run `f` with the internal operations lowered. Only the libm's compile enters it. */
export function withInternalOps<R>(f: () => R): R {
  const was = enabled;
  enabled = true;
  try {
    return f();
  } finally {
    enabled = was;
  }
}

/** The internal operation `name` calls, when this compile lowers internal operations. */
export function internalOpOf(name: string): InternalOp | undefined {
  return enabled && Object.hasOwn(INTERNAL_OPS, name) ? INTERNAL_OPS[name] : undefined;
}

/** The IR call of an internal operation on already lowered arguments. */
export function lowerInternalOp(
  name: string,
  op: InternalOp,
  args: readonly Expr[],
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  if (args.length !== op.params.length) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `${name} takes ${String(op.params.length)} argument(s); got ${String(args.length)}.`,
      TS_CODES.ARITY_MISMATCH,
    );
    return undefined;
  }
  for (const [i, p] of op.params.entries()) {
    if (typeKey(args[i]!.type) === typeKey(p)) continue;
    pushDiag(
      diagnostics,
      sourceFile,
      node.arguments[i]!,
      `${name} takes ${authorTypeText(p)} as argument ${String(i + 1)}; got ${authorTypeText(args[i]!.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return { op: 'call', type: op.result, fn: name, args: [...args] };
}
