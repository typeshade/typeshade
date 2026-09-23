import ts from 'typescript';
import type { Expr } from '../../../core/ir/nodes.js';
import type { ShaderType } from '../../../core/ir/types.js';
import { f64T, i32T, typeKey } from '../../../core/ir/types.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import type { LoweringScope } from '../context.js';
import { TS_CODES, type TsCode } from '../codes.js';
import { makeDiagnostic } from '../diagnostic.js';
import { retargetIntLit } from '../lit-coerce.js';
import { lowerExpression } from './expression.js';
import { refuseBareAtomic } from './atomics.js';

export function lowerIndex(
  node: ts.ElementAccessExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): Expr | undefined {
  const base = lowerExpression(node.expression, sourceFile, scope, diagnostics);
  if (!base || !node.argumentExpression) return undefined;
  let idx = lowerExpression(node.argumentExpression, sourceFile, scope, diagnostics);
  if (!idx) return undefined;
  idx = retargetIntLit(idx, node.argumentExpression, i32T);
  const ik = typeKey(idx.type);
  if (ik !== 'i32' && ik !== 'u32') {
    pushDiag(diagnostics, sourceFile, node, 'Index must be i32 or u32.', TS_CODES.TYPE_MISMATCH);
    return undefined;
  }
  // An emulated-double vector has no runtime component addressing: it is a pair of hi/lo
  // PLANES after the fp64 pass, so lane i is a swizzle of both planes (`laneSwizzle`) and a
  // dynamic index would have to swizzle by a value, which neither target spells. A constant
  // index is exactly a swizzle, so it lowers to the `member` the pass already handles; a
  // dynamic one is refused with the spelling that works (#151 F64-04).
  if (base.type.kind === 'vec64') {
    if (idx.op !== 'lit' || typeof idx.value !== 'number' || !Number.isInteger(idx.value)) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `A ${typeKey(base.type)} is indexed by a constant lane, since an emulated double is a ` +
          `pair of hi/lo planes and a lane of it is a swizzle of both; write v.x, v.y or a ` +
          `whole-number index.`,
        TS_CODES.TYPE_MISMATCH,
      );
      return undefined;
    }
    const i = idx.value;
    if (i < 0 || i >= base.type.n) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Index ${i} is out of range for length ${base.type.n}.`,
        TS_CODES.INDEX_OOB,
      );
      return undefined;
    }
    return { op: 'member', type: f64T, base, field: 'xyzw'[i]! };
  }
  const elem = indexElem(base.type);
  if (!elem) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Cannot index ${typeKey(base.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  if (refuseBareAtomic(elem, node, sourceFile, scope, diagnostics)) return undefined;
  const bound = indexBound(base.type);
  if (bound !== undefined && idx.op === 'lit' && typeof idx.value === 'number') {
    const i = idx.value;
    if (!Number.isInteger(i) || i < 0 || i >= bound) {
      pushDiag(
        diagnostics,
        sourceFile,
        node,
        `Index ${i} is out of range for length ${bound}.`,
        TS_CODES.INDEX_OOB,
      );
      return undefined;
    }
  }
  return { op: 'index', type: elem, base, idx };
}

export function lowerSelect(
  node: ts.ConditionalExpression,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
  contextual?: ShaderType,
): Expr | undefined {
  const cond = lowerExpression(node.condition, sourceFile, scope, diagnostics);
  // Both arms sit in the ternary's own position, so both take its context (#8 A11). A
  // `return c ? { … } : { … }` in a function declared `A` is two object literals in a
  // declared position, not two literals in none; without this each fell through to the
  // unique-struct fallback and was refused twice over.
  let ifTrue = lowerExpression(node.whenTrue, sourceFile, scope, diagnostics, contextual);
  let ifFalse = lowerExpression(node.whenFalse, sourceFile, scope, diagnostics, contextual);
  if (!cond || !ifTrue || !ifFalse) return undefined;
  if (typeKey(cond.type) !== 'bool') {
    pushDiag(
      diagnostics,
      sourceFile,
      node.condition,
      'Ternary condition must be bool.',
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  ifTrue = retargetIntLit(ifTrue, node.whenTrue, ifFalse.type);
  ifFalse = retargetIntLit(ifFalse, node.whenFalse, ifTrue.type);
  if (typeKey(ifTrue.type) !== typeKey(ifFalse.type)) {
    pushDiag(
      diagnostics,
      sourceFile,
      node,
      `Ternary arm type mismatch: ${typeKey(ifTrue.type)} vs ${typeKey(ifFalse.type)}.`,
      TS_CODES.TYPE_MISMATCH,
    );
    return undefined;
  }
  return { op: 'select', type: ifTrue.type, cond, ifTrue, ifFalse };
}

/** The products one of whose operands is a matrix, typed per wgsl.txt:9960-9995 — the same
 *  table `binResultType` applies in the fn() EDSL, which is why the shapes are spelled once
 *  here and the result types agree with it by inspection:
 *
 *    matKxR * matCxK -> matCxR     the shared dimension cancels
 *    matCxR * vecC   -> vecR       the vector is a column
 *    vecR   * matCxR -> vecC       the vector is a row
 *    m * s, s * m    -> m          component-wise scaling, either side
 *
 *  A pair whose dimensions do not meet returns undefined and falls through to the ordinary
 *  numeric mismatch, which names both types. */
export function matVecMul(left: Expr, right: Expr): Expr | undefined {
  const lt = left.type;
  const rt = right.type;
  const mul = (type: ShaderType): Expr => ({ op: 'binop', type, bop: '*', a: left, b: right });
  if (lt.kind === 'mat' && rt.kind === 'mat' && lt.elem === rt.elem && lt.cols === rt.rows) {
    return mul({ kind: 'mat', cols: rt.cols, rows: lt.rows, elem: lt.elem });
  }
  if (lt.kind === 'mat' && rt.kind === 'vec' && lt.elem === rt.elem && lt.cols === rt.n) {
    return mul({ kind: 'vec', n: lt.rows, elem: rt.elem });
  }
  if (lt.kind === 'vec' && rt.kind === 'mat' && lt.elem === rt.elem && rt.rows === lt.n) {
    return mul({ kind: 'vec', n: rt.cols, elem: lt.elem });
  }
  // The emulated-double forms the fp64 pass has a body for: square against square, and
  // square against a vec64 of the same width.
  if (lt.kind === 'mat' && lt.elem === 'f64' && rt.kind === 'vec64' && lt.cols === rt.n) {
    return mul(rt);
  }
  // Component-wise scaling by a scalar of the matrix's own element kind, either side.
  // Component-wise scaling by a scalar of the matrix's own element kind, either side. NOT
  // offered for the emulated-double matrices: `binResultType` refuses a scalar beside a
  // mat64 and the fp64 pass has a body only for matmul, matvec and transpose, so admitting
  // `s * m64` here emitted `(s * m)` on a DF64Mat3, which Tint answers with "no matching
  // overload for operator * (vec2<f32>, DF64Mat3)" (#149 review).
  if (lt.kind === 'mat' && lt.elem === 'f32' && rt.kind === 'scalar' && rt.scalar === 'f32')
    return mul(lt);
  if (lt.kind === 'scalar' && lt.scalar === 'f32' && rt.kind === 'mat' && rt.elem === 'f32')
    return mul(rt);
  return undefined;
}

function indexElem(t: ShaderType): ShaderType | undefined {
  if (t.kind === 'array') return t.elem;
  if (t.kind === 'vec') return { kind: 'scalar', scalar: t.elem };
  // Both targets are column-major, so `m[j]` is COLUMN j, which has `rows` components —
  // not `cols`. The two agree only on a square matrix, which is why this was invisible
  // while mat4x4 was the only float matrix.
  if (t.kind === 'mat' && t.elem === 'f32') return { kind: 'vec', n: t.rows, elem: 'f32' };
  return undefined;
}

function indexBound(t: ShaderType): number | undefined {
  if (t.kind === 'array') return t.size;
  if (t.kind === 'vec') return t.n;
  // The number of COLUMNS is how many indices a matrix has.
  if (t.kind === 'mat') return t.cols;
  return undefined;
}

function pushDiag(
  diagnostics: TsCompilerDiagnostic[],
  sourceFile: ts.SourceFile,
  node: ts.Node,
  message: string,
  code: TsCode,
): void {
  diagnostics.push(makeDiagnostic(sourceFile, node, message, code));
}
