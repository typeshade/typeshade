// ═══ Default parameter values (roadmap 0.3 item T7, #92) ═══
//
// `function tint(c: vec3, k: f32 = 0.5)` is ordinary TypeScript, and `tint(c)` is how it is
// then called. Neither WGSL nor GLSL has default arguments, so the emitted function keeps
// every parameter and the missing ones are filled in where the call is written: `tint(c)`
// becomes `tint(c, 0.5)`. Nothing about the default reaches the IR as a default.
//
// That is why a default may not read another parameter. The argument for `a` at a call site is
// an EXPRESSION, not a value: filling `b = a * 2.` in would emit that expression a second time
// and run whatever it calls twice. TypeScript evaluates the default against the argument's
// value, which needs a binding this surface has nowhere to put, since a call is an expression
// and the IR has no let-expression. The default is lowered once, at the declaration, in the
// module's scope with no parameters in it, and the one Expr is spliced at every call site.
//
// This file is storage and nothing else, so the call lowering can read a default without
// importing the expression lowering that produced it.

import type ts from 'typescript';
import type { Expr, FuncDecl } from '../../../core/ir/nodes.js';

interface Slot {
  /** The default as written, lowered once by `lowerParamDefaults` in function.ts. */
  readonly node: ts.Expression;
  expr?: Expr;
}

const DEFAULTS = new WeakMap<FuncDecl, (Slot | undefined)[]>();

/** Record what each of `parameters` defaults to, against `stub`'s own parameter indices.
 *  `offset` is 1 for a method, whose stub carries `self_` ahead of the written parameters
 *  (#86). A signature with no default records nothing, so `hasParamDefaults` stays false and
 *  every call keeps the arity check it had. */
export function recordParamDefaults(
  stub: FuncDecl,
  parameters: readonly ts.ParameterDeclaration[],
  offset = 0,
): void {
  let slots: (Slot | undefined)[] | undefined;
  for (const [i, p] of parameters.entries()) {
    if (!p.initializer) continue;
    slots ??= new Array<Slot | undefined>(stub.params.length).fill(undefined);
    slots[offset + i] = { node: p.initializer };
  }
  if (slots) DEFAULTS.set(stub, slots);
}

/** True when the signature writes at least one default, which is what makes a call with fewer
 *  arguments than parameters worth looking at. */
export function hasParamDefaults(stub: FuncDecl): boolean {
  return DEFAULTS.has(stub);
}

/** The defaults of `stub` still to lower, as `[index, node]` pairs. A slot already lowered is
 *  left out, so the pass that resolves one default in terms of another can run again without
 *  redoing the work or repeating a diagnostic. */
export function paramDefaultNodes(stub: FuncDecl): readonly (readonly [number, ts.Expression])[] {
  const slots = DEFAULTS.get(stub);
  if (!slots) return [];
  const out: (readonly [number, ts.Expression])[] = [];
  for (const [i, slot] of slots.entries())
    if (slot && slot.expr === undefined) out.push([i, slot.node]);
  return out;
}

/** Keep the lowered default for parameter `i`. A default that did not lower keeps none, and
 *  the call site falls back to the arity message, since the reason was already reported where
 *  the default was written. */
export function setParamDefault(stub: FuncDecl, i: number, expr: Expr): void {
  const slot = DEFAULTS.get(stub)?.[i];
  if (slot) slot.expr = expr;
}

/** True when parameter `i` of `stub` writes a default, whether or not it lowered. A call that
 *  omits it is not an arity mistake: the reason it has no value was said where it was written,
 *  and repeating it as "expects 2, got 1" on every call sends the author to the wrong line. */
export function declaresParamDefault(stub: FuncDecl, i: number): boolean {
  return DEFAULTS.get(stub)?.[i] !== undefined;
}

/** The lowered default for parameter `i` of `stub`, or undefined when it has none. */
export function paramDefault(stub: FuncDecl, i: number): Expr | undefined {
  return DEFAULTS.get(stub)?.[i]?.expr;
}

/** The calls a filled-in default brought into `owner`'s body (roadmap 0.3 item T7, #92). The
 *  recursion check walks the syntax tree, where these calls are not written; without them a
 *  cycle that only closes through a default emits WGSL Tint refuses and a CPU run that
 *  overflows. Each is paired with the call site that omitted the argument, to anchor the
 *  diagnostic where the author can edit it. */
const FILLED = new WeakMap<FuncDecl, { readonly to: string; readonly node: ts.Node }[]>();

export function noteFilledCall(owner: FuncDecl, to: string, node: ts.Node): void {
  const prior = FILLED.get(owner);
  if (prior) prior.push({ to, node });
  else FILLED.set(owner, [{ to, node }]);
}

export function filledCallsOf(
  owner: FuncDecl,
): readonly { readonly to: string; readonly node: ts.Node }[] {
  return FILLED.get(owner) ?? [];
}

/** How many of `stub`'s parameters a call must write, counting from `leading`: every parameter
 *  up to the last one without a default. TypeScript allows `f(a = 1, b: f32)`, where both
 *  arguments are required, so this counts the trailing run of defaults rather than all of
 *  them. */
export function requiredParamCount(stub: FuncDecl, leading = 0): number {
  const slots = DEFAULTS.get(stub);
  if (!slots) return stub.params.length - leading;
  let n = stub.params.length;
  while (n > leading && slots[n - 1]?.expr !== undefined) n--;
  return n - leading;
}
