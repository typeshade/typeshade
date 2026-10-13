// === A constant call of a builtin Tint refuses (#613, Rule 12.6) ===
//
// `pow`, `sqrt` and the other numeric builtins are `@const` in WGSL: a call whose arguments are
// all constant is a const-expression, evaluated when the shader is created, and a value outside
// the builtin's domain, or one `f32` cannot hold, is a shader-creation error (WGSL §15.7.2).
// Such a call compiled here with no diagnostic and Tint refused the WGSL: `pow(-2., 0.5)`,
// `pow(-2., 2.)` (Tint refuses every negative base before it computes the power, so the 4 that
// (-2)² is does not help), `pow(0., -1.)`, `10. ** 40.`, `sqrt(-1.)`. This is the family of #374
// and #578 for a builtin call, refused at the call in the author's words with the same code.
//
// The arguments fold as a divisor does (#68): literals, negation, vector constructors, and
// constants of the module and of the body, which reach WGSL as const-expressions. A `let` or a
// run-time value does not fold, and Tint takes it, so it passes. `loop-bound.ts` holds the
// measured domains and the fold.

import type ts from 'typescript';
import type { Expr } from '../../../core/ir/nodes.js';
import type { TsCompilerDiagnostic } from '../source-file.js';
import type { LoweringScope } from '../context.js';
import { makeDiagnostic } from '../diagnostic.js';
import { TS_CODES } from '../codes.js';
import { constCallOutsideDomain, constF32OutOfRange } from '../loop-bound.js';

/** The `TS8003` sentence of a constant `f32` value no `f32` holds (#374): the literal's, and now
 *  a constant call's. */
export function f32RangeSentence(text: string, value: number): string {
  return (
    `"${text}" is about ${String(Number(value.toPrecision(3)))}, outside the ` +
    `range of f32 (about ±3.4e38), and there is no wider type here for it to take.`
  );
}

/** Whether the builtin call `call` (already lowered, `display` as written: `pow`, `Math.sqrt`,
 *  `**`) was refused with a diagnostic on `node`: its constant arguments are outside the
 *  builtin's domain, or its constant value is past the range of `f32`. */
export function refuseConstCall(
  call: Expr & { op: 'call' },
  display: string,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scope: LoweringScope,
  diagnostics: TsCompilerDiagnostic[],
): boolean {
  const text = node.getText(sourceFile);
  const outside = constCallOutsideDomain(call.fn, call.args, scope);
  if (outside !== undefined) {
    // The value the author meant, where the arithmetic has one: `pow(-2., 2.)` is 4. A vector
    // call has a value per component, which one number does not spell, and a value with none (`sqrt(-1.)`, `pow(0., -1.)`) has no spelling to offer, so the argument is the
    // thing to change. Computing it at run time is not offered: it is outside the domain there
    // too, where WGSL and GLSL ES 3.00 leave the result undefined.
    const value =
      call.fn === 'pow' && outside.index < 0 && outside.values.length === 2
        ? Math.pow(outside.values[0]!, outside.values[1]!)
        : Number.NaN;
    const where = outside.index >= 0 ? `in .${'xyzw'[outside.index]!}, ` : '';
    const remedy = Number.isFinite(value)
      ? `Write its value, ${String(Number(value.toPrecision(6)))}, instead.`
      : call.fn === 'smoothstep'
        ? 'Give the edges two different values.'
        : 'It has no value to write; change the argument.';
    // `smoothstep`'s edges are refused whatever its `x` is (measured: a run-time `x` too).
    const when =
      call.fn === 'smoothstep'
        ? 'WGSL refuses two equal constant edges when it creates the shader, whatever x is.'
        : 'WGSL evaluates a call whose arguments are all constant when it creates the shader, ' +
          'and refuses this one.';
    diagnostics.push(
      makeDiagnostic(
        sourceFile,
        node,
        `"${text}" is outside the domain of ${display}: ${where}${outside.why}. ${when} ${remedy}`,
        TS_CODES.TYPE_MISMATCH,
      ),
    );
    return true;
  }
  const past = constF32OutOfRange(call, scope);
  if (past !== undefined) {
    diagnostics.push(
      makeDiagnostic(sourceFile, node, f32RangeSentence(text, past), TS_CODES.TYPE_MISMATCH),
    );
    return true;
  }
  return false;
}
